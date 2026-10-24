import { RiskConfigSchema, type RiskConfig, type ServerEvent, type SimMetrics, type SimRun, type SimRunConfig, type SimRunStatus } from "@rh/shared";
import { applyEvent, emptyState, type FeedState } from "./reducer.ts";
import { fieldError, type RiskKey } from "./settingsForm.ts";

/** Minutes of wall time the server spends per simulated cycle. */
export const MINUTES_PER_CYCLE = 1.5;

export const estimateMinutes = (days: number, cyclesPerDay: number): number => days * cyclesPerDay * MINUTES_PER_CYCLE;

/** "about 30 min", "about 1 h 30 min", "about 1 min". */
export function formatEstimate(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `about ${h} h` : `about ${h} h ${rest} min`;
}

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const isWeekday = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;

/** The date `n` weekdays before `from` (UTC calendar math; exchange holidays are the server's job). */
export function weekdaysAgo(n: number, from: Date = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let left = n;
  while (left > 0) {
    d.setTime(d.getTime() - DAY_MS);
    if (isWeekday(d)) left--;
  }
  return isoDay(d);
}

/** Weekdays from `start` (inclusive) up to today (exclusive). */
export function weekdaysBetween(start: string, end: Date = new Date()): number {
  const s = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(s.getTime())) return 0;
  const e = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  let n = 0;
  for (const d = new Date(s); d.getTime() < e; d.setTime(d.getTime() + DAY_MS)) if (isWeekday(d)) n++;
  return n;
}

/** Null when the window fits in the past, else a short reason. */
export function startDateProblem(start: string, days: number, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return "Pick a start date";
  const available = weekdaysBetween(start, now);
  return available < days ? `Only ${available} trading days between ${start} and today` : null;
}

export interface SimState {
  /** Newest first. */
  runs: SimRun[];
  /** One live-style feed per run: messages, journal, orders, subagents, transcripts. */
  feeds: Record<string, FeedState>;
}

export const emptySim = (): SimState => ({ runs: [], feeds: {} });

export function upsertSimRun(runs: readonly SimRun[], run: SimRun): SimRun[] {
  return [...runs.filter((r) => r.id !== run.id), run].sort((a, b) => b.createdAt - a.createdAt);
}

/** Pure reducer: `sim` events upsert runs; events with `simRunId` feed that run's own FeedState. */
export function applySimEvent(state: SimState, event: ServerEvent): SimState {
  if (event.type === "sim") return { ...state, runs: upsertSimRun(state.runs, event.run) };
  if (!("simRunId" in event) || !event.simRunId) return state;
  const id = event.simRunId;
  const scoped = { ...event, simRunId: undefined } as ServerEvent;
  return { ...state, feeds: { ...state.feeds, [id]: applyEvent(state.feeds[id] ?? emptyState(), scoped) } };
}

export const isActive = (s: SimRunStatus) => s === "queued" || s === "running";

/** Configured name, else the strategy's first words, else a dated fallback. */
export function runTitle(run: SimRun): string {
  const name = run.config.name?.trim();
  if (name) return name;
  const words = run.config.strategy?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length) return words.slice(0, 6).join(" ") + (words.length > 6 ? "…" : "");
  return `${run.config.days}-day run from ${run.config.startDate}`;
}

export interface RunNumbers {
  returnPct: number;
  benchmarkReturnPct: number;
  maxDrawdownPct: number;
}

/** Server metrics when present, else the same three figures computed from the marks so far. */
export function runNumbers(run: SimRun): RunNumbers | null {
  if (run.metrics) {
    const { returnPct, benchmarkReturnPct, maxDrawdownPct } = run.metrics;
    return { returnPct, benchmarkReturnPct, maxDrawdownPct };
  }
  const last = run.equity.at(-1);
  if (!last) return null;
  const base = run.config.startingCash;
  let peak = base;
  let dd = 0;
  for (const p of run.equity) {
    peak = Math.max(peak, p.equity);
    dd = Math.max(dd, peak > 0 ? ((peak - p.equity) / peak) * 100 : 0);
  }
  return {
    returnPct: (last.equity / base - 1) * 100,
    benchmarkReturnPct: (last.benchmark / base - 1) * 100,
    maxDrawdownPct: dd,
  };
}

/** Alpha is plain return minus benchmark return, in percentage points. */
export const alpha = (n: Pick<SimMetrics, "returnPct" | "benchmarkReturnPct">) => n.returnPct - n.benchmarkReturnPct;

export interface DayPoint {
  day: number;
  value: number;
}

/** Equity indexed to 100 at the starting cash. Day 0 is the start; day N is the Nth close. */
export function normalizedSeries(run: Pick<SimRun, "config" | "equity">): DayPoint[] {
  const base = run.config.startingCash;
  if (!(base > 0)) return [];
  return [{ day: 0, value: 100 }, ...run.equity.map((p, i) => ({ day: i + 1, value: (p.equity / base) * 100 }))];
}

/** Label for a run in the compare view, made unique when titles collide. */
export function compareLabels(runs: readonly SimRun[]): string[] {
  const seen = new Map<string, number>();
  return runs.map((r) => {
    const t = runTitle(r);
    const n = (seen.get(t) ?? 0) + 1;
    seen.set(t, n);
    return n === 1 ? t : `${t} (${n})`;
  });
}

export const progressFraction = (run: SimRun) =>
  run.status === "done" ? 1 : run.progress.days > 0 ? Math.min(1, run.progress.day / run.progress.days) : 0;

export const statusLabel: Record<SimRunStatus, string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

export const defaultSimConfig = (watchlist: readonly string[] = [], now: Date = new Date()): SimRunConfig => ({
  startDate: weekdaysAgo(15, now),
  days: 10,
  startingCash: 1200,
  cyclesPerDay: 2,
  watchlist: watchlist.length ? [...watchlist] : undefined,
});

/** Blank fields mean "use the live setting"; filled ones become overrides, with inline errors. */
export function riskOverrides(raw: Partial<Record<RiskKey, string>>): {
  risk: Partial<RiskConfig> | undefined;
  errors: Record<string, string>;
} {
  const risk: Partial<RiskConfig> = {};
  const errors: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw) as [RiskKey, string][]) {
    if (value.trim() === "") continue;
    const err = fieldError(RiskConfigSchema.shape[key], value);
    if (err) errors[`risk.${key}`] = err;
    else risk[key] = Number(value);
  }
  return { risk: Object.keys(risk).length ? risk : undefined, errors };
}

export interface MetricRow {
  label: string;
  /** Signed percent shown with gain/loss color. */
  pnl?: number;
  text?: string;
}

const DASH = "\u2014";

/** The twelve figures of the run detail grid and the compare table, in one order. */
export function metricRows(run: SimRun): MetricRow[] {
  const m = run.metrics;
  const n = runNumbers(run);
  const opt = (v: number | undefined, f: (x: number) => string) => (v === undefined ? DASH : f(v));
  return [
    n ? { label: "Return", pnl: n.returnPct } : { label: "Return", text: DASH },
    n ? { label: "SPY", pnl: n.benchmarkReturnPct } : { label: "SPY", text: DASH },
    n ? { label: "Alpha", pnl: alpha(n) } : { label: "Alpha", text: DASH },
    { label: "Max drawdown", text: n ? `${n.maxDrawdownPct.toFixed(2)}%` : DASH },
    { label: "Sharpe", text: opt(m?.sharpe, (x) => x.toFixed(2)) },
    { label: "Trades", text: String(m?.trades ?? run.fills.length) },
    { label: "Win rate", text: opt(m?.winRatePct, (x) => `${x.toFixed(0)}%`) },
    { label: "Avg R", text: opt(m?.avgR, (x) => `${x.toFixed(2)}R`) },
    { label: "Exposure", text: opt(m?.exposurePct, (x) => `${x.toFixed(0)}%`) },
    { label: "Brier score", text: opt(m?.brier, (x) => x.toFixed(3)) },
    { label: "Orders submitted", text: opt(m?.ordersSubmitted, String) },
    { label: "Orders rejected", text: opt(m?.ordersRejected, String) },
  ];
}
