import type { Bar } from "@rh/shared";
import { atr, avgDollarVolume, closes, periodReturn, rsi, sma } from "../market/indicators.ts";

export type ScreenPreset =
  | "trend_template"
  | "breakout_52w"
  | "pullback_20d"
  | "rsi_oversold_uptrend"
  | "relative_strength"
  | "volatility_contraction";

export const SCREEN_PRESETS: readonly ScreenPreset[] = [
  "trend_template",
  "breakout_52w",
  "pullback_20d",
  "rsi_oversold_uptrend",
  "relative_strength",
  "volatility_contraction",
];

export type ScreenRow = {
  symbol: string;
  sector?: string;
  last: number;
  ret1m?: number;
  ret3m?: number;
  /** 3-month return minus the benchmark's. */
  relStrength?: number;
  /** Last close vs the 52-week high, as a fraction (negative at or below the high). */
  dist52w?: number;
  /** ATR(14) as a fraction of the last close. */
  atrPct?: number;
  rsi14?: number;
  above50?: boolean;
  above200?: boolean;
  /** 20-day average daily dollar volume, USD. */
  adv20?: number;
  /** Preset-specific rank score; higher is better. */
  score: number;
}

export type ScreenEval = {
  row?: ScreenRow;
  /** Why the symbol produced no row (too little history, rule miss, ...). */
  skip?: string;
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** SMA(period) now vs `lookback` sessions ago; rising when the fresh value is higher. */
function smaRising(c: number[], period: number, lookback = 10): boolean | undefined {
  const now = sma(c, period);
  if (now === undefined || c.length < period + lookback) return undefined;
  const then = sma(c.slice(0, c.length - lookback), period);
  if (then === undefined) return undefined;
  return now > then;
}

/** Consecutive sessions ending at the last bar whose close fell vs the prior close. */
export function pullbackDays(c: number[]): number {
  let n = 0;
  for (let i = c.length - 1; i > 0; i--) {
    if ((c[i] ?? 0) < (c[i - 1] ?? 0)) n++;
    else break;
  }
  return n;
}

function high52w(bars: Bar[]): number | undefined {
  const window = bars.slice(Math.max(0, bars.length - 252));
  if (window.length === 0) return undefined;
  return Math.max(...window.map((b) => b.high));
}

/** ATR(14)/close at each of the last `points` endpoints, oldest first. */
export function atrPctSeries(bars: Bar[], points = 252): number[] {
  const out: number[] = [];
  const start = Math.max(15, bars.length - points + 1);
  for (let end = start; end <= bars.length - 1; end++) {
    const slice = bars.slice(0, end + 1);
    const a = atr(slice, 14);
    const close = slice[slice.length - 1]?.close;
    if (a !== undefined && close !== undefined && close > 0) out.push(a / close);
  }
  return out;
}

export type ScreenContext = {
  symbol: string;
  bars: Bar[];
  sector?: string;
  benchRet3m?: number;
}

/** Pure rule evaluation over one symbol's bars (oldest first). Never touches the network or clock. */
export function evaluateScreen(ctx: ScreenContext, preset: ScreenPreset): ScreenEval {
  const { symbol, bars, sector, benchRet3m } = ctx;
  if (bars.length < 60) return { skip: `only ${bars.length} bars; need at least 60` };
  const c = closes(bars);
  const last = c[c.length - 1];
  if (last === undefined || last <= 0) return { skip: "no last close" };
  const sma20 = sma(c, 20);
  const sma50 = sma(c, 50);
  const sma200 = c.length >= 200 ? sma(c, 200) : undefined;
  const rsi14 = rsi(c, 14);
  const rsi2 = c.length >= 3 ? rsi(c, 2) : undefined;
  const atr14 = atr(bars, 14);
  const high = high52w(bars);
  const ret1m = periodReturn(c, 21);
  const ret3m = periodReturn(c, 63);
  const relStrength = ret3m === undefined || benchRet3m === undefined ? undefined : ret3m - benchRet3m;
  const base: Omit<ScreenRow, "score"> = {
    symbol,
    ...(sector === undefined ? {} : { sector }),
    last,
    ...(ret1m === undefined ? {} : { ret1m }),
    ...(ret3m === undefined ? {} : { ret3m }),
    ...(relStrength === undefined ? {} : { relStrength }),
    ...(high === undefined ? {} : { dist52w: last / high - 1 }),
    ...(atr14 === undefined ? {} : { atrPct: atr14 / last }),
    ...(rsi14 === undefined ? {} : { rsi14 }),
    ...(sma50 === undefined ? {} : { above50: last > sma50 }),
    ...(sma200 === undefined ? {} : { above200: last > sma200 }),
    ...(avgDollarVolume(bars, 20) === undefined ? {} : { adv20: avgDollarVolume(bars, 20) as number }),
  };

  switch (preset) {
    case "trend_template": {
      if (sma50 === undefined || sma200 === undefined) return { skip: "needs 200 bars for the 200-day average" };
      if (!(last > sma50 && sma50 > sma200)) return { skip: "not in a 50/200 uptrend" };
      if (smaRising(c, 50) !== true || smaRising(c, 200) !== true) return { skip: "averages are not rising" };
      if (high === undefined || last < 0.75 * high) return { skip: "more than 25% below the 52-week high" };
      return { row: { ...base, score: last / sma50 - 1 + (last / high - 1) } };
    }
    case "breakout_52w": {
      if (high === undefined) return { skip: "no 52-week high" };
      if (last < 0.97 * high) return { skip: "not within 3% of the 52-week high" };
      const vols = bars.slice(bars.length - 20).map((b) => b.volume);
      const avgVol = mean(vols);
      const volRatio = avgVol === undefined || avgVol === 0 ? undefined : bars[bars.length - 1]!.volume / avgVol;
      if (volRatio === undefined || volRatio <= 1) return { skip: "volume is not above its 20-day average" };
      return { row: { ...base, score: last / high - 1 + Math.log(volRatio) } };
    }
    case "pullback_20d": {
      if (sma50 === undefined || sma200 === undefined) return { skip: "needs 200 bars for the 50/200 rule" };
      if (!(last > sma50 && sma50 > sma200)) return { skip: "not in a 50/200 uptrend" };
      if (sma20 === undefined || atr14 === undefined) return { skip: "needs the 20-day average and ATR" };
      const down = pullbackDays(c);
      if (down < 3) return { skip: `only a ${down}-day pullback; need 3+` };
      if (Math.abs(last - sma20) > atr14) return { skip: "more than 1 ATR from the 20-day average" };
      if (last < sma20 - atr14) return { skip: "under the 20-day average by more than 1 ATR" };
      return { row: { ...base, score: down - Math.abs(last - sma20) / atr14 } };
    }
    case "rsi_oversold_uptrend": {
      if (sma200 === undefined) return { skip: "needs 200 bars for the 200-day average" };
      if (rsi2 === undefined) return { skip: "needs RSI(2)" };
      if (!(last > sma200)) return { skip: "below the 200-day average" };
      if (rsi2 >= 10) return { skip: `RSI(2) is ${rsi2.toFixed(1)}; need under 10` };
      return { row: { ...base, score: 10 - rsi2 } };
    }
    case "relative_strength": {
      if (relStrength === undefined) return { skip: "needs 3-month returns for the symbol and benchmark" };
      return { row: { ...base, score: relStrength } };
    }
    case "volatility_contraction": {
      if (sma50 === undefined) return { skip: "needs 50 bars" };
      if (!(last > sma50)) return { skip: "below the 50-day average" };
      const series = atrPctSeries(bars);
      if (series.length < 50) return { skip: `only ${series.length} ATR readings; need 50+` };
      const current = series[series.length - 1]!;
      const rank = series.filter((v) => v <= current).length / series.length;
      if (rank > 0.2) return { skip: `ATR% rank ${(rank * 100).toFixed(0)}th percentile; need bottom quintile` };
      return { row: { ...base, score: 0.2 - rank } };
    }
  }
}
