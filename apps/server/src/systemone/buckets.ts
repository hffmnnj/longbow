/**
 * Blind buckets for System One. Jev is a literal reader that is unreliable at
 * arithmetic, so code computes every number and hands the model named bands in
 * plain English words. State built from these phrases carries no ticker, price
 * or date, which keeps blind simulations safe. Each function returns "unknown"
 * for a missing or non-finite input so callers never have to branch.
 */

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Period return in percent units, e.g. 4.2 means +4.2%. */
export function returnBand(pct: number | undefined): string {
  if (!isNum(pct)) return "unknown";
  if (pct < -10) return "strongly down";
  if (pct < -3) return "down";
  if (pct < 3) return "flat";
  if (pct < 10) return "up";
  return "strongly up";
}

export function rsiBand(rsi: number | undefined): string {
  if (!isNum(rsi)) return "unknown";
  if (rsi < 30) return "oversold";
  if (rsi < 45) return "weak";
  if (rsi < 55) return "neutral";
  if (rsi < 70) return "firm";
  return "overbought";
}

/** How far the last price sits below its 52-week high, in percent. */
export function distanceFromHighBand(pctBelowHigh: number | undefined): string {
  if (!isNum(pctBelowHigh)) return "unknown";
  if (pctBelowHigh < 1) return "at the 52-week high";
  if (pctBelowHigh < 5) return "just under the high";
  if (pctBelowHigh < 15) return "moderately below the high";
  return "far below the high";
}

/** ATR as a percent of price. */
export function atrBand(atrPct: number | undefined): string {
  if (!isNum(atrPct)) return "unknown";
  if (atrPct < 1.5) return "low";
  if (atrPct < 3) return "moderate";
  if (atrPct < 5) return "high";
  return "very high";
}

/** Recent volume against its average. */
export function volumeBand(ratioToAvg: number | undefined): string {
  if (!isNum(ratioToAvg)) return "unknown";
  if (ratioToAvg < 0.7) return "quiet";
  if (ratioToAvg < 1.3) return "normal";
  if (ratioToAvg < 2) return "elevated";
  return "heavy";
}

export function trendBand(closeAbove50: boolean | undefined, closeAbove200: boolean | undefined): string {
  if (typeof closeAbove50 !== "boolean" || typeof closeAbove200 !== "boolean") return "unknown";
  if (closeAbove50 && closeAbove200) return "above both the 50-day and 200-day averages";
  if (!closeAbove50 && closeAbove200) return "above the 200-day but below the 50-day average";
  if (closeAbove50 && !closeAbove200) return "above the 50-day but below the 200-day average";
  return "below both averages";
}

/** Symbol return minus benchmark return, in percentage points. */
export function relativeStrengthBand(pctPointsVsBenchmark: number | undefined): string {
  if (!isNum(pctPointsVsBenchmark)) return "unknown";
  if (pctPointsVsBenchmark < -8) return "much weaker than the market";
  if (pctPointsVsBenchmark < -2) return "weaker than the market";
  if (pctPointsVsBenchmark < 2) return "in line with the market";
  if (pctPointsVsBenchmark < 8) return "stronger than the market";
  return "much stronger than the market";
}

/** Expected reward over risk for the planned entry, e.g. 2 means 2 to 1. */
export function rewardToRiskBand(ratio: number | undefined): string {
  if (!isNum(ratio)) return "unknown";
  if (ratio < 1) return "unfavorable, under 1 to 1";
  if (ratio < 2) return "marginal, 1 to 2 to 1";
  if (ratio < 3) return "favorable, 2 to 3 to 1";
  return "very favorable, 3 to 1 or better";
}

/** Trading days until the next scheduled earnings report. */
export function earningsBand(tradingDaysAway: number | undefined): string {
  if (tradingDaysAway === undefined) return "no report scheduled soon";
  if (!isNum(tradingDaysAway)) return "unknown";
  if (tradingDaysAway < 0 || tradingDaysAway > 10) return "no report scheduled soon";
  if (tradingDaysAway <= 3) return "report within 3 trading days";
  return "report within 10 trading days";
}

/** Distance of the last price from the planned stop, in percent of entry. */
export function stopDistanceBand(stopDistancePct: number | undefined): string {
  if (!isNum(stopDistancePct)) return "unknown";
  if (stopDistancePct < 1) return "under 1 percent from the stop";
  if (stopDistancePct <= 3) return "1 to 3 percent from the stop";
  return "more than 3 percent from the stop";
}

/** Annualized 20-day realized volatility, in percent. */
export function realizedVolBand(volPct: number | undefined): string {
  if (!isNum(volPct)) return "unknown";
  if (volPct < 12) return "calm";
  if (volPct < 20) return "normal";
  if (volPct < 30) return "elevated";
  return "stressed";
}

/** VIX level. Edges follow the harness market-regime skill. */
export function vixBand(vix: number | undefined): string {
  if (!isNum(vix)) return "unknown";
  if (vix < 15) return "calm";
  if (vix < 22) return "normal";
  if (vix < 30) return "elevated";
  return "stressed";
}

/**
 * 10-year Treasury yield in percent. Edges are conventional regime cutoffs
 * (3% and 5%), not harness policy; only the VIX and volatility edges above
 * come from the design brief.
 */
export function yieldBand(yieldPct: number | undefined): string {
  if (!isNum(yieldPct)) return "unknown";
  if (yieldPct < 3) return "low";
  if (yieldPct < 5) return "normal";
  return "elevated";
}
