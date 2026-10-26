import type { Bar } from "@rh/shared";

/**
 * Pure deterministic indicators over daily Bar arrays (oldest first).
 * Every function returns `undefined` when there are not enough bars for a
 * meaningful value rather than a misleading number.
 */

export function closes(bars: Bar[]): number[] {
  return bars.map((b) => b.close);
}

export function sma(values: number[], period: number): number | undefined {
  if (values.length < period || period <= 0) return undefined;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i] ?? 0;
  return sum / period;
}

/** Classic EMA seeded with the SMA of the first `period` values. */
export function ema(values: number[], period: number): number | undefined {
  if (values.length < period || period <= 0) return undefined;
  const k = 2 / (period + 1);
  let prev = sma(values.slice(0, period), period);
  if (prev === undefined) return undefined;
  for (let i = period; i < values.length; i++) prev = (values[i] ?? prev) * k + prev * (1 - k);
  return prev;
}

/** Full EMA series (seeded with the first period's SMA), oldest first. */
export function emaSeries(values: number[], period: number): number[] {
  if (values.length < period || period <= 0) return [];
  const k = 2 / (period + 1);
  let prev = sma(values.slice(0, period), period) ?? 0;
  const out = new Array<number>(values.length).fill(prev);
  for (let i = period; i < values.length; i++) {
    prev = (values[i] ?? prev) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder RSI (default 14). Flat series yields 50; all-up yields 100. */
export function rsi(values: number[], period = 14): number | undefined {
  if (values.length < period + 1 || period <= 0) return undefined;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = (values[i] ?? 0) - (values[i - 1] ?? 0);
    if (diff > 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  // Wilder smoothing needs the earlier history; with exactly period+1 diffs
  // the seed average is the value. Re-run from the oldest diff when available.
  if (values.length > period + 1) {
    avgGain = 0;
    avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const diff = (values[i] ?? 0) - (values[i - 1] ?? 0);
      if (diff > 0) avgGain += diff;
      else avgLoss -= diff;
    }
    avgGain /= period;
    avgLoss /= period;
    for (let i = period + 1; i < values.length; i++) {
      const diff = (values[i] ?? 0) - (values[i - 1] ?? 0);
      const up = diff > 0 ? diff : 0;
      const down = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + up) / period;
      avgLoss = (avgLoss * (period - 1) + down) / period;
    }
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Wilder ATR (default 14) over daily bars. */
export function atr(bars: Bar[], period = 14): number | undefined {
  if (bars.length < period + 1 || period <= 0) return undefined;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    if (!cur || !prev) continue;
    trs.push(Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close)));
  }
  if (trs.length < period) return undefined;
  let prev = sma(trs.slice(0, period), period);
  if (prev === undefined) return undefined;
  for (let i = period; i < trs.length; i++) prev = (prev * (period - 1) + (trs[i] ?? prev)) / period;
  return prev;
}

export interface Macd {
  macd: number;
  signal: number;
  histogram: number;
}

/** MACD (12, 26, 9): needs at least 35 closes for a settled signal line. */
export function macd(values: number[]): Macd | undefined {
  if (values.length < 35) return undefined;
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);
  const line: number[] = values.map((_, i) => (fast[i] ?? 0) - (slow[i] ?? 0));
  // The MACD line is only settled once the slow EMA is settled; seed the
  // signal EMA on the settled tail.
  const settled = line.slice(25);
  const signalSeries = emaSeries(settled, 9);
  const signal = signalSeries[signalSeries.length - 1];
  const current = line[line.length - 1];
  if (signal === undefined || current === undefined) return undefined;
  return { macd: current, signal, histogram: current - signal };
}

export interface Bollinger {
  upper: number;
  middle: number;
  lower: number;
  percentB: number;
}

/** Bollinger bands (20, 2) at the last close. */
export function bollinger(values: number[], period = 20, mult = 2): Bollinger | undefined {
  if (values.length < period || period <= 0) return undefined;
  const window = values.slice(values.length - period);
  const middle = sma(window, period);
  if (middle === undefined) return undefined;
  let variance = 0;
  for (const v of window) variance += (v - middle) ** 2;
  const sd = Math.sqrt(variance / period);
  const upper = middle + mult * sd;
  const lower = middle - mult * sd;
  const last = values[values.length - 1];
  if (last === undefined) return undefined;
  const percentB = upper === lower ? 0.5 : (last - lower) / (upper - lower);
  return { upper, middle, lower, percentB };
}

export interface Donchian {
  high: number;
  low: number;
}

/** Highest high / lowest low of the last `period` bars. */
export function donchian(bars: Bar[], period = 20): Donchian | undefined {
  if (bars.length < period || period <= 0) return undefined;
  const window = bars.slice(bars.length - period);
  let high = -Infinity;
  let low = Infinity;
  for (const b of window) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
  }
  return { high, low };
}

/** Period return over the last `sessions` sessions (needs sessions+1 bars). */
export function periodReturn(values: number[], sessions: number): number | undefined {
  if (values.length < sessions + 1 || sessions <= 0) return undefined;
  const last = values[values.length - 1];
  const first = values[values.length - 1 - sessions];
  if (last === undefined || first === undefined || first === 0) return undefined;
  return last / first - 1;
}

/** Annualized realized volatility (sqrt(periodsPerYear) on daily log-return stdev; 252 for equities, 365 for crypto). */
export function realizedVol(values: number[], sessions = 20, periodsPerYear = 252): number | undefined {
  if (values.length < sessions + 1 || sessions < 2) return undefined;
  const rets: number[] = [];
  for (let i = values.length - sessions; i < values.length; i++) {
    const cur = values[i];
    const prev = values[i - 1];
    if (cur === undefined || prev === undefined || cur <= 0 || prev <= 0) return undefined;
    rets.push(Math.log(cur / prev));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * periodsPerYear);
}

/** Worst peak-to-trough drawdown (as a negative fraction) over the values. */
export function maxDrawdown(values: number[]): number | undefined {
  if (values.length < 2) return undefined;
  let peak = values[0] ?? 0;
  let worst = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) worst = Math.min(worst, v / peak - 1);
  }
  return worst;
}

/** Average daily dollar volume (close * volume) over the last `days` sessions. */
export function avgDollarVolume(bars: Bar[], days: number): number | undefined {
  if (bars.length < days || days <= 0) return undefined;
  const window = bars.slice(bars.length - days);
  let sum = 0;
  for (const b of window) sum += b.close * b.volume;
  return sum / window.length;
}

/** Daily simple returns keyed by date, oldest first. */
export function dailyReturns(bars: Bar[]): { date: string; r: number }[] {
  const out: { date: string; r: number }[] = [];
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    if (!cur || !prev || prev.close === 0) continue;
    out.push({ date: cur.date, r: cur.close / prev.close - 1 });
  }
  return out;
}

/** Intersect two return series on date; returns paired returns. */
export function alignReturns(
  a: { date: string; r: number }[],
  b: { date: string; r: number }[],
): { a: number[]; b: number[] } {
  const mapB = new Map(b.map((p) => [p.date, p.r]));
  const pa: number[] = [];
  const pb: number[] = [];
  for (const p of a) {
    const q = mapB.get(p.date);
    if (q !== undefined) {
      pa.push(p.r);
      pb.push(q);
    }
  }
  return { a: pa, b: pb };
}

export function correlation(xs: number[], ys: number[]): number | undefined {
  if (xs.length !== ys.length || xs.length < 2) return undefined;
  const n = xs.length;
  const mx = xs.reduce((a, v) => a + v, 0) / n;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - mx;
    const dy = (ys[i] ?? 0) - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return undefined;
  return cov / Math.sqrt(vx * vy);
}

/** Beta of xs against benchmark ys (paired daily returns). */
export function beta(xs: number[], ys: number[]): number | undefined {
  if (xs.length !== ys.length || xs.length < 2) return undefined;
  const n = xs.length;
  const mx = xs.reduce((a, v) => a + v, 0) / n;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let cov = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    cov += ((xs[i] ?? 0) - mx) * ((ys[i] ?? 0) - my);
    vy += ((ys[i] ?? 0) - my) ** 2;
  }
  if (vy === 0) return undefined;
  return cov / vy;
}

/** Beta and correlation of a symbol's daily returns against a benchmark, aligned by date. */
export function betaAndCorrelation(
  symbolBars: Bar[],
  benchmarkBars: Bar[],
): { beta: number | undefined; correlation: number | undefined } {
  const { a, b } = alignReturns(dailyReturns(symbolBars), dailyReturns(benchmarkBars));
  if (a.length < 2) return { beta: undefined, correlation: undefined };
  return { beta: beta(a, b), correlation: correlation(a, b) };
}

export type Trend = "up" | "down" | "sideways";

/** Uptrend when close > sma50 > sma200, downtrend for the mirror, else sideways. */
export function classifyTrend(close: number | undefined, sma50: number | undefined, sma200: number | undefined): Trend {
  if (close !== undefined && sma50 !== undefined && sma200 !== undefined) {
    if (close > sma50 && sma50 > sma200) return "up";
    if (close < sma50 && sma50 < sma200) return "down";
  }
  return "sideways";
}
