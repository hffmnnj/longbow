import { Type } from "typebox";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import type { SimSuite } from "@rh/shared";
import type { SimService } from "./runner.ts";
import type { SuiteService } from "./suite.ts";
import { SCENARIOS } from "./scenarios.ts";
import { jsonValue } from "./json.ts";

const ModeParam = Type.Union([Type.Literal("historical"), Type.Literal("blind"), Type.Literal("bootstrap")]);
const ExecutionParam = Type.Union([Type.Literal("realistic"), Type.Literal("ideal")]);
const ModelParam = Type.Union([Type.Literal("main"), Type.Literal("subagent")]);
const points = (n: number): string => `${n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`;

/** Describe the completed pairs, without treating a resampled range as a promotion decision. */
export function comparisonReading(suite: SimSuite): string {
  const comparison = suite.comparison;
  const variants = suite.config.variants;
  if (comparison === undefined || comparison.pairs < 1 || variants.length !== 2) {
    const finished = suite.summary.reduce((sum, s) => sum + s.done + s.failed, 0);
    const total = suite.summary.reduce((sum, s) => sum + s.runs, 0);
    if (suite.status === "running" || suite.status === "queued") return `Suite still running: ${finished} of ${total} runs finished.`;
    return "No paired markets finished: the variants share no market where both completed.";
  }
  const [a, b] = variants;
  const diff = comparison.meanDiff;
  const magnitude = Math.abs(diff).toFixed(1);
  const lead = diff === 0
    ? `${a!.label} and ${b!.label} tied on excess return`
    : `${diff > 0 ? `${b!.label} led ${a!.label}` : `${a!.label} led ${b!.label}`} by ${magnitude === "0.0" ? "less than 0.1" : magnitude} points of excess return`;
  const prefix = suite.status === "running" || suite.status === "queued" ? "So far: " : "";
  if (comparison.pairs === 1) return `${prefix}${lead} across 1 paired market. One pair cannot estimate uncertainty. Does not establish a live edge.`;
  const [lo, hi] = comparison.ci95;
  return `${prefix}${lead} across ${comparison.pairs} paired markets. 95% resampled range (${b!.label} minus ${a!.label}): ${points(lo)} to ${points(hi)}. Does not establish a live edge.`;
}

export function createSimToolsExtension({ sim, suites }: { sim: SimService; suites?: SuiteService }): Extension {
  return defineExtension({ name: "simulations", tools: [
    defineTool({ name: "sim_start", description: "Test a strategy with a full Muse agent and the order gate in an accelerated historical paper account. One run at a time; no real orders. Allow roughly 1–3 minutes per cycle. Historical earnings schedules are not point-in-time, and model memory can contaminate results. Use sim_suite_start for paired price-only comparisons across blind scenarios and bootstrap markets.",
      parameters: Type.Object({ days: Type.Integer({ minimum: 1, maximum: 20 }), startDate: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
        scenario: Type.Optional(Type.String()), mode: Type.Optional(ModeParam), seed: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647 })),
        execution: Type.Optional(ExecutionParam), model: Type.Optional(ModelParam),
        cyclesPerDay: Type.Optional(Type.Union([Type.Literal(2), Type.Literal(3), Type.Literal(4)])), strategy: Type.String({ maxLength: 2000 }),
        watchlist: Type.Optional(Type.Array(Type.String({ pattern: "^[A-Z.]{1,10}$" }), { minItems: 1, maxItems: 30 })) }),
      structuredOutputSchema: Type.Object({ id: Type.String(), status: Type.String(), estimatedMinutes: Type.Number() }),
      async execute(args) {
        if (sim.list().some((run) => run.status === "running" || run.status === "queued")) throw new Error("A simulation is already active");
        const startDate = args.startDate ?? (args.scenario !== undefined || args.mode === "bootstrap" ? undefined : await sim.defaultStartDate(args.days));
        const run = await sim.start({ days: args.days, startingCash: 1200, cyclesPerDay: args.cyclesPerDay ?? 2,
          mode: args.mode ?? "historical", execution: args.execution ?? "realistic", model: args.model ?? "main",
          ...(args.scenario === undefined ? {} : { scenario: args.scenario }),
          ...(startDate === undefined ? {} : { startDate }),
          ...(args.seed === undefined ? {} : { seed: args.seed }),
          strategy: args.strategy, ...(args.watchlist === undefined ? {} : { watchlist: args.watchlist }) }, "agent");
        const result = { id: run.id, status: run.status, estimatedMinutes: (args.days * (args.cyclesPerDay ?? 2) + 1) * 2 };
        return { output: [{ type: "text", text: JSON.stringify(result) }], structuredOutput: jsonValue(result) };
      } }),
    defineTool({ name: "sim_results", description: "Read simulation progress, risk-adjusted metrics, equity, fills and the last five journal decisions. Simulations are synthetic paths, not reliable predictions of live performance.",
      parameters: Type.Object({ id: Type.String() }), replay: "safe",
      structuredOutputSchema: Type.Object({ id: Type.String(), status: Type.String(), progress: Type.Any(), metrics: Type.Any(), equity: Type.Any(), fills: Type.Array(Type.Any()), journal: Type.Array(Type.String()), error: Type.Union([Type.String(), Type.Null()]) }),
      async execute({ id }) {
        const run = sim.get(id); if (run === undefined) throw new Error("Unknown simulation");
        const result = { id, status: run.status, progress: run.progress, metrics: run.metrics ?? null,
          equity: { first: run.equity[0] ?? null, last: run.equity.at(-1) ?? null, days: run.equity.length }, fills: run.fills,
          journal: sim.journal(id).slice(0, 5).map((entry) => entry.summary), error: run.error ?? null };
        return { output: [{ type: "text", text: JSON.stringify(result) }], structuredOutput: jsonValue(result) };
      } }),
    defineTool({ name: "sim_scenarios", description: "List the named historical market regimes (crashes, bears, bulls, chop, rotations) available as simulation scenarios and suite markets. Read this before starting a suite so the scenarios cover different regimes.",
      parameters: Type.Object({}), replay: "safe",
      structuredOutputSchema: Type.Array(Type.Any()),
      async execute() {
        return { output: [{ type: "text", text: JSON.stringify(SCENARIOS) }], structuredOutput: jsonValue(SCENARIOS) };
      } }),
    defineTool({ name: "sim_suite_start", description: "Compare up to two variants (A against B) on the same markets. Each variant receives the same blind scenarios and seeded bootstrap markets. To test one change, vary only that factor; model, risk and strategy can all affect results. Agent suites hold at most 8 runs and default to the cheaper subagent model.",
      parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 80 }),
        scenarios: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 12 })),
        bootstrapRuns: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 })),
        scenarioMode: Type.Optional(Type.Union([Type.Literal("historical"), Type.Literal("blind")])),
        bootstrapDays: Type.Optional(Type.Integer({ minimum: 5, maximum: 120 })),
        cyclesPerDay: Type.Optional(Type.Union([Type.Literal(2), Type.Literal(3), Type.Literal(4)])),
        execution: Type.Optional(ExecutionParam),
        watchlist: Type.Optional(Type.Array(Type.String({ pattern: "^[A-Z.]{1,10}$" }), { minItems: 1, maxItems: 30 })),
        variants: Type.Array(Type.Object({ label: Type.String({ minLength: 1, maxLength: 24 }),
          strategy: Type.Optional(Type.String({ maxLength: 2000 })), risk: Type.Optional(Type.Any()), model: Type.Optional(ModelParam) }), { minItems: 1, maxItems: 2 }) }),
      structuredOutputSchema: Type.Object({ id: Type.String(), status: Type.String(), runs: Type.Integer() }),
      async execute(args) {
        if (suites === undefined) throw new Error("Simulation suites are unavailable");
        const suite = await suites.start({ name: args.name, scenarios: args.scenarios ?? [], bootstrapRuns: args.bootstrapRuns ?? 0,
          scenarioMode: args.scenarioMode ?? "blind", bootstrapDays: args.bootstrapDays ?? 40, startingCash: 1200,
          cyclesPerDay: args.cyclesPerDay ?? 2, execution: args.execution ?? "realistic",
          ...(args.watchlist === undefined ? {} : { watchlist: args.watchlist }), variants: args.variants }, "agent");
        const result = { id: suite.id, status: suite.status, runs: suite.runs.length };
        return { output: [{ type: "text", text: JSON.stringify(result) }], structuredOutput: jsonValue(result) };
      } }),
    defineTool({ name: "sim_suite_results", description: "Read a simulation suite's per-variant summary, the paired B-minus-A result, and per-run returns. The resampled range describes the completed pairs only. One pair cannot estimate uncertainty. Do not treat small samples or a range excluding zero as proof of a live trading edge.",
      parameters: Type.Object({ id: Type.String() }), replay: "safe",
      structuredOutputSchema: Type.Object({ id: Type.String(), status: Type.String(), summary: Type.Any(), comparison: Type.Any(), reading: Type.Union([Type.String(), Type.Null()]), runs: Type.Array(Type.Any()) }),
      async execute({ id }) {
        if (suites === undefined) throw new Error("Simulation suites are unavailable");
        const suite = suites.get(id); if (suite === undefined) throw new Error("Unknown simulation suite");
        const runs = suite.runs.map((entry) => {
          const run = sim.get(entry.runId);
          const metrics = run?.metrics;
          return { runId: entry.runId, variant: entry.variant,
            ...(entry.scenario === undefined ? {} : { scenario: entry.scenario }),
            ...(entry.seed === undefined ? {} : { seed: entry.seed }),
            mode: entry.mode, status: run?.status ?? "failed",
            ...(metrics === undefined ? {} : { returnPct: metrics.returnPct, excessPct: metrics.returnPct - metrics.benchmarkReturnPct }) };
        });
        const result = { id, status: suite.status, summary: suite.summary, comparison: suite.comparison ?? null, reading: comparisonReading(suite), runs };
        return { output: [{ type: "text", text: JSON.stringify(result) }], structuredOutput: jsonValue(result) };
      } }),
  ] });
}
