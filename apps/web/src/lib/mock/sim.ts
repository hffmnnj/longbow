import type {
  ChatMessage,
  JournalEntry,
  OrderRecord,
  Position,
  ServerEvent,
  SimEquityPoint,
  SimFill,
  SimMetrics,
  SimRun,
  SimRunConfig,
} from "@rh/shared";
import { ApiError } from "../api.ts";
import { startDateProblem, weekdaysAgo } from "../sim.ts";
import { fixtureJournal, fixtureMessages, fixtureOrder } from "./fixtures.ts";
import { runWork } from "./work.ts";

/** Dev-only paper-run fixtures and a tiny simulator (VITE_MOCK_API=1). */

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

function metricsFrom(equity: SimEquityPoint[], cash: number, fills: SimFill[], rejected: number): SimMetrics {
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
  return {
    returnPct: (last.equity / cash - 1) * 100,
    benchmarkReturnPct: (last.benchmark / cash - 1) * 100,
    maxDrawdownPct: dd,
    ...(equity.length >= 5 ? { sharpe: +((mean / sd) * Math.sqrt(252)).toFixed(2) } : {}),
    trades: fills.length,
    winRatePct: 57,
    avgR: 0.42,
    exposurePct: 48.6,
    ordersSubmitted: fills.length + 2,
    ordersRejected: rejected,
    brier: 0.21,
  };
}

function fillsFor(equity: SimEquityPoint[], plan: [number, string, "buy" | "sell", number, number][]): SimFill[] {
  return plan.flatMap(([i, symbol, side, quantity, price], n) => {
    const p = equity[i];
    return p
      ? [{ at: new Date(`${p.date}T15:05:00Z`).getTime(), date: p.date, symbol, side, quantity, price, orderId: `sim-ord-${n}` }]
      : [];
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
    config: { name: "Momentum on megacaps", startDate: doneStart, days: 10, startingCash: 1200, cyclesPerDay: 2, watchlist: WATCH, strategy: "Only buy names above the 20 day with relative strength vs QQQ. Take profit into +6%." },
    status: "done",
    currentDate: doneEq.at(-1)!.date,
    progress: { day: 10, days: 10, cycle: 2, cyclesPerDay: 2 },
    equity: doneEq,
    positions: POSITIONS,
    fills: doneFills,
    metrics: metricsFrom(doneEq, 1200, doneFills, 3),
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
    config: { startDate: agentStart, days: 8, startingCash: 1200, cyclesPerDay: 3, watchlist: WATCH, strategy: "Test whether a defensive tilt into financials and energy beats SPY when VIX is falling." },
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
    config: { name: "Gap-down reversion", startDate: runStart, days: 12, startingCash: 1200, cyclesPerDay: 3, watchlist: WATCH, strategy: "Buy quality names after a gap down of 2% or more on no news. Exit on the gap fill or day 3." },
    status: "running",
    currentDate: nextWeekday(runEq.at(-1)!.date),
    progress: { day: 4, days: 12, cycle: 2, cyclesPerDay: 3 },
    equity: runEq,
    positions: POSITIONS.slice(0, 1),
    fills: runFills,
  };
  return [running, done, byAgent];
}

export interface SimHost {
  emit(event: ServerEvent): void;
}

/** In-memory simulator behind the lab routes. */
export function createMockSim(host: SimHost) {
  const runs = new Map<string, SimRun>(simFixtures().map((r) => [r.id, r]));
  const feeds = new Map<string, { messages: ChatMessage[]; journal: JournalEntry[]; orders: OrderRecord[] }>();
  const timers = new Set<ReturnType<typeof setInterval>>();
  let seq = 1;

  const sorted = () => [...runs.values()].sort((a, b) => b.createdAt - a.createdAt);
  const publish = (run: SimRun) => {
    runs.set(run.id, run);
    host.emit({ type: "sim", run });
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
      publish({ ...full, metrics: metricsFrom(equity, run.config.startingCash, run.fills, 0) });
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
      const problem = startDateProblem(config.startDate, config.days);
      if (problem) throw new ApiError(400, problem);
      const id = `sim-new-${seq++}`;
      const run: SimRun = {
        id,
        createdAt: Date.now(),
        startedBy: "user",
        config,
        status: "running",
        currentDate: config.startDate,
        progress: { day: 0, days: config.days, cycle: 1, cyclesPerDay: config.cyclesPerDay },
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
      const next: SimRun = { ...r, status: "stopped", finishedAt: Date.now() };
      publish(next);
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
