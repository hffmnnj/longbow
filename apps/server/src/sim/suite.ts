import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  SimSuiteConfigSchema,
  type SimMode,
  type SimRun,
  type SimRunConfigInput,
  type SimSuite,
  type SimSuiteConfig,
  type SimSuiteVariantSummary,
} from "@rh/shared";
import type { EventBus as Bus, Logger } from "../ports.ts";
import { scenarioById } from "./scenarios.ts";

/**
 * Narrow view of the run service a suite needs. It matches the new runner
 * signature `start(config, startedBy, { suiteId, variant })`; the previous
 * two-argument runner also satisfies it structurally, but only a runner that
 * resolves `scenario` configs and fans runs out to a pool can execute suites.
 */
export interface SuiteRunner {
  /** Scenario runs omit `days`/`startDate`: the runner resolves them from the scenario library. */
  start(config: Omit<SimRunConfigInput, "days"> & { days?: number }, startedBy: "user" | "agent", options?: { suiteId?: string; variant?: string }): Promise<SimRun>;
  get(id: string): SimRun | undefined;
  stop(id: string): Promise<SimRun | undefined>;
}

export interface SuiteService {
  start(input: unknown, startedBy: "user" | "agent"): Promise<SimSuite>;
  list(): SimSuite[];
  get(id: string): SimSuite | undefined;
  stop(id: string): Promise<SimSuite | undefined>;
  close(): void;
}

export interface SuiteServiceDeps {
  runner: SuiteRunner;
  bus: Bus;
  log: Logger;
  /** Server DATA_DIR; suites live under `<dataDir>/sim/suites`. */
  dataDir: string;
  now?: () => number;
}

const MAX_RUNS = 24;
const AGENT_MAX_RUNS = 8;
const BOOTSTRAP_RESAMPLES = 2000;

/** Deterministic seed so variants A and B face identical markets and intraday paths. */
export function suiteSeed(suiteId: string, scenarioId: string): number {
  let hash = 5381;
  for (const char of `${suiteId}:${scenarioId}`) hash = ((hash << 5) + hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 2_147_483_647;
}

/** Mulberry32: small seeded PRNG for the comparison's bootstrap interval. */
function prng(seed: number): () => number {
  let state = seed | 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear-interpolation quantile over a sorted array. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) throw new Error("Cannot take a quantile of no values");
  const pos = q * (sorted.length - 1);
  const base = Math.floor(pos);
  const frac = pos - base;
  return sorted[base]! * (1 - frac) + sorted[Math.min(sorted.length - 1, base + 1)]! * frac;
}

/** Percentile bootstrap confidence interval for the mean of paired differences. */
export function bootstrapMeanCI(diffs: number[], seed: number, resamples = BOOTSTRAP_RESAMPLES): [number, number] {
  const rand = prng(seed);
  const means: number[] = [];
  for (let i = 0; i < resamples; i++) {
    let sum = 0;
    for (let j = 0; j < diffs.length; j++) sum += diffs[Math.floor(rand() * diffs.length)]!;
    means.push(sum / diffs.length);
  }
  means.sort((a, b) => a - b);
  return [quantile(means, 0.025), quantile(means, 0.975)];
}

function atomic(file: string, value: unknown): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

const clone = <T>(value: T): T => structuredClone(value);

function ended(run: SimRun): boolean {
  return run.status === "done" || run.status === "failed" || run.status === "stopped";
}

function terminal(suite: SimSuite): boolean {
  return suite.status === "done" || suite.status === "failed" || suite.status === "stopped";
}

function mean(values: number[]): number | undefined {
  return values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0) / values.length;
}

function marketKey(entry: { scenario?: string; seed?: number }): string {
  return entry.scenario ?? `bootstrap:${entry.seed}`;
}

function summarizeVariant(label: string, runs: SimRun[]): SimSuiteVariantSummary {
  const withMetrics = runs.filter((r) => r.metrics !== undefined);
  const summary: SimSuiteVariantSummary = {
    label,
    runs: runs.length,
    done: runs.filter((r) => r.status === "done").length,
    failed: runs.filter((r) => r.status === "failed" || r.status === "stopped").length,
  };
  if (withMetrics.length === 0) return summary;
  const returns = withMetrics.map((r) => r.metrics!.returnPct).sort((a, b) => a - b);
  const excess = withMetrics.map((r) => r.metrics!.returnPct - r.metrics!.benchmarkReturnPct);
  summary.meanReturnPct = mean(returns);
  summary.medianReturnPct = quantile(returns, 0.5);
  summary.p10ReturnPct = quantile(returns, 0.1);
  summary.p90ReturnPct = quantile(returns, 0.9);
  summary.meanExcessPct = mean(excess);
  summary.beatBenchmarkPct = excess.filter((e) => e > 0).length / excess.length * 100;
  summary.worstDrawdownPct = Math.max(...withMetrics.map((r) => r.metrics!.maxDrawdownPct));
  const sharpes = withMetrics.map((r) => r.metrics!.sharpe).filter((s): s is number => s !== undefined).sort((a, b) => a - b);
  if (sharpes.length > 0) summary.medianSharpe = quantile(sharpes, 0.5);
  // Pooled across round trips: trip-weighted means, so a 40-trip run counts more than a 2-trip one.
  const trips = withMetrics.map((r) => ({ trips: r.metrics!.roundTrips, win: r.metrics!.winRatePct, r: r.metrics!.avgR }));
  const tripTotal = trips.reduce((sum, t) => sum + t.trips, 0);
  if (tripTotal > 0) {
    const wins = trips.filter((t) => t.win !== undefined);
    const winTrips = wins.reduce((sum, t) => sum + t.trips, 0);
    if (winTrips > 0) summary.winRatePct = wins.reduce((sum, t) => sum + (t.win! / 100) * t.trips, 0) / winTrips * 100;
    const withR = trips.filter((t) => t.r !== undefined);
    const rTrips = withR.reduce((sum, t) => sum + t.trips, 0);
    if (rTrips > 0) summary.avgR = withR.reduce((sum, t) => sum + t.r! * t.trips, 0) / rTrips;
  }
  summary.costsPct = mean(withMetrics.map((r) => r.metrics!.costsPct));
  summary.brier = mean(withMetrics.map((r) => r.metrics!.brier).filter((b): b is number => b !== undefined));
  return summary;
}

export function createSuiteService(deps: SuiteServiceDeps): SuiteService {
  const root = join(deps.dataDir, "sim", "suites");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const now = deps.now ?? Date.now;
  const suites = new Map<string, SimSuite>();
  const file = (id: string): string => join(root, `${id}.json`);

  function save(suite: SimSuite): void {
    atomic(file(suite.id), suite);
    deps.bus.publish({ type: "sim_suite", suite: clone(suite) });
  }

  function refresh(suite: SimSuite, updated?: SimRun): void {
    const byId = new Map<string, SimRun>();
    for (const entry of suite.runs) {
      const run = updated?.id === entry.runId ? updated : deps.runner.get(entry.runId);
      if (run !== undefined) byId.set(entry.runId, run);
    }
    suite.summary = suite.config.variants.map((variant) =>
      summarizeVariant(variant.label, suite.runs.filter((e) => e.variant === variant.label).map((e) => byId.get(e.runId)).filter((r): r is SimRun => r !== undefined)));
    if (suite.config.variants.length === 2) {
      const [a, b] = suite.config.variants.map((v) => v.label);
      const markets = new Map<string, { a?: SimRun; b?: SimRun }>();
      for (const entry of suite.runs) {
        const run = byId.get(entry.runId);
        if (run?.metrics === undefined) continue;
        const key = marketKey(entry);
        const pair = markets.get(key) ?? {};
        if (entry.variant === a) pair.a = run;
        else if (entry.variant === b) pair.b = run;
        markets.set(key, pair);
      }
      const diffs = [...markets.values()]
        .filter((pair): pair is { a: SimRun; b: SimRun } => pair.a !== undefined && pair.b !== undefined)
        .map((pair) => (pair.b.metrics!.returnPct - pair.b.metrics!.benchmarkReturnPct) - (pair.a.metrics!.returnPct - pair.a.metrics!.benchmarkReturnPct));
      suite.comparison = diffs.length === 0 ? undefined : {
        metric: "excessReturnPct",
        meanDiff: diffs.reduce((x, y) => x + y, 0) / diffs.length,
        ci95: bootstrapMeanCI(diffs, suiteSeed(suite.id, "comparison")),
        pairs: diffs.length,
      };
    } else {
      suite.comparison = undefined;
    }
    const known = suite.runs.map((e) => byId.get(e.runId));
    if (known.every((r) => r !== undefined && ended(r))) {
      const statuses = known.map((r) => r!.status);
      suite.status = statuses.every((s) => s === "failed") ? "failed" : statuses.some((s) => s === "stopped") ? "stopped" : "done";
      suite.finishedAt = now();
    }
  }

  // Load persisted suites; runs interrupted by a restart were already marked
  // failed by the runner, so a refresh settles those suites here.
  if (existsSync(root)) {
    for (const entry of readdirSync(root)) {
      if (!entry.endsWith(".json")) continue;
      try {
        const suite = JSON.parse(readFileSync(join(root, entry), "utf8")) as SimSuite;
        if (suite.id !== entry.replace(/\.json$/, "")) continue;
        suites.set(suite.id, suite);
        if (!terminal(suite)) {
          const before = JSON.stringify(suite);
          if (suite.runs.some((e) => deps.runner.get(e.runId) === undefined)) {
            suite.status = "failed";
            suite.finishedAt = now();
          } else {
            refresh(suite);
          }
          if (JSON.stringify(suite) !== before) save(suite);
        }
      } catch (error) {
        deps.log.warn("could not read simulation suite", { file: entry, error: String(error) });
      }
    }
  }

  const off = deps.bus.subscribe((event) => {
    try {
      if (event.type !== "sim" || event.run.suiteId === undefined) return;
      const suite = suites.get(event.run.suiteId);
      if (suite === undefined || terminal(suite)) return;
      if (!suite.runs.some((e) => e.runId === event.run.id)) return;
      refresh(suite, event.run);
      save(suite);
    } catch (error) {
      deps.log.warn("suite refresh failed", { error: String(error) });
    }
  });

  return {
    async start(input: unknown, startedBy: "user" | "agent"): Promise<SimSuite> {
      const parsed = SimSuiteConfigSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid suite configuration");
      const config: SimSuiteConfig = parsed.data;
      for (const id of config.scenarios) {
        if (scenarioById(id) === undefined) throw new Error(`Unknown scenario: ${id}`);
      }
      const markets = config.scenarios.length + config.bootstrapRuns;
      if (markets === 0) throw new Error("A suite needs at least one scenario or bootstrap run");
      const total = config.variants.length * markets;
      if (total > MAX_RUNS) throw new Error(`A suite holds at most ${MAX_RUNS} runs; this config expands to ${total}`);
      if (startedBy === "agent" && total > AGENT_MAX_RUNS) throw new Error(`Agent suites hold at most ${AGENT_MAX_RUNS} runs; this config expands to ${total}`);
      const id = `${new Date(now()).toISOString().replace(/\D/g, "")}-${randomBytes(3).toString("hex")}`;
      const suite: SimSuite = {
        id, createdAt: now(), startedBy, config, status: "running",
        runs: [], summary: config.variants.map((v) => ({ label: v.label, runs: 0, done: 0, failed: 0 })),
      };
      const base = { startingCash: config.startingCash, cyclesPerDay: config.cyclesPerDay, execution: config.execution,
        ...(config.watchlist === undefined ? {} : { watchlist: config.watchlist }) };
      try {
        for (const variant of config.variants) {
          const model = variant.model ?? (startedBy === "agent" ? "subagent" : "main");
          const overlay = {
            ...(variant.strategy === undefined ? {} : { strategy: variant.strategy }),
            ...(variant.risk === undefined ? {} : { risk: variant.risk }),
          };
          for (const scenario of config.scenarios) {
            const seed = suiteSeed(id, scenario);
            const run = await deps.runner.start(
              { ...base, name: `${config.name} · ${variant.label} · ${scenario}`, scenario, mode: config.scenarioMode, seed, model, ...overlay },
              startedBy, { suiteId: id, variant: variant.label });
            suite.runs.push({ runId: run.id, variant: variant.label, scenario, seed, mode: config.scenarioMode as SimMode });
          }
          for (let seed = 1; seed <= config.bootstrapRuns; seed++) {
            const run = await deps.runner.start(
              { ...base, name: `${config.name} · ${variant.label} · bootstrap-${seed}`, mode: "bootstrap", days: config.bootstrapDays, seed, model, ...overlay },
              startedBy, { suiteId: id, variant: variant.label });
            suite.runs.push({ runId: run.id, variant: variant.label, seed, mode: "bootstrap" });
          }
        }
      } catch (error) {
        suites.set(id, suite);
        save(suite);
        throw error;
      }
      suites.set(id, suite);
      refresh(suite);
      save(suite);
      return clone(suite);
    },
    list: () => [...suites.values()].sort((a, b) => b.createdAt - a.createdAt).map(clone),
    get: (id) => {
      const suite = suites.get(id);
      return suite === undefined ? undefined : clone(suite);
    },
    async stop(id) {
      const suite = suites.get(id);
      if (suite === undefined) return undefined;
      if (!terminal(suite)) {
        for (const entry of suite.runs) {
          const run = deps.runner.get(entry.runId);
          if (run !== undefined && !ended(run)) await deps.runner.stop(entry.runId);
        }
        refresh(suite);
        save(suite);
      }
      return clone(suite);
    },
    close() {
      off();
    },
  };
}
