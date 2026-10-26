import { describe, expect, it } from "vitest";
import type { ChatMessage, JournalEntry, OrderRecord, SimMetrics, SimRun, SimRunConfig, SimSuite } from "@rh/shared";
import { applyEvent, emptyState } from "./reducer.ts";
import {
  applySimEvent,
  canReveal,
  compareLabels,
  comparisonReading,
  emptySim,
  envBadge,
  estimateMinutes,
  excessReturn,
  fillCost,
  formatEstimate,
  metricGroups,
  normalizedSeries,
  riskOverrides,
  runNumbers,
  runTitle,
  shownSymbol,
  startDateProblem,
  suiteProgress,
  upsertSuite,
  weekdaysAgo,
} from "./sim.ts";
import { fixtureOrder } from "./mock/fixtures.ts";

const baseConfig: SimRunConfig = {
  mode: "historical",
  execution: "realistic",
  model: "main",
  startDate: "2026-10-01",
  days: 5,
  startingCash: 1000,
  cyclesPerDay: 2,
};

const run = (id: string, over: Partial<Omit<SimRun, "config">> & { config?: Partial<SimRunConfig> } = {}): SimRun => {
  const { config: overConfig, ...rest } = over;
  return {
    id,
    createdAt: 1,
    startedBy: "user",
    config: { ...baseConfig, ...overConfig } as SimRunConfig,
    status: "running",
    progress: { day: 0, days: 5, cycle: 1, cyclesPerDay: 2 },
    equity: [],
    positions: [],
    fills: [],
    ...rest,
  };
};

const baseMetrics: SimMetrics = {
  returnPct: 1.5,
  benchmarkReturnPct: 0.5,
  maxDrawdownPct: 2,
  trades: 0,
  exposurePct: 0,
  ordersSubmitted: 0,
  ordersRejected: 0,
  roundTrips: 0,
  turnoverPct: 0,
  costsPaid: 0,
  costsPct: 0,
  riskBlocks: {},
};
const point = (date: string, equity: number, benchmark = 1000) => ({ date, equity, cash: 0, benchmark });
const msg = (id: string): ChatMessage => ({ id, at: 5, role: "assistant", text: id });
const entry = (id: string): JournalEntry => ({ id, at: 5, action: "hold", summary: id, rationale: "r", evidence: [] });

describe("live reducer isolation", () => {
  it("never lets a simulation message, order, or journal entry reach the live state", () => {
    let live = emptyState();
    const order: OrderRecord = fixtureOrder("sim-o", "pending_approval");
    live = applyEvent(live, { type: "message", message: msg("m"), simRunId: "r1" });
    live = applyEvent(live, { type: "order", order, simRunId: "r1" });
    live = applyEvent(live, { type: "journal", entry: entry("j"), simRunId: "r1" });
    live = applyEvent(live, { type: "delta", text: "hello", simRunId: "r1" });
    live = applyEvent(live, { type: "sim", run: run("r1") });
    expect(live).toEqual(emptyState());
    // A pending sim order must not show up as an approval to act on.
    expect(live.orders.filter((o) => o.status === "pending_approval")).toEqual([]);
  });

  it("still applies the same events when they carry no simRunId", () => {
    const live = applyEvent(emptyState(), { type: "message", message: msg("m") });
    expect(live.messages.map((m) => m.id)).toEqual(["m"]);
  });
});

describe("applySimEvent", () => {
  it("upserts runs by id and keeps the newest first", () => {
    let s = emptySim();
    s = applySimEvent(s, { type: "sim", run: run("a", { createdAt: 10 }) });
    s = applySimEvent(s, { type: "sim", run: run("b", { createdAt: 20 }) });
    s = applySimEvent(s, { type: "sim", run: run("a", { createdAt: 10, status: "done" }) });
    expect(s.runs.map((r) => [r.id, r.status])).toEqual([
      ["b", "running"],
      ["a", "done"],
    ]);
  });

  it("routes scoped events to that run's own feed and no other", () => {
    let s = emptySim();
    s = applySimEvent(s, { type: "message", message: msg("m1"), simRunId: "a" });
    s = applySimEvent(s, { type: "journal", entry: entry("j1"), simRunId: "b" });
    s = applySimEvent(s, { type: "order", order: fixtureOrder("o1", "submitted"), simRunId: "a" });
    expect(s.feeds.a?.messages.map((m) => m.id)).toEqual(["m1"]);
    expect(s.feeds.a?.orders.map((o) => o.id)).toEqual(["o1"]);
    expect(s.feeds.a?.journal).toEqual([]);
    expect(s.feeds.b?.journal.map((j) => j.id)).toEqual(["j1"]);
    expect(s.feeds.b?.messages).toEqual([]);
  });

  it("keeps a run's subagent transcript separate from its lead agent messages", () => {
    const s = applySimEvent(emptySim(), { type: "message", message: msg("sub"), conversationId: "c1", simRunId: "a" });
    expect(s.feeds.a?.messages).toEqual([]);
    expect(s.feeds.a?.transcripts.c1?.messages.map((m) => m.id)).toEqual(["sub"]);
  });

  it("ignores live events", () => {
    const s = applySimEvent(emptySim(), { type: "message", message: msg("live") });
    expect(s).toEqual(emptySim());
  });
});

describe("duration estimate", () => {
  it("is cycles times one and a half minutes", () => {
    expect(estimateMinutes(10, 2)).toBe(30);
    expect(estimateMinutes(60, 4)).toBe(360);
    expect(estimateMinutes(1, 2)).toBe(3);
  });
  it("words minutes and hours", () => {
    expect(formatEstimate(30)).toBe("about 30 min");
    expect(formatEstimate(90)).toBe("about 1 h 30 min");
    expect(formatEstimate(360)).toBe("about 6 h");
    expect(formatEstimate(0.2)).toBe("about 1 min");
  });
});

describe("normalizedSeries", () => {
  it("indexes equity to the starting cash with day 0 at 100", () => {
    const r = run("a", { config: { startDate: "2026-10-01", days: 3, startingCash: 1200, cyclesPerDay: 2 }, equity: [point("2026-10-01", 1260), point("2026-10-02", 1140)] });
    expect(normalizedSeries(r)).toEqual([
      { day: 0, value: 100 },
      { day: 1, value: 105 },
      { day: 2, value: 95 },
    ]);
  });
  it("lets runs with different start cash share one axis", () => {
    const small = normalizedSeries(run("s", { equity: [point("d", 1100)] }));
    const big = normalizedSeries(run("b", { config: { startDate: "x", days: 1, startingCash: 5000, cyclesPerDay: 2 }, equity: [point("d", 5500)] }));
    expect(small.at(-1)?.value).toBeCloseTo(110, 9);
    expect(big.at(-1)?.value).toBeCloseTo(110, 9);
  });
  it("is empty for a nonsensical starting cash", () => {
    expect(normalizedSeries(run("z", { config: { startDate: "x", days: 1, startingCash: 0, cyclesPerDay: 2 } }))).toEqual([]);
  });
});

describe("runNumbers", () => {
  it("derives return, benchmark and max drawdown from marks while a run has no metrics", () => {
    const r = run("a", { equity: [point("1", 1100, 1010), point("2", 990, 1020), point("3", 1050, 1030)] });
    const n = runNumbers(r)!;
    expect(n.returnPct).toBeCloseTo(5, 9);
    expect(n.benchmarkReturnPct).toBeCloseTo(3, 9);
    expect(n.maxDrawdownPct).toBeCloseTo(10, 9); // 1100 -> 990
  });
  it("prefers the server's metrics once the run has them", () => {
    const r = run("a", { equity: [point("1", 2000)], metrics: { ...baseMetrics } });
    expect(runNumbers(r)).toEqual({ returnPct: 1.5, benchmarkReturnPct: 0.5, maxDrawdownPct: 2 });
  });
  it("is null before the first close", () => {
    expect(runNumbers(run("a"))).toBeNull();
  });
});

describe("run titles", () => {
  it("uses the name, else the strategy's first six words, else the window", () => {
    expect(runTitle(run("a", { config: { name: " Gap fade ", startDate: "2026-10-01", days: 5, startingCash: 1, cyclesPerDay: 2 } }))).toBe("Gap fade");
    expect(runTitle(run("a", { config: { strategy: "Buy dips in quality names after gaps down", startDate: "2026-10-01", days: 5, startingCash: 1, cyclesPerDay: 2 } }))).toBe("Buy dips in quality names after…");
    expect(runTitle(run("a"))).toBe("5-day run from 2026-10-01");
  });
  it("disambiguates identical titles in the compare view", () => {
    expect(compareLabels([run("a"), run("b"), run("c")])).toEqual(["5-day run from 2026-10-01", "5-day run from 2026-10-01 (2)", "5-day run from 2026-10-01 (3)"]);
  });
});

describe("start date", () => {
  // 2026-10-24 is a Saturday.
  const sat = new Date("2026-10-24T12:00:00Z");
  it("counts weekdays back, skipping weekends", () => {
    expect(weekdaysAgo(1, sat)).toBe("2026-10-23");
    expect(weekdaysAgo(5, sat)).toBe("2026-10-19");
    expect(weekdaysAgo(15, sat)).toBe("2026-10-05");
  });
  it("flags a window that does not fit before today", () => {
    expect(startDateProblem("2026-10-05", 10, sat)).toBeNull();
    expect(startDateProblem("2026-10-19", 10, sat)).toBe("Only 5 trading days between 2026-10-19 and today");
    expect(startDateProblem("", 10, sat)).toBe("Pick a start date");
  });
});

describe("riskOverrides", () => {
  it("keeps only filled fields and reports invalid ones inline", () => {
    const res = riskOverrides({ maxPositions: "3", maxPositionPct: "", maxRiskPerTradePct: "-1" });
    expect(res.risk).toEqual({ maxPositions: 3 });
    expect(Object.keys(res.errors)).toEqual(["risk.maxRiskPerTradePct"]);
  });
  it("returns no risk object when nothing is overridden", () => {
    expect(riskOverrides({ maxPositions: " " })).toEqual({ risk: undefined, errors: {} });
  });
});

describe("metricGroups", () => {
  it("omits undefined metrics instead of dashing them", () => {
    const r = run("a", { equity: [point("1", 1100)], metrics: { ...baseMetrics } });
    const groups = metricGroups(r);
    const risk = groups.find((g) => g.title === "Return and risk")!;
    expect(risk.rows.map((x) => x.label)).toContain("Return");
    expect(risk.rows.map((x) => x.label)).not.toContain("Sharpe");
    expect(risk.rows.map((x) => x.label)).not.toContain("Alpha");
    expect(groups.some((g) => g.title === "Discipline")).toBe(false);
    expect(groups.some((g) => g.title === "Costs")).toBe(false);
  });
  it("shows each figure once: costs in dollars and percent, risk blocks as bars", () => {
    const r = run("a", {
      equity: [point("1", 1100)],
      metrics: {
        ...baseMetrics,
        returnPct: 5,
        benchmarkReturnPct: 1,
        sharpe: 1.2,
        costsPaid: 12.5,
        costsPct: 1.04,
        riskBlocks: { sector: 2, max_positions: 1 },
        brier: 0.2,
      },
    });
    const byTitle = new Map(metricGroups(r).map((g) => [g.title, g]));
    expect(byTitle.get("Costs")!.rows).toEqual([{ label: "Costs paid", text: "$12.50", sub: "1.04% of start" }]);
    const discipline = byTitle.get("Discipline")!.rows;
    expect(discipline[0]).toEqual({ label: "Risk blocks", bars: [{ label: "sector", value: 2 }, { label: "max_positions", value: 1 }] });
    expect(discipline[1]).toEqual({ label: "Brier", text: "0.200", sub: "lower is better" });
    expect(byTitle.get("Return and risk")!.rows.find((x) => x.label === "Sharpe")).toEqual({ label: "Sharpe", text: "1.20" });
  });
  it("is empty before the first close with no fills", () => {
    expect(metricGroups(run("z"))).toEqual([]);
  });
  it("shows a Fees row only when regulatory fees are above zero", () => {
    const withFees = run("a", {
      equity: [point("1", 1100)],
      metrics: { ...baseMetrics, costsPaid: 12.54, costsPct: 1.25, feesPaid: 0.04 },
    });
    expect(metricGroups(withFees).find((g) => g.title === "Costs")!.rows).toEqual([
      { label: "Costs paid", text: "$12.54", sub: "1.25% of start" },
      { label: "Fees", text: "$0.04" },
    ]);
    const zeroFees = run("b", {
      equity: [point("1", 1100)],
      metrics: { ...baseMetrics, costsPaid: 12.5, costsPct: 1.25, feesPaid: 0 },
    });
    expect(metricGroups(zeroFees).find((g) => g.title === "Costs")!.rows.map((r) => r.label)).not.toContain("Fees");
    const noFees = run("c", {
      equity: [point("1", 1100)],
      metrics: { ...baseMetrics, costsPaid: 12.5, costsPct: 1.25 },
    });
    expect(metricGroups(noFees).find((g) => g.title === "Costs")!.rows.map((r) => r.label)).not.toContain("Fees");
  });
});

describe("fillCost", () => {
  it("adds spread cost and regulatory fees into one full cost", () => {
    expect(fillCost({ cost: 0.1, fees: 0.04 })).toBeCloseTo(0.14, 9);
  });
  it("tolerates a fill that records only one of the two", () => {
    expect(fillCost({ cost: 0.1 })).toBeCloseTo(0.1, 9);
    expect(fillCost({ fees: 0.04 })).toBeCloseTo(0.04, 9);
  });
  it("is undefined when the fill records neither", () => {
    expect(fillCost({})).toBeUndefined();
  });
});

describe("comparisonReading", () => {
  const suite = (meanDiff: number, ci95: [number, number]): Pick<SimSuite, "config" | "comparison"> => ({
    config: {
      name: "s",
      scenarios: [],
      bootstrapRuns: 0,
      scenarioMode: "blind",
      bootstrapDays: 40,
      startingCash: 1200,
      cyclesPerDay: 2,
      execution: "realistic",
      variants: [{ label: "A" }, { label: "B" }],
    },
    comparison: { metric: "excessReturnPct", meanDiff, ci95, pairs: 2 },
  });
  it("reads an inconclusive lead plainly", () => {
    expect(comparisonReading(suite(0.8, [-0.3, 1.9]))).toEqual({
      text: "B beat A by 0.8 points; 95% interval −0.3 to 1.9; not conclusive",
      conclusive: false,
    });
  });
  it("calls an interval that excludes zero conclusive, either direction", () => {
    expect(comparisonReading(suite(1.4, [0.2, 2.6]))?.conclusive).toBe(true);
    expect(comparisonReading(suite(-1.1, [-2.0, -0.2]))).toEqual({
      text: "A beat B by 1.1 points; 95% interval −2.0 to −0.2; conclusive",
      conclusive: true,
    });
  });
  it("is null with no comparison", () => {
    expect(comparisonReading({ ...suite(0, [0, 0]), comparison: undefined })).toBeNull();
  });
});

describe("alias reveal", () => {
  const blind = () => run("b", { status: "done", config: { mode: "blind" }, aliases: { QX1: "SPY" } });
  it("maps aliases to real symbols only when revealed", () => {
    const r = blind();
    expect(shownSymbol(r, "QX1", false)).toBe("QX1");
    expect(shownSymbol(r, "QX1", true)).toBe("SPY");
    expect(shownSymbol(r, "MSFT", true)).toBe("MSFT");
  });
  it("is only offered on finished runs that carry aliases", () => {
    expect(canReveal(blind())).toBe(true);
    expect(canReveal(run("a"))).toBe(false);
    expect(canReveal(run("c", { status: "running", aliases: { QX1: "SPY" } }))).toBe(false);
  });
  it("tags blind and bootstrap headers", () => {
    expect(envBadge(blind())).toBe("Blind · fictional dates");
    expect(envBadge(run("d", { config: { mode: "bootstrap" }, seed: 7 }))).toBe("Bootstrap · seed 7");
    expect(envBadge(run("e"))).toBeNull();
  });
  it("derives excess return from finished metrics", () => {
    expect(excessReturn(run("a", { metrics: { ...baseMetrics, returnPct: 5, benchmarkReturnPct: 1 } }))).toBeCloseTo(4, 9);
    expect(excessReturn(run("a"))).toBeUndefined();
  });
});

describe("suite reducer", () => {
  const suite = (id: string): SimSuite => ({
    id,
    createdAt: 1,
    startedBy: "user",
    config: {
      name: id,
      scenarios: [],
      bootstrapRuns: 0,
      scenarioMode: "blind",
      bootstrapDays: 40,
      startingCash: 1200,
      cyclesPerDay: 2,
      execution: "realistic",
      variants: [{ label: "A" }],
    },
    status: "running",
    runs: [],
    summary: [],
  });
  it("upserts suites newest first on sim_suite events", () => {
    let s = applySimEvent(emptySim(), { type: "sim_suite", suite: suite("s1") });
    s = applySimEvent(s, { type: "sim_suite", suite: { ...suite("s2"), createdAt: 2 } });
    expect(s.suites.map((x) => x.id)).toEqual(["s2", "s1"]);
    s = applySimEvent(s, { type: "sim_suite", suite: { ...suite("s1"), status: "done" } });
    expect(s.suites.find((x) => x.id === "s1")?.status).toBe("done");
  });
  it("upserts suites with the same helper the store uses", () => {
    expect(upsertSuite([suite("s1")], { ...suite("s1"), status: "stopped" })[0]?.status).toBe("stopped");
  });
  it("counts finished member runs against the lab list", () => {
    const s = suite("s1");
    s.runs = [
      { runId: "r1", variant: "A", mode: "blind" },
      { runId: "r2", variant: "A", mode: "blind" },
    ];
    const runs = [run("r1", { status: "done" }), run("r2", { status: "running" })];
    expect(suiteProgress(s, runs)).toEqual({ done: 1, total: 2 });
  });
});
