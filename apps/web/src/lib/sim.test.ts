import { describe, expect, it } from "vitest";
import type { ChatMessage, JournalEntry, OrderRecord, SimRun } from "@rh/shared";
import { applyEvent, emptyState } from "./reducer.ts";
import {
  applySimEvent,
  compareLabels,
  emptySim,
  estimateMinutes,
  formatEstimate,
  normalizedSeries,
  riskOverrides,
  runNumbers,
  runTitle,
  startDateProblem,
  weekdaysAgo,
} from "./sim.ts";
import { fixtureOrder } from "./mock/fixtures.ts";

const run = (id: string, over: Partial<SimRun> = {}): SimRun => ({
  id,
  createdAt: 1,
  startedBy: "user",
  config: { startDate: "2026-10-01", days: 5, startingCash: 1000, cyclesPerDay: 2 },
  status: "running",
  progress: { day: 0, days: 5, cycle: 1, cyclesPerDay: 2 },
  equity: [],
  positions: [],
  fills: [],
  ...over,
});
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
    const r = run("a", { equity: [point("1", 2000)], metrics: { returnPct: 1.5, benchmarkReturnPct: 0.5, maxDrawdownPct: 2, trades: 0, exposurePct: 0, ordersSubmitted: 0, ordersRejected: 0 } });
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
