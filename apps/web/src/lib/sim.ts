import { RiskConfigSchema, type RiskConfig, type ServerEvent, type SimFill, type SimMetrics, type SimRun, type SimRunConfig, type SimRunStatus, type SimSuite } from "@rh/shared";
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

/** Null when the window fits in the past, else a short reason. Bootstrap runs need no date. */
export function startDateProblem(start: string | undefined, days: number, now: Date = new Date()): string | null {
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return "Pick a start date";
  const available = weekdaysBetween(start, now);
  return available < days ? `Only ${available} trading days between ${start} and today` : null;
}

export interface SimState {
  /** Newest first. */
  runs: SimRun[];
  /** Suites, newest first. */
  suites: SimSuite[];
  /** One live-style feed per run: messages, journal, orders, subagents, transcripts. */
  feeds: Record<string, FeedState>;
}

export const emptySim = (): SimState => ({ runs: [], suites: [], feeds: {} });

export function upsertSimRun(runs: readonly SimRun[], run: SimRun): SimRun[] {
  return [...runs.filter((r) => r.id !== run.id), run].sort((a, b) => b.createdAt - a.createdAt);
}

export function upsertSuite(suites: readonly SimSuite[], suite: SimSuite): SimSuite[] {
  return [...suites.filter((s) => s.id !== suite.id), suite].sort((a, b) => b.createdAt - a.createdAt);
}

/** Pure reducer: `sim` events upsert runs, `sim_suite` events upsert suites; events with `simRunId` feed that run's own FeedState. */
export function applySimEvent(state: SimState, event: ServerEvent): SimState {
  if (event.type === "sim") return { ...state, runs: upsertSimRun(state.runs, event.run) };
  if (event.type === "sim_suite") return { ...state, suites: upsertSuite(state.suites, event.suite) };
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
  const days = run.config.days;
  if (run.config.mode === "bootstrap") return `${days}-day bootstrap`;
  if (run.config.scenario) return `${days}-day ${run.config.scenario}`;
  return run.config.startDate ? `${days}-day run from ${run.config.startDate}` : `${days}-day run`;
}

/** Header tag for blind and bootstrap runs, whose dates and tickers are fictional. */
export function envBadge(run: SimRun): string | null {
  if (run.config.mode === "blind") return "Blind · fictional dates";
  if (run.config.mode === "bootstrap") return `Bootstrap · seed ${run.seed ?? run.config.seed ?? "?"}`;
  return null;
}

/** Display symbol: with the reveal toggle on, a finished blind or bootstrap run shows the real ticker. */
export function shownSymbol(run: SimRun, symbol: string, revealed: boolean): string {
  if (revealed && run.aliases) return run.aliases[symbol] ?? symbol;
  return symbol;
}

/** True when the run has ended and its alias map is available to reveal. */
export const canReveal = (run: SimRun): boolean =>
  (run.status === "done" || run.status === "stopped") && !!run.aliases && Object.keys(run.aliases).length > 0;

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

/** Full cost of a fill: spread/slippage plus regulatory fees. Undefined when the fill records neither. */
export function fillCost(f: Pick<SimFill, "cost" | "fees">): number | undefined {
  if (f.cost === undefined && f.fees === undefined) return undefined;
  return (f.cost ?? 0) + (f.fees ?? 0);
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
  mode: "blind",
  execution: "realistic",
  model: "main",
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
  /** Smaller second line, for example the percent next to the dollars. */
  sub?: string;
  /** Risk blocks render as small bars instead of a single figure. */
  bars?: { label: string; value: number }[];
}

export interface MetricGroup {
  title: string;
  rows: MetricRow[];
}

/** The run detail groups: undefined metrics are omitted, never dashed. */
export function metricGroups(run: SimRun): MetricGroup[] {
  const m = run.metrics;
  const n = runNumbers(run);
  const ff = (v: number | undefined, f: (x: number) => string): string | undefined => (v === undefined ? undefined : f(v));
  const f2 = (v: number | undefined) => ff(v, (x) => x.toFixed(2));
  const pct1 = (v: number | undefined) => ff(v, (x) => `${x.toFixed(1)}%`);

  const ret: MetricGroup[] = [];

  const risk: MetricRow[] = [];
  if (n) {
    risk.push({ label: "Return", pnl: n.returnPct });
    risk.push({ label: "Vs benchmark", pnl: n.returnPct - n.benchmarkReturnPct, sub: `SPY ${n.benchmarkReturnPct.toFixed(1)}%` });
  }
  if (m?.alphaPct !== undefined) risk.push({ label: "Alpha", pnl: m.alphaPct });
  if (m?.beta !== undefined) risk.push({ label: "Beta", text: m.beta.toFixed(2) });
  const sharpe = f2(m?.sharpe);
  if (sharpe !== undefined) risk.push({ label: "Sharpe", text: sharpe });
  const sortino = f2(m?.sortino);
  if (sortino !== undefined) risk.push({ label: "Sortino", text: sortino });
  const calmar = f2(m?.calmar);
  if (calmar !== undefined) risk.push({ label: "Calmar", text: calmar });
  if (n) risk.push({ label: "Max drawdown", text: `${n.maxDrawdownPct.toFixed(2)}%` });
  const vol = pct1(m?.volatilityPct);
  if (vol !== undefined) risk.push({ label: "Volatility", text: vol });
  if (risk.length) ret.push({ title: "Return and risk", rows: risk });

  const trading: MetricRow[] = [];
  if (m) {
    trading.push({ label: "Round trips", text: String(m.roundTrips) });
    const wr = ff(m.winRatePct, (x) => `${x.toFixed(0)}%`);
    if (wr !== undefined) trading.push({ label: "Win rate", text: wr });
    const avgR = ff(m.avgR, (x) => `${x.toFixed(2)}R`);
    if (avgR !== undefined) trading.push({ label: "Avg R", text: avgR });
    const pf = f2(m.profitFactor);
    if (pf !== undefined) trading.push({ label: "Profit factor", text: pf });
    if (m.expectancy !== undefined) trading.push({ label: "Expectancy", text: usdShort(m.expectancy) });
    const hold = ff(m.avgHoldingDays, (x) => `${x.toFixed(1)}d`);
    if (hold !== undefined) trading.push({ label: "Avg holding", text: hold });
    trading.push({ label: "Turnover", text: `${m.turnoverPct.toFixed(0)}%` });
  } else if (n || run.fills.length) {
    trading.push({ label: "Fills", text: String(run.fills.length) });
  }
  if (trading.length) ret.push({ title: "Trading", rows: trading });

  const costs: MetricRow[] = [];
  if (m && !(m.costsPaid === 0 && m.costsPct === 0 && run.fills.length === 0)) {
    // Costs on a small account are cents, so they keep two decimals where other money figures round.
    costs.push({ label: "Costs paid", text: `$${m.costsPaid.toFixed(2)}`, sub: `${m.costsPct.toFixed(2)}% of start` });
    // Regulatory fees alone, already included in the costs above.
    if (m.feesPaid !== undefined && m.feesPaid > 0) costs.push({ label: "Fees", text: `$${m.feesPaid.toFixed(2)}` });
  }
  if (costs.length) ret.push({ title: "Costs", rows: costs });

  const discipline: MetricRow[] = [];
  const blocks = m ? Object.entries(m.riskBlocks).sort((a, b) => b[1] - a[1]) : [];
  if (blocks.length) discipline.push({ label: "Risk blocks", bars: blocks.map(([label, value]) => ({ label, value })) });
  const brier = ff(m?.brier, (x) => x.toFixed(3));
  if (brier !== undefined) discipline.push({ label: "Brier", text: brier, sub: "lower is better" });
  if (discipline.length) ret.push({ title: "Discipline", rows: discipline });

  return ret;
}

/** Dollars without cents for compact metric cells: $1,240, −$35. */
function usdShort(value: number): string {
  const sign = value < 0 && Math.abs(value) >= 0.5 ? "−" : "";
  return `${sign}$${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
}

const DASH = "—";

/** Flattened groups for the run-compare table; missing values dash so columns stay aligned. */
export function metricRows(run: SimRun): MetricRow[] {
  return metricGroups(run).flatMap((g) => g.rows);
}

export { DASH };

/** One-decimal points with a true minus sign: 0.8, −0.3. */
const points = (x: number): string => `${x < 0 ? "−" : ""}${Math.abs(x).toFixed(1)}`;

export interface ComparisonReading {
  text: string;
  /** True only when the 95% interval excludes zero. */
  conclusive: boolean;
}

/** Plain reading of a two-variant suite comparison, for example "B beat A by 0.8 points; 95% interval −0.3 to 1.9; not conclusive". */
export function comparisonReading(suite: Pick<SimSuite, "config" | "comparison">): ComparisonReading | null {
  const c = suite.comparison;
  if (!c) return null;
  const a = suite.config.variants[0]?.label ?? "A";
  const b = suite.config.variants[1]?.label ?? "B";
  const head =
    c.meanDiff > 0
      ? `${b} beat ${a} by ${points(c.meanDiff)} points`
      : c.meanDiff < 0
        ? `${a} beat ${b} by ${points(-c.meanDiff)} points`
        : `${a} tied ${b}`;
  const conclusive = c.ci95[0] > 0 || c.ci95[1] < 0;
  return {
    text: `${head}; 95% interval ${points(c.ci95[0])} to ${points(c.ci95[1])}; ${conclusive ? "conclusive" : "not conclusive"}`,
    conclusive,
  };
}

/** Finished runs out of the suite's total, resolved against the lab's run list. */
export function suiteProgress(suite: SimSuite, runs: readonly SimRun[]): { done: number; total: number } {
  const byId = new Map(runs.map((r) => [r.id, r]));
  let done = 0;
  for (const entry of suite.runs) {
    const s = byId.get(entry.runId)?.status;
    if (s === "done" || s === "failed" || s === "stopped") done++;
  }
  return { done, total: suite.runs.length };
}

/** Excess return of one run over its benchmark, in points, when the run has metrics. */
export const excessReturn = (run: SimRun): number | undefined =>
  run.metrics ? run.metrics.returnPct - run.metrics.benchmarkReturnPct : undefined;
