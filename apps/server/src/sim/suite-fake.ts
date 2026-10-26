import type { SimMetrics, SimRun, SimRunConfig } from "@rh/shared";
import type { EventBus } from "../ports.ts";
import type { SuiteRunner } from "./suite.ts";

export interface FinishSpec {
  status?: "done" | "failed" | "stopped";
  returnPct: number;
  benchmarkReturnPct?: number;
  maxDrawdownPct?: number;
  sharpe?: number;
  roundTrips?: number;
  winRatePct?: number;
  avgR?: number;
  costsPct?: number;
  brier?: number;
}

/** In-memory stand-in for the run service: starts runs instantly and finishes them on demand. */
export class FakeRunner implements SuiteRunner {
  runs = new Map<string, SimRun>();
  started: { config: SimRunConfig; startedBy: "user" | "agent"; options?: { suiteId?: string; variant?: string } }[] = [];
  seq = 0;
  bus: EventBus | undefined;

  constructor(bus?: EventBus) {
    this.bus = bus;
  }

  async start(
    config: Parameters<SuiteRunner["start"]>[0],
    startedBy: "user" | "agent",
    options?: { suiteId?: string; variant?: string },
  ): Promise<SimRun> {
    const full: SimRunConfig = { name: config.name, days: config.days ?? 40, startingCash: config.startingCash,
      cyclesPerDay: config.cyclesPerDay ?? 2, watchlist: config.watchlist, mode: config.mode ?? "historical",
      execution: config.execution ?? "realistic", seed: config.seed, model: config.model ?? "main",
      scenario: config.scenario, startDate: config.startDate, strategy: config.strategy, risk: config.risk };
    const id = `fake-run-${++this.seq}`;
    const run: SimRun = { id, createdAt: Date.now(), startedBy, config: full, seed: full.seed,
      suiteId: options?.suiteId, variant: options?.variant, status: "queued",
      progress: { day: 0, days: full.days, cycle: 0, cyclesPerDay: full.cyclesPerDay }, equity: [], positions: [], fills: [] };
    this.runs.set(id, run);
    this.started.push({ config: full, startedBy, options });
    this.publish(run);
    return structuredClone(run);
  }

  get(id: string): SimRun | undefined {
    const run = this.runs.get(id);
    return run === undefined ? undefined : structuredClone(run);
  }

  async stop(id: string): Promise<SimRun | undefined> {
    const run = this.runs.get(id);
    if (run === undefined) return undefined;
    if (run.status === "queued" || run.status === "running") {
      run.status = "stopped";
      run.finishedAt = Date.now();
      this.publish(run);
    }
    return structuredClone(run);
  }

  /** Complete a run with synthetic metrics and publish its `sim` event. */
  finish(id: string, spec: FinishSpec): SimRun {
    const run = this.runs.get(id);
    if (run === undefined) throw new Error(`unknown run ${id}`);
    run.equity = [{ date: "2020-01-02", equity: 1200, cash: 1200, benchmark: 1200 }];
    const metrics: SimMetrics = { returnPct: spec.returnPct, benchmarkReturnPct: spec.benchmarkReturnPct ?? 0,
      maxDrawdownPct: spec.maxDrawdownPct ?? 1, trades: 0, exposurePct: 50, ordersSubmitted: 0, ordersRejected: 0,
      roundTrips: spec.roundTrips ?? 0, turnoverPct: 0, costsPaid: 0, costsPct: spec.costsPct ?? 0, riskBlocks: {},
      ...(spec.sharpe === undefined ? {} : { sharpe: spec.sharpe }),
      ...(spec.winRatePct === undefined ? {} : { winRatePct: spec.winRatePct }),
      ...(spec.avgR === undefined ? {} : { avgR: spec.avgR }),
      ...(spec.brier === undefined ? {} : { brier: spec.brier }) };
    run.metrics = metrics;
    run.status = spec.status ?? "done";
    run.finishedAt = Date.now();
    this.publish(run);
    return structuredClone(run);
  }

  private publish(run: SimRun): void {
    this.bus?.publish({ type: "sim", run: structuredClone(run) });
  }
}
