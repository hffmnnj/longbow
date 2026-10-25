import type { Bar } from "@rh/shared";

/**
 * Realistic execution cost model for the simulation paper broker.
 *
 * Spreads come from the 20-session average dollar volume strictly before the
 * current day (no lookahead); slippage is a square-root market-impact term in
 * the order's share of that volume, scaled by recent daily return volatility.
 */

/** Average daily dollar volume (close times volume) over the `lookback` sessions strictly before `day`. */
export function avgDollarVolumeBefore(bars: Bar[], day: string, lookback = 20): number | undefined {
  const prior = bars.filter((b) => b.date < day).slice(-lookback);
  if (prior.length === 0) return undefined;
  return prior.reduce((sum, b) => sum + b.close * b.volume, 0) / prior.length;
}

/** Sample standard deviation of daily simple returns over the `lookback` sessions strictly before `day`. */
export function returnVolatilityBefore(bars: Bar[], day: string, lookback = 20): number {
  const closes = bars.filter((b) => b.date < day).map((b) => b.close).slice(-(lookback + 1));
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const previous = closes[i - 1]!;
    if (previous > 0 && closes[i]! > 0) returns.push(closes[i]! / previous - 1);
  }
  const sample = returns.slice(-lookback);
  if (sample.length < 2) return 0;
  const mean = sample.reduce((sum, r) => sum + r, 0) / sample.length;
  const variance = sample.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (sample.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

/**
 * Half-spread in basis points from average dollar volume: 1 bp at or above
 * $5B, 2 bp at or above $1B, 5 bp at or above $200M, 15 bp below. Widened by
 * 50% in the first 15 minutes of the session. Unknown volume is treated as
 * the least liquid tier.
 */
export function halfSpreadBps(avgDollarVolumeUsd: number | undefined, minutesIntoSession: number): number {
  const adv = avgDollarVolumeUsd ?? 0;
  const bps = adv >= 5_000_000_000 ? 1 : adv >= 1_000_000_000 ? 2 : adv >= 200_000_000 ? 5 : 15;
  return minutesIntoSession < 15 ? bps * 1.5 : bps;
}

/** Square-root market-impact term in basis points. Zero without volume or volatility history. */
export function slippageBps(orderNotionalUsd: number, avgDollarVolumeUsd: number | undefined, volatility: number): number {
  if (!(orderNotionalUsd > 0) || avgDollarVolumeUsd === undefined || !(avgDollarVolumeUsd > 0) || !(volatility > 0)) return 0;
  return 10_000 * volatility * Math.sqrt(orderNotionalUsd / avgDollarVolumeUsd);
}
