import type {
  ChatMessage,
  JournalEntry,
  OrderRecord,
  Position,
  ServerEvent,
  SimEquityPoint,
  SimFill,
  SimMetrics,
  SimMode,
  SimRun,
  SimRunConfig,
  SimScenario,
  SimSuite,
  SimSuiteConfig,
  SimSuiteVariantSummary,
} from "@rh/shared";
import { ApiError } from "../api.ts";
import { startDateProblem, weekdaysAgo } from "../sim.ts";
import { fixtureJournal, fixtureMessages, fixtureOrder } from "./fixtures.ts";
import { runWork } from "./work.ts";

/** Dev-only paper-run fixtures and a tiny simulator (VITE_MOCK_API=1). */

export const SCENARIOS: SimScenario[] = [
  { id: "covid-crash", name: "COVID crash", description: "Tests nerve in a −34% freefall and the speed of the rebound.", startDate: "2020-02-19", days: 40, regime: "crash" },
  { id: "bear-2022", name: "2022 bear", description: "Rate shock grinds growth lower for months with brief relief rallies.", startDate: "2022-01-03", days: 60, regime: "bear" },
  { id: "bull-2023", name: "2023 AI bull", description: "A narrow megacap-led melt-up that punishes diversification.", startDate: "2023-01-03", days: 60, regime: "bull" },
  { id: "chop-2015", name: "2015 chop", description: "Directionless chop with two sharp drawdowns that shake out trend followers.", startDate: "2015-05-01", days: 60, regime: "chop" },
  { id: "rotation-2021", name: "2021 rotation", description: "Value beats growth as yields rise; momentum names lag the index.", startDate: "2021-01-04", days: 60, regime: "rotation" },
  { id: "shock-2020", name: "Election shock", description: "Overnight gap risk around a contested vote with a fast resolution.", startDate: "2020-10-01", days: 30, regime: "shock" },
];

const WATCH = ["SPY", "QQQ", "NVDA", "MSFT", "JPM", "XLE"];

/** Next weekday after `iso`. */
function nextWeekday(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

function dates(start: string, n: number): string[] {
  const out: string[] = [];
  let d = start;
  for (let i = 0; i < n; i++) {
    out.push(d);
    d = nextWeekday(d);
  }
  return out;
}

/** Deterministic wobble so fixtures look the same on every reload. */
const wobble = (i: number, seed: number) => Math.sin(i * 1.7 + seed) * 0.6 + Math.cos(i * 0.9 + seed * 2) * 0.4;

function curve(start: string, n: number, cash: number, drift: number, vol: number, seed: number): SimEquityPoint[] {
  let eq = cash;
  let spy = cash;
  return dates(start, n).map((date, i) => {
    eq *= 1 + (drift + wobble(i, seed) * vol) / 100;
    spy *= 1 + (0.09 + wobble(i, 1.3) * 0.55) / 100;
    return { date, equity: +eq.toFixed(2), cash: +(eq * (0.35 + 0.1 * Math.sin(i))).toFixed(2), benchmark: +spy.toFixed(2) };
  });
}

function metricsFrom(
  equity: SimEquityPoint[],
  cash: number,
  fills: SimFill[],
  rejected: number,
  riskBlocks: Record<string, number> = {},
): SimMetrics {
  const last = equity.at(-1)!;
  let peak = cash;
  let dd = 0;
  for (const p of equity) {
    peak = Math.max(peak, p.equity);
    dd = Math.max(dd, ((peak - p.equity) / peak) * 100);
  }
  const rets = equity.map((p, i) => p.equity / (equity[i - 1]?.equity ?? cash) - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) || 1;
  const down = rets.filter((r) => r < 0);
  const downside = Math.sqrt(down.reduce((a, b) => a + b * b, 0) / rets.length) || sd;
  const returnPct = (last.equity / cash - 1) * 100;
  const benchmarkReturnPct = (last.benchmark / cash - 1) * 100;
  const roundTrips = fills.filter((f) => f.side === "sell").length;
  const costsPaid = +fills.reduce((a, f) => a + (f.cost ?? 0), 0).toFixed(2);
  const notional = fills.reduce((a, f) => a + f.quantity * f.price, 0);
  const avgEq = equity.reduce((a, p) => a + p.equity, 0) / equity.length;
  const turnoverPct = avgEq > 0 ? +((notional / avgEq) * 100).toFixed(1) : 0;
  const costsPct = cash > 0 ? +((costsPaid / cash) * 100).toFixed(2) : 0;
  return {
    returnPct,
    benchmarkReturnPct,
    maxDrawdownPct: dd,
    ...(equity.length >= 5
      ? {
          sharpe: +((mean / sd) * Math.sqrt(252)).toFixed(2),
          sortino: +((mean / downside) * Math.sqrt(252)).toFixed(2),
          volatilityPct: +(sd * Math.sqrt(252) * 100).toFixed(1),
        }
      : {}),
    ...(dd > 0.05 ? { calmar: +(((returnPct / 100) * (252 / equity.length)) / (dd / 100)).toFixed(2) } : {}),
    trades: fills.length,
    winRatePct: 57,
    avgR: 0.42,
    beta: 0.9,
    alphaPct: returnPct - 0.9 * benchmarkReturnPct,
    roundTrips,
    profitFactor: 1.6,
    expectancy: roundTrips ? +((last.equity - cash) / roundTrips).toFixed(2) : 0,
    avgHoldingDays: 2.4,
    turnoverPct,
    costsPaid,
    costsPct,
    exposurePct: 48.6,
    ordersSubmitted: fills.length + 2,
    ordersRejected: rejected,
    brier: 0.21,
    riskBlocks,
  };
}

function fillsFor(equity: SimEquityPoint[], plan: [number, string, "buy" | "sell", number, number][], realistic = true): SimFill[] {
  return plan.flatMap(([i, symbol, side, quantity, price], n) => {
    const p = equity[i];
    if (!p) return [];
    const cost = realistic ? +(quantity * price * 0.0008).toFixed(2) : 0;
    const mid = realistic ? +(price + ((side === "buy" ? -cost : cost) / quantity)).toFixed(2) : price;
    return [
      {
        at: new Date(`${p.date}T15:05:00Z`).getTime(),
        date: p.date,
        symbol,
        side,
        quantity,
        price,
        orderId: `sim-ord-${n}`,
        mid,
        cost,
      },
    ];
  });
}

const POSITIONS: Position[] = [
  { symbol: "MSFT", quantity: 1, averageCost: 413.2, marketValue: 421.8, unrealizedPnl: 8.6, sector: "Technology" },
  { symbol: "XLE", quantity: 4, averageCost: 92.1, marketValue: 366.4, unrealizedPnl: -2.0, sector: "Energy" },
];

export function simFixtures(now = Date.now()): SimRun[] {
  const doneStart = weekdaysAgo(24);
  const doneEq = curve(doneStart, 10, 1200, 0.4, 1.9, 1);
  const doneFills = fillsFor(doneEq, [
    [0, "MSFT", "buy", 1, 413.2],
    [1, "XLE", "buy", 4, 92.1],
    [3, "NVDA", "buy", 6, 131.4],
    [5, "NVDA", "sell", 6, 138.9],
    [6, "JPM", "buy", 2, 243.1],
    [8, "XLE", "sell", 4, 93.6],
    [9, "JPM", "sell", 2, 249.4],
  ]);
  const done: SimRun = {
    id: "sim-momentum",
    createdAt: now - 3 * 3_600_000,
    startedBy: "user",
    config: { name: "Momentum on megacaps", mode: "historical", execution: "realistic", model: "main", startDate: doneStart, days: 10, startingCash: 1200, cyclesPerDay: 2, watchlist: WATCH, strategy: "Only buy names above the 20 day with relative strength vs QQQ. Take profit into +6%." },
    status: "done",
    currentDate: doneEq.at(-1)!.date,
    progress: { day: 10, days: 10, cycle: 2, cyclesPerDay: 2 },
    equity: doneEq,
    positions: POSITIONS,
    fills: doneFills,
    metrics: metricsFrom(doneEq, 1200, doneFills, 3, { max_positions: 2, sector: 1 }),
    finishedAt: now - 3 * 3_600_000 + 31 * 60_000,
  };

  const agentStart = weekdaysAgo(21);
  const agentEq = curve(agentStart, 8, 1200, -0.08, 1.1, 4);
  const agentFills = fillsFor(agentEq, [
    [0, "JPM", "buy", 3, 241.3],
    [2, "XLE", "buy", 5, 91.8],
    [4, "JPM", "sell", 3, 238.9],
    [6, "XLE", "sell", 5, 90.4],
  ]);
  const byAgent: SimRun = {
    id: "sim-defensive",
    createdAt: now - 26 * 3_600_000,
    startedBy: "agent",
    config: { mode: "historical", execution: "realistic", model: "subagent", startDate: agentStart, days: 8, startingCash: 1200, cyclesPerDay: 3, watchlist: WATCH, strategy: "Test whether a defensive tilt into financials and energy beats SPY when VIX is falling." },
    status: "done",
    currentDate: agentEq.at(-1)!.date,
    progress: { day: 8, days: 8, cycle: 3, cyclesPerDay: 3 },
    equity: agentEq,
    positions: [],
    fills: agentFills,
    metrics: metricsFrom(agentEq, 1200, agentFills, 1),
    finishedAt: now - 25 * 3_600_000,
  };

  const runStart = weekdaysAgo(18);
  const runEq = curve(runStart, 3, 1200, 0.3, 1.2, 7);
  const runFills = fillsFor(runEq, [
    [0, "NVDA", "buy", 5, 128.2],
    [1, "MSFT", "buy", 1, 409.9],
  ]);
  const running: SimRun = {
    id: "sim-gaps",
    createdAt: now - 9 * 60_000,
    startedBy: "user",
    config: { name: "Gap-down reversion", mode: "historical", execution: "realistic", model: "main", startDate: runStart, days: 12, startingCash: 1200, cyclesPerDay: 3, watchlist: WATCH, strategy: "Buy quality names after a gap down of 2% or more on no news. Exit on the gap fill or day 3." },
    status: "running",
    currentDate: nextWeekday(runEq.at(-1)!.date),
    progress: { day: 4, days: 12, cycle: 2, cyclesPerDay: 3 },
    equity: runEq,
    positions: POSITIONS.slice(0, 1),
    fills: runFills,
  };
  // A finished blind run: fictional calendar, aliased tickers, revealed at the end.
  const blindDates = dates("2034-02-05", 10);
  const blindEq = curve("2034-02-05", 10, 1200, 0.52, 1.6, 9);
  const blindFills = fillsFor(blindEq, [
    [0, "QX1", "buy", 8, 102.4],
    [2, "QZ7", "buy", 3, 244.8],
    [4, "QX1", "sell", 8, 109.1],
    [7, "QZ7", "sell", 3, 251.3],
  ]);
  const blind: SimRun = {
    id: "sim-blind-crash",
    createdAt: now - 5 * 3_600_000,
    startedBy: "user",
    config: {
      name: "Blind crash test",
      scenario: "covid-crash",
      mode: "blind",
      execution: "realistic",
      model: "main",
      seed: 11,
      startDate: "2020-02-19",
      days: 10,
      startingCash: 1200,
      cyclesPerDay: 2,
      watchlist: WATCH,
      strategy: "Same momentum rules, but the model cannot see the dates or tickers.",
    },
    seed: 11,
    aliases: { QX1: "SPY", QZ7: "JPM", QA4: "XLE", QB2: "MSFT" },
    calendar: { firstDay: blindDates[0]!, sourceStart: "2020-02-19", sourceEnd: "2020-03-03" },
    status: "done",
    currentDate: blindEq.at(-1)!.date,
    progress: { day: 10, days: 10, cycle: 2, cyclesPerDay: 2 },
    equity: blindEq,
    positions: [],
    fills: blindFills,
    metrics: metricsFrom(blindEq, 1200, blindFills, 2, { max_positions: 1 }),
    finishedAt: now - 4 * 3_600_000,
  };

  // A finished bootstrap run on a synthetic market.
  const bootEq = curve("2037-06-01", 12, 1200, 0.18, 2.4, 7);
  const bootFills = fillsFor(bootEq, [
    [1, "QA4", "buy", 5, 88.2],
    [3, "QB2", "buy", 1, 401.5],
    [6, "QA4", "sell", 5, 91.7],
    [9, "QB2", "sell", 1, 398.2],
  ]);
  const boot: SimRun = {
    id: "sim-boot-7",
    createdAt: now - 8 * 3_600_000,
    startedBy: "user",
    config: {
      name: "Bootstrap market 7",
      mode: "bootstrap",
      execution: "realistic",
      model: "subagent",
      seed: 7,
      days: 12,
      startingCash: 1200,
      cyclesPerDay: 2,
      watchlist: WATCH,
      strategy: "Defensive rules on synthetic resampled returns.",
    },
    seed: 7,
    aliases: { QA4: "XLE", QB2: "MSFT", QX1: "SPY" },
    calendar: { firstDay: "2037-06-01", sourceStart: "2015-01-02", sourceEnd: "2025-12-31" },
    status: "done",
    currentDate: bootEq.at(-1)!.date,
    progress: { day: 12, days: 12, cycle: 2, cyclesPerDay: 2 },
    equity: bootEq,
    positions: [],
    fills: bootFills,
    metrics: metricsFrom(bootEq, 1200, bootFills, 0),
    finishedAt: now - 7 * 3_600_000,
  };

  return [running, done, blind, boot, byAgent];
}

/** Deterministic suite member: one variant on one market. */
function suiteMember(
  id: string,
  createdAt: number,
  opts: { variant: string; scenario?: string; seed?: number; mode: SimMode; drift: number; seedN: number; days: number; firstDay: string },
): SimRun {
  const eq = curve(opts.firstDay, opts.days, 1200, opts.drift, 1.7, opts.seedN);
  const fills = fillsFor(eq, [
    [1, "QX1", "buy", 6, 101.2],
    [Math.min(4, opts.days - 2), "QX1", "sell", 6, 101.2 * (1 + opts.drift / 8)],
  ]);
  return {
    id,
    createdAt,
    startedBy: "user",
    config: {
      mode: opts.mode,
      execution: "realistic",
      model: "main",
      ...(opts.scenario ? { scenario: opts.scenario } : {}),
      ...(opts.mode === "bootstrap" ? {} : { startDate: opts.firstDay }),
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      days: opts.days,
      startingCash: 1200,
      cyclesPerDay: 2,
      watchlist: WATCH,
      strategy: opts.variant === "A" ? "Momentum on megacaps." : "Defensive tilt into staples and energy.",
    },
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts.mode === "historical" ? {} : { aliases: { QX1: "SPY", QZ7: "JPM" } }),
    suiteId: "suite-momentum-defensive",
    variant: opts.variant,
    status: "done",
    currentDate: eq.at(-1)!.date,
    progress: { day: opts.days, days: opts.days, cycle: 2, cyclesPerDay: 2 },
    equity: eq,
    positions: [],
    fills,
    metrics: metricsFrom(eq, 1200, fills, opts.seedN % 2, { sector: opts.seedN % 3 }),
    finishedAt: createdAt + opts.days * 60_000,
  };
}

function summarize(label: string, members: SimRun[]): SimSuiteVariantSummary {
  const finished = members.filter((r) => r.metrics && (r.status === "done" || r.status === "stopped" || r.status === "failed"));
  const rets = finished.map((r) => r.metrics!.returnPct).sort((a, b) => a - b);
  const excess = finished.map((r) => r.metrics!.returnPct - r.metrics!.benchmarkReturnPct);
  const quant = (q: number) => (rets.length ? rets[Math.min(rets.length - 1, Math.floor(q * rets.length))]! : undefined);
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : undefined;
  const median = rets.length ? (rets.length % 2 ? rets[(rets.length - 1) / 2]! : (rets[rets.length / 2 - 1]! + rets[rets.length / 2]!) / 2) : undefined;
  const sharpes = finished.map((r) => r.metrics!.sharpe).filter((x): x is number => x !== undefined).sort((a, b) => a - b);
  const wins = finished.filter((r) => (r.metrics!.winRatePct ?? 0) >= 50).length;
  return {
    label,
    runs: members.length,
    done: finished.length,
    failed: members.filter((r) => r.status === "failed").length,
    meanReturnPct: mean !== undefined ? +mean.toFixed(2) : undefined,
    medianReturnPct: median !== undefined ? +median.toFixed(2) : undefined,
    p10ReturnPct: quant(0.1) !== undefined ? +quant(0.1)!.toFixed(2) : undefined,
    p90ReturnPct: quant(0.9) !== undefined ? +quant(0.9)!.toFixed(2) : undefined,
    meanExcessPct: excess.length ? +(excess.reduce((a, b) => a + b, 0) / excess.length).toFixed(2) : undefined,
    beatBenchmarkPct: finished.length ? +((excess.filter((e) => e > 0).length / finished.length) * 100).toFixed(1) : undefined,
    worstDrawdownPct: finished.length ? +Math.max(...finished.map((r) => r.metrics!.maxDrawdownPct)).toFixed(2) : undefined,
    medianSharpe: sharpes.length ? sharpes[Math.floor(sharpes.length / 2)] : undefined,
    winRatePct: finished.length ? Math.round((wins / finished.length) * 100) : undefined,
    avgR: finished.length ? +(finished.reduce((a, r) => a + (r.metrics!.avgR ?? 0), 0) / finished.length).toFixed(2) : undefined,
    costsPct: finished.length ? +(finished.reduce((a, r) => a + r.metrics!.costsPct, 0) / finished.length).toFixed(2) : undefined,
    brier: 0.22,
  };
}

export function suiteFixtures(now = Date.now()): { suites: SimSuite[]; members: SimRun[] } {
  const a1 = suiteMember("sim-suite-a1", now - 50 * 3_600_000, { variant: "A", scenario: "covid-crash", mode: "blind", drift: 0.42, seedN: 21, days: 10, firstDay: "2034-02-05" });
  const b1 = suiteMember("sim-suite-b1", now - 50 * 3_600_000, { variant: "B", scenario: "covid-crash", mode: "blind", drift: 0.55, seedN: 22, days: 10, firstDay: "2034-02-05" });
  const a2 = suiteMember("sim-suite-a2", now - 49 * 3_600_000, { variant: "A", scenario: "bull-2023", mode: "blind", drift: 0.38, seedN: 23, days: 10, firstDay: "2034-03-04" });
  const b2 = suiteMember("sim-suite-b2", now - 49 * 3_600_000, { variant: "B", scenario: "bull-2023", mode: "blind", drift: 0.61, seedN: 24, days: 10, firstDay: "2034-03-04" });
  const members = [a1, b1, a2, b2];
  const summaryA = summarize("A", [a1, a2]);
  const summaryB = summarize("B", [b1, b2]);
  const meanDiff = (summaryB.meanExcessPct ?? 0) - (summaryA.meanExcessPct ?? 0);
  const suite: SimSuite = {
    id: "suite-momentum-defensive",
    createdAt: now - 50 * 3_600_000,
    startedBy: "user",
    config: {
      name: "Momentum vs defensive",
      scenarios: ["covid-crash", "bull-2023"],
      bootstrapRuns: 0,
      scenarioMode: "blind",
      bootstrapDays: 40,
      startingCash: 1200,
      cyclesPerDay: 2,
      execution: "realistic",
      variants: [
        { label: "A", strategy: "Momentum on megacaps.", model: "main" },
        { label: "B", strategy: "Defensive tilt into staples and energy.", model: "subagent" },
      ],
    },
    status: "done",
    runs: [
      { runId: "sim-suite-a1", variant: "A", scenario: "covid-crash", mode: "blind" },
      { runId: "sim-suite-b1", variant: "B", scenario: "covid-crash", mode: "blind" },
      { runId: "sim-suite-a2", variant: "A", scenario: "bull-2023", mode: "blind" },
      { runId: "sim-suite-b2", variant: "B", scenario: "bull-2023", mode: "blind" },
    ],
    summary: [summaryA, summaryB],
    comparison: { metric: "excessReturnPct", meanDiff: +meanDiff.toFixed(2), ci95: [-0.3, 1.9], pairs: 2 },
    finishedAt: now - 48 * 3_600_000,
  };
  return { suites: [suite], members };
}

export interface SimHost {
  emit(event: ServerEvent): void;
}

/** In-memory simulator behind the lab routes. */
export function createMockSim(host: SimHost) {
  const seedRuns = [...simFixtures(), ...suiteFixtures().members];
  const runs = new Map<string, SimRun>(seedRuns.map((r) => [r.id, r]));
  const seedSuites = suiteFixtures().suites;
  const suites = new Map<string, SimSuite>(seedSuites.map((s) => [s.id, s]));
  const feeds = new Map<string, { messages: ChatMessage[]; journal: JournalEntry[]; orders: OrderRecord[] }>();
  const timers = new Set<ReturnType<typeof setInterval>>();
  let seq = 1;

  const sorted = () => [...runs.values()].sort((a, b) => b.createdAt - a.createdAt);
  const sortedSuites = () => [...suites.values()].sort((a, b) => b.createdAt - a.createdAt);
  const publishSuite = (suite: SimSuite) => {
    suites.set(suite.id, suite);
    host.emit({ type: "sim_suite", suite });
  };
  const publish = (run: SimRun) => {
    runs.set(run.id, run);
    host.emit({ type: "sim", run });
    // A suite member finishing moves its suite's progress and summary.
    if (run.suiteId) {
      const suite = suites.get(run.suiteId);
      if (suite) {
        const members = suite.runs.map((e) => runs.get(e.runId)).filter((r): r is SimRun => !!r);
        const terminal = members.filter((r) => r.status === "done" || r.status === "failed" || r.status === "stopped");
        const byVariant = new Map<string, SimRun[]>();
        for (const m of members) {
          const list = byVariant.get(m.variant ?? "") ?? [];
          list.push(m);
          byVariant.set(m.variant ?? "", list);
        }
        const summary = suite.config.variants.map((v) => summarize(v.label, byVariant.get(v.label) ?? []));
        const finished = terminal.length === members.length && members.length > 0;
        publishSuite({
          ...suite,
          status: finished ? "done" : members.some((r) => r.status === "failed") ? "failed" : "running",
          summary,
          ...(finished ? { finishedAt: Date.now() } : {}),
        });
      }
    }
  };
  const feedOf = (id: string) => {
    let f = feeds.get(id);
    if (!f) {
      const t = Date.now();
      const messages = fixtureMessages()
        .slice(0, 8)
        .map((m) => ({ ...m, id: `${id}-${m.id}`, text: m.text.replace(/2026-10-23/g, runs.get(id)?.currentDate ?? "2026-10-02") }));
      const journal = fixtureJournal().slice(0, 3).map((j) => ({ ...j, id: `${id}-${j.id}`, at: t - 600_000 }));
      const orders = [fixtureOrder(`${id}-ord-1`, "submitted")];
      f = { messages, journal, orders };
      feeds.set(id, f);
    }
    return f;
  };

  /** Advance one cycle; at the last cycle of a day append the close mark. */
  function step(id: string) {
    const run = runs.get(id);
    if (!run || run.status !== "running") return false;
    let { day, cycle } = run.progress;
    const { days, cyclesPerDay } = run.progress;
    const equity = [...run.equity];
    if (cycle >= cyclesPerDay) {
      const prev = equity.at(-1)!;
      const eq = +(prev.equity * (1 + (0.25 + wobble(equity.length, 3) * 0.9) / 100)).toFixed(2);
      equity.push({
        date: run.currentDate ?? prev.date,
        equity: eq,
        cash: +(eq * 0.4).toFixed(2),
        benchmark: +(prev.benchmark * (1 + (0.08 + wobble(equity.length, 1.3) * 0.5) / 100)).toFixed(2),
      });
      day += 1;
      cycle = 1;
    } else cycle += 1;
    const next: SimRun = {
      ...run,
      equity,
      progress: { ...run.progress, day: Math.min(day, days), cycle },
      currentDate: cycle === 1 ? nextWeekday(run.currentDate ?? equity.at(-1)!.date) : run.currentDate,
    };
    if (day >= days) {
      const full = { ...next, status: "done" as const, finishedAt: Date.now() };
      // A natural finish reveals the tickers on blind and bootstrap runs.
      const revealed: SimRun =
        full.config.mode === "historical" || full.aliases
          ? full
          : { ...full, aliases: { QX1: "SPY", QZ7: "JPM", QA4: "XLE" } };
      publish({ ...revealed, metrics: metricsFrom(equity, run.config.startingCash, run.fills, 0) });
      return false;
    }
    publish(next);
    return true;
  }

  function drive(id: string, everyMs: number) {
    const timer = setInterval(() => {
      if (!step(id)) {
        clearInterval(timer);
        timers.delete(timer);
      }
    }, everyMs);
    timers.add(timer);
  }

  /** Scripted agent work for a run, with every event tagged to it. */
  function work(id: string, opts: { pace?: number; hold?: boolean }) {
    const f = feedOf(id);
    const subRuns = new Map();
    const transcripts = new Map<string, ChatMessage[]>();
    void runWork(
      {
        emit: (e) => host.emit({ ...e, simRunId: id } as ServerEvent),
        addMessage: (m) => {
          const message: ChatMessage = { id: `${id}-w${seq++}`, at: Date.now(), ...m };
          f.messages.push(message);
          host.emit({ type: "message", message, simRunId: id });
          return message;
        },
        setRunning: () => {},
        reply: () => {
          const message: ChatMessage = {
            id: `${id}-w${seq++}`,
            at: Date.now(),
            role: "assistant",
            text: "Gap fill on NVDA did not hold above the open. Staying in cash until the next cycle; the MSFT lot is inside its stop.",
          };
          f.messages.push(message);
          host.emit({ type: "message", message, simRunId: id });
        },
        runs: subRuns,
        transcripts,
      },
      opts,
    );
  }

  const first = runs.get("sim-gaps")!;

  return {
    list: () => sorted(),
    get: (id: string) => {
      const r = runs.get(id);
      if (!r) throw new ApiError(404, "run not found");
      return r;
    },
    start(config: SimRunConfig): SimRun {
      const mode = config.mode ?? "historical";
      const scenario = config.scenario ? SCENARIOS.find((s) => s.id === config.scenario) : undefined;
      if (config.scenario && !scenario) throw new ApiError(400, "Unknown scenario");
      const resolvedStart = config.startDate ?? scenario?.startDate;
      const resolvedDays = config.days ?? scenario?.days ?? 10;
      if (mode !== "bootstrap") {
        const problem = startDateProblem(resolvedStart, resolvedDays);
        if (problem) throw new ApiError(400, problem);
      }
      const id = `sim-new-${seq++}`;
      const seed = config.seed ?? Math.floor(Math.random() * 2_147_483_647);
      const firstDay = mode === "bootstrap" ? "2037-06-01" : (resolvedStart ?? weekdaysAgo(1));
      const run: SimRun = {
        id,
        createdAt: Date.now(),
        startedBy: "user",
        config: { ...config, days: resolvedDays, ...(resolvedStart ? { startDate: resolvedStart } : {}) },
        seed,
        ...(mode === "historical" ? {} : { aliases: { QX1: "SPY", QZ7: "JPM", QA4: "XLE" } }),
        ...(mode === "historical" ? {} : { calendar: { firstDay, sourceStart: resolvedStart ?? scenario?.startDate, sourceEnd: resolvedStart } }),
        status: "running",
        currentDate: firstDay,
        progress: { day: 0, days: resolvedDays, cycle: 1, cyclesPerDay: config.cyclesPerDay },
        equity: [],
        positions: [],
        fills: [],
      };
      publish(run);
      drive(id, 1600);
      return run;
    },
    stop(id: string): SimRun {
      const r = runs.get(id);
      if (!r) throw new ApiError(404, "run not found");
      const finishing = r.status === "running" && !r.metrics;
      const withMetrics: SimRun = finishing
        ? {
            ...r,
            metrics: metricsFrom(
              r.equity.length
                ? r.equity
                : [{ date: r.currentDate ?? "2026-10-01", equity: r.config.startingCash, cash: r.config.startingCash, benchmark: r.config.startingCash }],
              r.config.startingCash,
              r.fills,
              0,
            ),
          }
        : r;
      // Stopping reveals the tickers, like a natural finish.
      const revealed: SimRun =
        withMetrics.config.mode === "historical" || withMetrics.aliases
          ? { ...withMetrics, status: "stopped", finishedAt: Date.now() }
          : { ...withMetrics, status: "stopped", finishedAt: Date.now(), aliases: { QX1: "SPY", QZ7: "JPM", QA4: "XLE" } };
      publish(revealed);
      return revealed;
    },
    scenarios: () => SCENARIOS,
    suites: () => sortedSuites(),
    suite: (id: string) => {
      const s = suites.get(id);
      if (!s) throw new ApiError(404, "suite not found");
      return s;
    },
    suiteStart(config: SimSuiteConfig): SimSuite {
      if (!config.name.trim()) throw new ApiError(400, "Name the suite");
      if (!config.variants.length) throw new ApiError(400, "Add at least one variant");
      const id = `suite-new-${seq++}`;
      const createdAt = Date.now();
      const entries: SimSuite["runs"] = [];
      const mkRun = (variant: string, scenario: string | undefined, seed: number | undefined, mode: SimMode) => {
        const runId = `${id}-r${seq++}`;
        const sc = scenario ? SCENARIOS.find((s) => s.id === scenario) : undefined;
        const days = mode === "bootstrap" ? config.bootstrapDays : (sc?.days ?? 20);
        const firstDay = mode === "bootstrap" ? "2037-06-01" : (sc?.startDate ?? weekdaysAgo(1));
        const run: SimRun = {
          id: runId,
          createdAt,
          startedBy: "user",
          config: {
            ...(scenario ? { scenario } : {}),
            mode,
            execution: config.execution,
            model: config.variants.find((v) => v.label === variant)?.model ?? "main",
            seed,
            ...(mode === "bootstrap" ? {} : { startDate: sc?.startDate ?? weekdaysAgo(1) }),
            days,
            startingCash: config.startingCash,
            cyclesPerDay: config.cyclesPerDay,
            watchlist: config.watchlist,
            strategy: config.variants.find((v) => v.label === variant)?.strategy,
          },
          ...(seed !== undefined ? { seed } : {}),
          ...(mode === "historical" ? {} : { aliases: { QX1: "SPY", QZ7: "JPM" } }),
          suiteId: id,
          variant,
          status: "running",
          currentDate: firstDay,
          progress: { day: 0, days, cycle: 1, cyclesPerDay: config.cyclesPerDay },
          equity: [],
          positions: [],
          fills: [],
        };
        runs.set(runId, run);
        host.emit({ type: "sim", run });
        entries.push({ runId, variant, ...(scenario ? { scenario } : {}), ...(seed !== undefined ? { seed } : {}), mode });
        drive(runId, 3200);
      };
      for (const scenario of config.scenarios) for (const v of config.variants) mkRun(v.label, scenario, undefined, config.scenarioMode);
      for (let b = 1; b <= config.bootstrapRuns; b++) for (const v of config.variants) mkRun(v.label, undefined, b, "bootstrap");
      const suite: SimSuite = {
        id,
        createdAt,
        startedBy: "user",
        config,
        status: entries.length ? "running" : "done",
        runs: entries,
        summary: config.variants.map((v) => ({ label: v.label, runs: entries.filter((e) => e.variant === v.label).length, done: 0, failed: 0 })),
        ...(entries.length ? {} : { finishedAt: createdAt }),
      };
      publishSuite(suite);
      return suite;
    },
    suiteStop(id: string): SimSuite {
      const s = suites.get(id);
      if (!s) throw new ApiError(404, "suite not found");
      for (const e of s.runs) {
        const r = runs.get(e.runId);
        if (r && (r.status === "running" || r.status === "queued")) {
          const next: SimRun = { ...r, status: "stopped", finishedAt: Date.now() };
          runs.set(next.id, next);
          host.emit({ type: "sim", run: next });
        }
      }
      const next: SimSuite = { ...s, status: "stopped", finishedAt: Date.now() };
      publishSuite(next);
      return next;
    },
    messages: (id: string) => feedOf(id).messages,
    journal: (id: string) => feedOf(id).journal,
    orders: (id: string) => feedOf(id).orders,
    /** Called when the SSE stream opens: the demo run starts moving. */
    ignite() {
      drive(first.id, 5000);
      setTimeout(() => work(first.id, { pace: 0.5, hold: true }), 900);
    },
    dispose() {
      timers.forEach(clearInterval);
      timers.clear();
    },
  };
}
