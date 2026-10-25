import type { CalibrationBucket, ClosedTrade, OrderRecord } from "@rh/shared";
import { maxDrawdown as indicatorMaxDrawdown } from "../market/indicators.ts";

/**
 * Pure analytics math for the dashboard endpoints. Every function here is
 * deterministic over its inputs and performs no I/O, so it is unit-tested
 * directly (see compute.test.ts).
 */

/** One executed leg of a harness order: a buy lot or a sell fill. */
export interface FillLeg {
  symbol: string;
  side: "buy" | "sell";
  at: number;
  quantity: number;
  price: number;
  invalidationPrice?: number;
  probabilityWin?: number;
}

/**
 * Executed legs of filled harness orders, oldest first. Partially filled
 * orders contribute their filled quantity at the average fill price; orders
 * without a fill price are not executed and are skipped.
 */
export function harnessLegs(orders: OrderRecord[]): FillLeg[] {
  return orders
    .filter((o) => (o.status === "filled" || o.status === "partially_filled") && (o.filledQuantity ?? 0) > 0 && o.averageFillPrice !== undefined)
    .map((o) => ({
      symbol: o.intent.symbol,
      side: o.intent.side,
      at: o.updatedAt,
      quantity: o.filledQuantity as number,
      price: o.averageFillPrice as number,
      invalidationPrice: o.intent.invalidationPrice,
      ...(o.intent.probabilityWin === undefined ? {} : { probabilityWin: o.intent.probabilityWin }),
    }))
    .sort((a, b) => a.at - b.at);
}

/**
 * Pair harness sells against earlier buys FIFO per symbol. One ClosedTrade
 * per sell leg aggregates every buy lot it consumes: the entry price is the
 * quantity-weighted average of the consumed lots and the position opened at
 * the earliest consumed lot's time. A sell with no earlier unmatched buy is
 * skipped (its entry is unknown). Unmatched buy lots stay open.
 */
export function pairHarnessTrades(orders: OrderRecord[]): ClosedTrade[] {
  const lots = new Map<string, { quantity: number; price: number; at: number; invalidationPrice?: number; probabilityWin?: number }[]>();
  const out: ClosedTrade[] = [];
  for (const leg of harnessLegs(orders)) {
    const queue = lots.get(leg.symbol) ?? [];
    if (leg.side === "buy") {
      queue.push({ quantity: leg.quantity, price: leg.price, at: leg.at, invalidationPrice: leg.invalidationPrice, ...(leg.probabilityWin === undefined ? {} : { probabilityWin: leg.probabilityWin }) });
      lots.set(leg.symbol, queue);
      continue;
    }
    let remaining = leg.quantity;
    let cost = 0;
    let risk = 0;
    let probSum = 0;
    let probQty = 0;
    let openedAt: number | undefined;
    while (remaining > 1e-9 && queue.length > 0) {
      const lot = queue[0] as (typeof queue)[number];
      const matched = Math.min(remaining, lot.quantity);
      cost += lot.price * matched;
      if (lot.invalidationPrice !== undefined && lot.invalidationPrice > 0 && lot.invalidationPrice < lot.price) {
        risk += (lot.price - lot.invalidationPrice) * matched;
      }
      if (lot.probabilityWin !== undefined) {
        probSum += lot.probabilityWin * matched;
        probQty += matched;
      }
      openedAt ??= lot.at;
      lot.quantity -= matched;
      remaining -= matched;
      if (lot.quantity < 1e-9) queue.shift();
    }
    const matchedQty = leg.quantity - remaining;
    if (matchedQty < 1e-9 || openedAt === undefined) continue;
    const tradePnl = leg.price * matchedQty - cost;
    const entryPrice = cost / matchedQty;
    out.push({
      symbol: leg.symbol,
      openedAt,
      closedAt: leg.at,
      quantity: matchedQty,
      entryPrice,
      exitPrice: leg.price,
      pnl: tradePnl,
      pnlPct: cost === 0 ? undefined : (tradePnl / cost) * 100,
      ...(risk > 0 ? { rMultiple: tradePnl / risk } : {}),
      holdingDays: Math.max(0, (leg.at - openedAt) / 86_400_000),
      ...(probQty > 0 ? { probabilityWin: probSum / probQty } : {}),
      source: "harness",
    });
  }
  return out;
}

export interface TradeSummary {
  realizedPnl: number;
  winRatePct?: number;
  avgR?: number;
  expectancy?: number;
  profitFactor?: number;
  avgHoldingDays?: number;
}

/** Aggregate metrics over closed trades; each metric covers only the trades where it is defined. */
export function summarizeTrades(trades: ClosedTrade[]): TradeSummary {
  const summary: TradeSummary = { realizedPnl: trades.reduce((sum, t) => sum + t.pnl, 0) };
  if (trades.length > 0) {
    summary.winRatePct = (trades.filter((t) => t.pnl > 0).length / trades.length) * 100;
    summary.expectancy = summary.realizedPnl / trades.length;
    const gains = trades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const losses = trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum - t.pnl, 0);
    if (losses > 0) summary.profitFactor = gains / losses;
  }
  const withR = trades.filter((t) => t.rMultiple !== undefined).map((t) => t.rMultiple as number);
  if (withR.length > 0) summary.avgR = withR.reduce((a, b) => a + b, 0) / withR.length;
  const withHold = trades.filter((t) => t.holdingDays !== undefined).map((t) => t.holdingDays as number);
  if (withHold.length > 0) summary.avgHoldingDays = withHold.reduce((a, b) => a + b, 0) / withHold.length;
  return summary;
}

/**
 * Calibration of harness win-probability estimates: ten 0.1-wide buckets.
 * `predicted` is the bucket midpoint, `realized` the fraction of winners.
 */
export function calibrationBuckets(trades: ClosedTrade[]): CalibrationBucket[] {
  const withProb = trades.filter((t) => t.probabilityWin !== undefined);
  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < 10; i++) {
    const from = i / 10;
    const to = (i + 1) / 10;
    const inBucket = withProb.filter((t) => (t.probabilityWin as number) >= from && ((t.probabilityWin as number) < to || (i === 9 && (t.probabilityWin as number) <= to)));
    if (inBucket.length === 0) continue;
    buckets.push({
      from,
      to,
      predicted: (from + to) / 2,
      realized: inBucket.filter((t) => t.pnl > 0).length / inBucket.length,
      count: inBucket.length,
    });
  }
  return buckets;
}

/** Mean squared error of probabilityWin against win/loss outcomes; lower is better. */
export function brierScore(trades: ClosedTrade[]): number | undefined {
  const withProb = trades.filter((t) => t.probabilityWin !== undefined);
  if (withProb.length === 0) return undefined;
  return withProb.reduce((sum, t) => sum + ((t.probabilityWin as number) - (t.pnl > 0 ? 1 : 0)) ** 2, 0) / withProb.length;
}

/** Worst peak-to-trough fall as a positive percent (0 when values never fall). */
export function maxDrawdownPct(values: number[]): number | undefined {
  const dd = indicatorMaxDrawdown(values);
  if (dd === undefined) return undefined;
  const pct = -dd * 100;
  return pct === 0 ? 0 : pct;
}

/** Percent change from first to last, or undefined with fewer than two values. */
export function returnPct(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  const first = values[0] as number;
  const last = values[values.length - 1] as number;
  if (first === 0) return undefined;
  return (last / first - 1) * 100;
}

/** Close on `date`, or the most recent earlier close (up to 10 calendar days back). */
export function closeOnOrBefore(byDate: Map<string, number>, date: string): number | undefined {
  for (let back = 0; back <= 10; back++) {
    const day = new Date(new Date(`${date}T12:00:00Z`).getTime() - back * 86_400_000).toISOString().slice(0, 10);
    const close = byDate.get(day);
    if (close !== undefined) return close;
  }
  return undefined;
}

/**
 * What today's holdings plus today's cash would have been worth on each past
 * date: a replay, never the account's real history. Each symbol is priced at
 * its close on that date, falling back to the most recent earlier close when
 * the date itself has no bar (weekends, halts). Symbols with no usable close
 * on or before a date contribute nothing that day.
 */
export function holdingsReplayValues(
  dates: string[],
  closesBySymbol: Record<string, Record<string, number>>,
  holdings: { symbol: string; quantity: number }[],
  cash: number,
): { date: string; value: number }[] {
  return dates.map((date) => {
    let value = cash;
    for (const holding of holdings) {
      const closes = closesBySymbol[holding.symbol];
      if (!closes) continue;
      let cursor: string | undefined;
      for (const day of Object.keys(closes).sort()) {
        if (day <= date) cursor = day;
        else break;
      }
      if (cursor !== undefined) value += holding.quantity * (closes[cursor] as number);
    }
    return { date, value };
  });
}

export type TrendState = "up" | "down" | "sideways";

/** True when today's VIX print counts as elevated (level over 25 or above its 80th percentile). */
export function isHighVol(vix: number | undefined, percentile: number | undefined): boolean {
  if (vix === undefined) return false;
  return vix > 25 || (percentile !== undefined && percentile > 80);
}

/** True when today's VIX print counts as calm (below 15 and below its 20-day average). */
export function isLowVol(vix: number | undefined, percentile: number | undefined, sma20: number | undefined): boolean {
  void percentile;
  if (vix === undefined || vix >= 15) return false;
  return sma20 === undefined || vix < sma20;
}

export interface RegimeInput {
  trend: TrendState;
  vix?: number;
  vixPercentile?: number;
  vixSma20?: number;
  /** Fraction the index sits below its 52-week high (0.06 = 6% off the high). */
  drawdownFromHigh52w?: number;
}

/**
 * One-line regime label from the market-regime skill rules (simplified: the
 * skill's rising/falling 50-day check is approximated by price position
 * relative to the 50- and 200-day averages, and the yield/breadth flags only
 * reinforce the label, never override it).
 */
export function classifyRegime(input: RegimeInput): string {
  const high = isHighVol(input.vix, input.vixPercentile);
  if (input.trend === "down" && high) return "Bear, high volatility";
  if (input.drawdownFromHigh52w !== undefined && input.drawdownFromHigh52w >= 0.05) return "Correction";
  if (input.trend === "up") return isLowVol(input.vix, input.vixPercentile, input.vixSma20) ? "Bull, low volatility" : "Bull, normal volatility";
  return high ? "Sideways, elevated volatility" : "Sideways";
}

const INVALIDATION_PATTERNS = [
  /invalidation(?:\s+price)?\s*(?:at|of|is|:|=)?\s*\$?\s*(\d+(?:\.\d+)?)/i,
  /stop(?:-loss)?(?:\s+price)?\s*(?:at|of|:|=|@)?\s*\$?\s*(\d+(?:\.\d+)?)/i,
];

/**
 * Stop price stated clearly in a thesis note ("invalidation $X" or
 * "stop at $X"). Returns undefined when no pattern states one, so callers
 * never guess from vague text.
 */
export function parseThesisStop(markdown: string): number | undefined {
  for (const pattern of INVALIDATION_PATTERNS) {
    const match = pattern.exec(markdown);
    if (match?.[1] !== undefined) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return undefined;
}

const HIGH_IMPACT = /\b(CPI|PCE|Nonfarm Payrolls|Unemployment Rate|FOMC|Fed Interest Rate Decision|Interest Rate Decision|GDP|Retail Sales|ISM (Manufacturing|Services|Non-Manufacturing) PMI|Powell)\b/i;
const MEDIUM_IMPACT = /\b(PPI|Initial Jobless Claims|JOLTS|ADP|Durable Goods|Consumer (Confidence|Sentiment)|Michigan|Core|Industrial Production|Housing Starts|New Home Sales|Existing Home Sales|Personal (Income|Spending)|Employment Cost|Beige Book|Trade Balance|Crude Oil Inventories)\b/i;

/** Nasdaq's calendar field is named "gmt" but carries Eastern time; normalize "H:MM" to "HH:MM". */
export function etTime(raw: string): string | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  return match ? `${match[1]!.padStart(2, "0")}:${match[2]}` : undefined;
}

/** US events worth a trader's attention: deduplicated by date and name, rated, low-impact noise dropped, sorted. */
export function economicCalendar(
  days: { date: string; events: { time: string; country: string; event: string }[] }[],
): { date: string; time?: string; event: string; importance: "high" | "medium" }[] {
  const seen = new Set<string>();
  const out: { date: string; time?: string; event: string; importance: "high" | "medium" }[] = [];
  for (const { date, events } of days) {
    for (const e of events) {
      if (e.country !== "United States") continue;
      const importance = HIGH_IMPACT.test(e.event) ? "high" : MEDIUM_IMPACT.test(e.event) ? "medium" : undefined;
      if (importance === undefined) continue;
      const key = `${date}|${e.event.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const time = etTime(e.time);
      out.push({ date, ...(time === undefined ? {} : { time }), event: e.event, importance });
    }
  }
  return out.sort((a, b) => (a.date + (a.time ?? "99")).localeCompare(b.date + (b.time ?? "99")));
}
