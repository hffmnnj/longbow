import type {
  CalibrationBucket,
  ClosedTrade,
  EquityHistory,
  ExposureRow,
  OrderStatus,
  Position,
  RiskConfig,
} from "@rh/shared";
import { isoShort, pctSigned } from "./format.ts";

/** Keep at most `max` items, always including the first and the last, spread evenly between. */
export function thinSeries<T>(items: readonly T[], max: number): T[] {
  if (max < 2 || items.length <= max) return items.slice();
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  let last = -1;
  for (let i = 0; i < max; i++) {
    const idx = Math.round(i * step);
    if (idx !== last) out.push(items[idx]!);
    last = idx;
  }
  return out;
}

/** Each value as a percent change from the first value. */
export function indexToStart(values: readonly number[]): number[] {
  const base = values[0];
  if (base === undefined || base === 0) return values.map(() => 0);
  return values.map((v) => ((v - base) / base) * 100);
}

/**
 * The dither engine draws from a floor of zero, which would flatten a line that moves 2% around $25,000.
 * Subtract a floor just under the lowest value and add it back in labels.
 */
export function rebase(series: readonly (readonly number[])[], pad = 0.12): { offset: number; rows: number[][] } {
  const all = series.flat().filter(Number.isFinite);
  if (all.length === 0) return { offset: 0, rows: series.map((s) => s.map(() => 0)) };
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || Math.abs(hi) * 0.02 || 1;
  // Round the floor down to a round number so axis ticks read as round numbers once the floor is added back.
  const step = 10 ** Math.floor(Math.log10(span));
  const offset = Math.max(0, Math.floor((lo - span * pad) / step) * step);
  return { offset, rows: series.map((s) => s.map((v) => v - offset)) };
}

export interface EquityRow {
  date: string;
  equity: number;
  benchmark?: number;
}

/** Equity marks thinned for drawing, with the benchmark only when every mark carries one. */
export function equityRows(history: EquityHistory, max = 120): { rows: EquityRow[]; hasBenchmark: boolean } {
  const hasBenchmark = history.points.length > 0 && history.points.every((p) => p.benchmark !== undefined);
  const rows = thinSeries(history.points, max).map((p) => ({
    date: p.date,
    equity: p.equity,
    benchmark: hasBenchmark ? p.benchmark : undefined,
  }));
  return { rows, hasBenchmark };
}

/** "Up 1.9% vs SPY's −0.6% since Oct 24" */
export function equityReading(history: EquityHistory): string | undefined {
  const first = history.points[0];
  if (!first || history.returnPct === undefined || history.points.length < 2) return undefined;
  const dir = history.returnPct >= 0 ? "Up" : "Down";
  const mine = pctSigned(Math.abs(history.returnPct) < 0.005 ? 0 : history.returnPct).replace(/^[+\u2212]/, "");
  const since = `since ${isoShort(first.date)}`;
  if (history.benchmarkReturnPct === undefined) return `${dir} ${mine} ${since}`;
  return `${dir} ${mine} vs SPY's ${pctSigned(history.benchmarkReturnPct)} ${since}`;
}

export const REPLAY_LABEL = "Today's holdings, replayed";
export const REPLAY_NOTE = "What today's positions and cash would have been worth on each past day. Not the account's real history.";

export function replayRows(history: EquityHistory, max = 120): { date: string; value: number }[] {
  return thinSeries(history.holdingsReplay, max);
}

/** "Today's holdings would be up 6.4% over the last 3 months" */
export function replayReading(history: EquityHistory): string | undefined {
  const rows = history.holdingsReplay;
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last || rows.length < 2 || first.value === 0) return undefined;
  const change = ((last.value - first.value) / first.value) * 100;
  return `Replay: today's holdings are ${pctSigned(change)} since ${isoShort(first.date)}`;
}

export interface CalibrationRow {
  key: string;
  label: string;
  predicted: number;
  realized: number;
  count: number;
}

/** Buckets with at least one trade, labelled "50–60%" with the trade count. */
export function calibrationRows(buckets: readonly CalibrationBucket[]): CalibrationRow[] {
  return buckets
    .filter((b) => b.count > 0)
    .map((b) => ({
      key: `${b.from}-${b.to}`,
      label: `${Math.round(b.from * 100)}\u2013${Math.round(b.to * 100)}%`,
      predicted: Math.round(b.predicted * 1000) / 10,
      realized: Math.round(b.realized * 1000) / 10,
      count: b.count,
    }));
}

/** Plain reading of how honest the agent's probabilities are, weighted by trades per bucket. */
export function calibrationReading(buckets: readonly CalibrationBucket[]): string | undefined {
  const rows = buckets.filter((b) => b.count > 0);
  const n = rows.reduce((a, b) => a + b.count, 0);
  if (n === 0) return undefined;
  const gap = rows.reduce((a, b) => a + (b.realized - b.predicted) * b.count, 0) / n;
  const pts = Math.round(Math.abs(gap) * 100);
  const sample = `across ${n} trade${n === 1 ? "" : "s"}`;
  if (pts < 2) return `Predicted and realized win rates match ${sample}`;
  return gap < 0
    ? `Realized win rate runs ${pts} points below predictions ${sample}`
    : `Realized win rate runs ${pts} points above predictions ${sample}`;
}

export interface PnlBar {
  key: string;
  label: string;
  gain: number;
  loss: number;
  pnl: number;
  trade: ClosedTrade;
}

/** Closed trades oldest first, with wins and losses split so each draws as magnitude in its own colour. */
export function pnlBars(trades: readonly ClosedTrade[], max = 40): PnlBar[] {
  const sorted = trades.slice().sort((a, b) => a.closedAt - b.closedAt);
  return sorted.slice(-max).map((t, i) => ({
    key: `${t.symbol}-${t.closedAt}-${i}`,
    label: t.symbol,
    gain: t.pnl > 0 ? t.pnl : 0,
    loss: t.pnl < 0 ? -t.pnl : 0,
    pnl: t.pnl,
    trade: t,
  }));
}

/**
 * List keys for server rows whose natural key can repeat in real data (a feed
 * that emits an event twice, two fills in the same millisecond). The index is
 * the tiebreaker, so the key is unique by construction.
 */
export const calendarKey = (c: { date: string; event: string }, i: number): string => `${c.date} ${c.event} ${i}`;

export const earningsKey = (e: { symbol: string; date: string }, i: number): string => `${e.symbol} ${e.date} ${i}`;

export const closedTradeKey = (t: { symbol: string; closedAt: number }, i: number): string => `${t.symbol} ${t.closedAt} ${i}`;

export const simFillKey = (f: { orderId: string; at: number }, i: number): string => `${f.orderId} ${f.at} ${i}`;

export const riskCheckKey = (c: { rule: string }, i: number): string => `${c.rule} ${i}`;

export interface CalendarDay<T> {
  date: string;
  items: T[];
}

/** Economic calendar grouped by date, keeping the server's first-seen order. */
export function groupCalendarDays<T extends { date: string }>(calendar: readonly T[]): CalendarDay<T>[] {
  const groups = new Map<string, T[]>();
  for (const c of calendar) {
    const list = groups.get(c.date);
    if (list) list.push(c);
    else groups.set(c.date, [c]);
  }
  return [...groups.entries()].map(([date, items]) => ({ date, items }));
}

export function pnlReading(trades: readonly ClosedTrade[]): string | undefined {
  if (trades.length === 0) return undefined;
  const wins = trades.filter((t) => t.pnl > 0).length;
  const net = trades.reduce((a, t) => a + t.pnl, 0);
  return `${wins} of ${trades.length} closed trades won; net ${net >= 0 ? "gain" : "loss"} across them`;
}

export const SOURCE_LABEL: Record<ClosedTrade["source"], string> = {
  harness: "Longbow",
  robinhood: "Robinhood history",
};

/** Heat cap implied by the risk settings: every position at its full per-trade risk. */
export function heatCapPct(risk: Pick<RiskConfig, "maxPositions" | "maxRiskPerTradePct">): number {
  return risk.maxPositions * risk.maxRiskPerTradePct;
}

/** Percent the price sits above its stop; negative when already through it. */
export function distanceToStopPct(price: number, stop: number): number {
  return price === 0 ? 0 : ((price - stop) / price) * 100;
}

export interface PositionStop {
  position: Position;
  price?: number;
  weightPct?: number;
  stopPrice?: number;
  distancePct?: number;
  riskToStopPct?: number;
}

/** Joins held positions with the stop and weight the server computed. */
export function positionStops(positions: readonly Position[], exposure: readonly ExposureRow[], equity: number): PositionStop[] {
  const bySymbol = new Map(exposure.map((e) => [e.symbol, e]));
  return positions
    .map((position) => {
      const e = bySymbol.get(position.symbol);
      const price = position.quantity > 0 ? position.marketValue / position.quantity : undefined;
      const stopPrice = e?.stopPrice;
      return {
        position,
        price,
        weightPct: e?.weightPct ?? (equity > 0 ? (position.marketValue / equity) * 100 : undefined),
        stopPrice,
        distancePct: price !== undefined && stopPrice !== undefined ? distanceToStopPct(price, stopPrice) : undefined,
        riskToStopPct: e?.riskToStopPct,
      };
    })
    .sort((a, b) => b.position.marketValue - a.position.marketValue);
}

export const ORDER_OUTCOME_LABEL: Record<OrderStatus, string> = {
  filled: "Filled",
  partially_filled: "Partly filled",
  submitted: "Working",
  held: "Stop held",
  triggering: "Stop firing",
  pending_approval: "Awaiting approval",
  rejected_risk: "Blocked by risk",
  rejected_user: "Rejected by you",
  expired: "Expired",
  cancelled: "Cancelled",
  failed: "Failed",
};

/** Order counts, largest first, zero rows dropped. */
export function orderOutcomes(counts: Partial<Record<OrderStatus, number>>): { status: OrderStatus; label: string; count: number }[] {
  return (Object.entries(counts) as [OrderStatus, number][])
    .filter(([, n]) => n > 0)
    .map(([status, count]) => ({ status, label: ORDER_OUTCOME_LABEL[status], count }))
    .sort((a, b) => b.count - a.count);
}

/** 52-week range position, 0 at the low and 100 at the high. */
export function rangePosition(price: number, low: number, high: number): number {
  if (high <= low) return 50;
  return Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * An SVG tile that fades from solid to sparse across `cols` columns of `cell`-px squares,
 * using the same 4x4 Bayer matrix as the chart engine. Used as the dithered end of horizontal bars.
 */
export function ditherRampSvg(cols = 10, cell = 2, color = "#000"): string {
  const rects: string[] = [];
  for (let x = 0; x < cols; x++) {
    const density = 1 - x / cols;
    for (let y = 0; y < 4; y++) {
      if ((BAYER4[y]![x % 4]! + 0.5) / 16 < density) rects.push(`<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${4 * cell}" fill="${color}">${rects.join("")}</svg>`;
}

/** "10Y at 4.18%, 32 bp above 2Y: the curve slopes up" */
export function yieldReading(yields: readonly { tenor: string; yieldPct: number }[]): string | undefined {
  const y2 = yields.find((y) => y.tenor === "2Y");
  const y10 = yields.find((y) => y.tenor === "10Y");
  if (!y2 || !y10) return undefined;
  const bp = Math.round((y10.yieldPct - y2.yieldPct) * 100);
  const shape = bp > 5 ? "the curve slopes up" : bp < -5 ? "the curve is inverted" : "the curve is flat";
  return `10Y at ${y10.yieldPct.toFixed(2)}%, ${Math.abs(bp)} bp ${bp >= 0 ? "above" : "below"} 2Y: ${shape}`;
}

const ordinal = (n: number) => {
  const v = Math.round(n);
  const s = ["th", "st", "nd", "rd"];
  const r = v % 100;
  return `${v}${s[(r - 20) % 10] ?? s[r] ?? s[0]}`;
};

export function vixReading(vol: { vix: number; percentile?: number; contango: boolean }): string {
  const rank = vol.percentile !== undefined ? ` at the ${ordinal(vol.percentile)} percentile of the past year` : "";
  return `VIX ${vol.vix.toFixed(1)}${rank}; ${vol.contango ? "near-term fear is below the 3-month level (contango)" : "near-term fear is above the 3-month level (backwardation)"}`;
}

export const breadthPct = (b: { aboveSma50: number; total: number }): number => (b.total > 0 ? (b.aboveSma50 / b.total) * 100 : 0);
