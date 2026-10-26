import type { Bar } from "@rh/shared";
import { atr, closes, rsi, sma } from "../market/indicators.ts";

export type BacktestEntry =
  | "breakout_20d"
  | "pullback_20sma_uptrend"
  | "rsi2_mean_reversion"
  | "sma_cross_20_50"
  | "trend_template";

export const BACKTEST_ENTRIES: readonly BacktestEntry[] = [
  "breakout_20d",
  "pullback_20sma_uptrend",
  "rsi2_mean_reversion",
  "sma_cross_20_50",
  "trend_template",
];

export type BacktestExit = {
  /** Stop distance in multiples of ATR(14) at the signal day. */
  stopAtr: number;
  /** Optional profit target in multiples of the initial risk. */
  targetR?: number;
  /** Sessions after entry, then exit at the close. */
  timeStopDays: number;
  /** Optional trailing stop in ATR multiples, ratcheted from the highest high since entry. */
  trailAtr?: number;
}

export type ExitReason = "stop" | "target" | "trail" | "time" | "end";

export type BacktestTrade = {
  symbol: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  /** Net P&L in units of initial risk (costs included). */
  pnlR: number;
  /** Net return on notional, costs included, as a fraction. */
  returnPct: number;
  holdingDays: number;
  exitReason: ExitReason;
}

export type SymbolBacktest = {
  symbol: string;
  bars: number;
  firstDate?: string;
  lastDate?: string;
  trades: number;
  wins: number;
  winRate?: number;
  avgR?: number;
  expectancyR?: number;
  profitFactor?: number;
  maxDrawdownR?: number;
  avgHoldingDays?: number;
  timeInvestedPct?: number;
  buyHoldReturn?: number;
  lastTrades: BacktestTrade[];
}

export type PooledBacktest = {
  symbols: number;
  trades: number;
  wins: number;
  winRate?: number;
  avgR?: number;
  expectancyR?: number;
  profitFactor?: number;
  maxDrawdownR?: number;
  avgHoldingDays?: number;
  timeInvestedPct?: number;
  buyHoldReturn?: number;
  lastTrades: BacktestTrade[];
  /** Set when the pooled sample is too small to trust. */
  warning?: string;
}

export type BacktestResult = {
  entry: BacktestEntry;
  exit: BacktestExit;
  years: number;
  costBps: number;
  symbols: SymbolBacktest[];
  pooled: PooledBacktest;
}

/** Signal on the close of bar i (fills at the next open). Prefix is bars[0..i]. */
function entrySignal(prefix: Bar[], entry: BacktestEntry): boolean {
  const c = closes(prefix);
  const i = prefix.length - 1;
  const last = c[i];
  if (last === undefined) return false;
  switch (entry) {
    case "breakout_20d": {
      if (prefix.length < 21) return false;
      const priorHigh = Math.max(...prefix.slice(i - 20, i).map((b) => b.high));
      return last > priorHigh;
    }
    case "pullback_20sma_uptrend": {
      if (prefix.length < 201) return false;
      const s20 = sma(c, 20);
      const s50 = sma(c, 50);
      const s200 = sma(c, 200);
      const a = atr(prefix, 14);
      if (s20 === undefined || s50 === undefined || s200 === undefined || a === undefined) return false;
      return last > s50 && s50 > s200 && last <= s20 && last >= s20 - a;
    }
    case "rsi2_mean_reversion": {
      if (prefix.length < 4) return false;
      const r = rsi(c, 2);
      return r !== undefined && r < 10;
    }
    case "sma_cross_20_50": {
      if (prefix.length < 52) return false;
      const s20 = sma(c, 20);
      const s50 = sma(c, 50);
      const prev20 = sma(c.slice(0, c.length - 1), 20);
      const prev50 = sma(c.slice(0, c.length - 1), 50);
      if (s20 === undefined || s50 === undefined || prev20 === undefined || prev50 === undefined) return false;
      return prev20 <= prev50 && s20 > s50;
    }
    case "trend_template": {
      if (prefix.length < 252) return false;
      const s50 = sma(c, 50);
      const s200 = sma(c, 200);
      if (s50 === undefined || s200 === undefined) return false;
      if (!(last > s50 && s50 > s200)) return false;
      const past50 = sma(c.slice(0, c.length - 10), 50);
      const past200 = sma(c.slice(0, c.length - 10), 200);
      if (past50 === undefined || past200 === undefined) return false;
      if (!(s50 > past50 && s200 > past200)) return false;
      const high = Math.max(...prefix.slice(Math.max(0, prefix.length - 252)).map((b) => b.high));
      return last >= 0.75 * high;
    }
  }
}

function maxDrawdownOf(equity: number[]): number | undefined {
  if (equity.length < 2) return undefined;
  let peak = equity[0] ?? 0;
  let worst = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    worst = Math.min(worst, v - peak);
  }
  return worst;
}

function summarize(symbol: string, trades: BacktestTrade[], bars: Bar[], windowStart: number): SymbolBacktest {
  const wins = trades.filter((t) => t.pnlR > 0).length;
  const pnls = trades.map((t) => t.pnlR);
  const grossProfit = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = -pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0);
  const equity: number[] = [];
  let cum = 0;
  for (const p of pnls) {
    cum += p;
    equity.push(cum);
  }
  const window = bars.slice(windowStart);
  const inMarket = new Set<string>();
  for (const t of trades) {
    const from = bars.findIndex((b) => b.date >= t.entryDate);
    const to = bars.findIndex((b) => b.date > t.exitDate);
    const end = to === -1 ? bars.length : to;
    for (let i = Math.max(0, from); i < end; i++) inMarket.add(bars[i]!.date);
  }
  const first = window[0];
  const lastBar = window[window.length - 1];
  const buyHold =
    first !== undefined && lastBar !== undefined && first.close > 0 ? lastBar.close / first.close - 1 : undefined;
  const holding = trades.map((t) => t.holdingDays);
  return {
    symbol,
    bars: window.length,
    ...(first === undefined ? {} : { firstDate: first.date }),
    ...(lastBar === undefined ? {} : { lastDate: lastBar.date }),
    trades: trades.length,
    wins,
    ...(trades.length === 0 ? {} : { winRate: wins / trades.length }),
    ...(trades.length === 0
      ? {}
      : {
          avgR: pnls.reduce((a, b) => a + b, 0) / pnls.length,
          expectancyR: pnls.reduce((a, b) => a + b, 0) / pnls.length,
          profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : undefined,
          maxDrawdownR: maxDrawdownOf(equity),
          avgHoldingDays: holding.reduce((a, b) => a + b, 0) / holding.length,
          timeInvestedPct: window.length === 0 ? undefined : (inMarket.size / window.length) * 100,
        }),
    ...(buyHold === undefined ? {} : { buyHoldReturn: buyHold }),
    lastTrades: [...trades].sort((a, b) => (a.exitDate < b.exitDate ? -1 : 1)).slice(-5),
  };
}

/**
 * Deterministic rule backtest over daily bars (oldest first per symbol).
 * Signals use the signal day's close and fill at the next day's open;
 * stops/targets are checked on later bars with gaps filling at the open.
 * One position per symbol at a time. Pure: no network, no clock.
 */
export function runBacktest(
  barsBySymbol: Map<string, Bar[]>,
  opts: { entry: BacktestEntry; exit: BacktestExit; years: number; costBps: number },
): BacktestResult {
  const { entry, exit, years, costBps } = opts;
  const costRate = costBps / 10_000;
  const windowSessions = Math.round(years * 252);
  const symbols: SymbolBacktest[] = [];
  const pooledTrades: BacktestTrade[] = [];
  let pooledInMarket = 0;
  let pooledBars = 0;
  const buyHolds: number[] = [];

  for (const [symbol, bars] of barsBySymbol) {
    const trades: BacktestTrade[] = [];
    const windowStart = Math.max(0, bars.length - windowSessions);
    let i = windowStart;
    while (i < bars.length - 1) {
      const prefix = bars.slice(0, i + 1);
      if (!entrySignal(prefix, entry)) {
        i++;
        continue;
      }
      const signalAtr = atr(prefix, 14);
      if (signalAtr === undefined) {
        i++;
        continue;
      }
      const entryBar = bars[i + 1]!;
      const entryPrice = entryBar.open;
      if (entryPrice <= 0) {
        i++;
        continue;
      }
      const stop = entryPrice - exit.stopAtr * signalAtr;
      const risk = entryPrice - stop;
      if (!(risk > 0)) {
        i++;
        continue;
      }
      const target = exit.targetR === undefined ? undefined : entryPrice + exit.targetR * risk;
      let high = entryBar.high;
      let done: BacktestTrade | undefined;
      for (let j = i + 1; j < bars.length; j++) {
        const bar = bars[j]!;
        if (bar.high > high) high = bar.high;
        let effStop = stop;
        let reason: ExitReason = "stop";
        if (exit.trailAtr !== undefined) {
          const trail = high - exit.trailAtr * signalAtr;
          if (trail > effStop) {
            effStop = trail;
            reason = "trail";
          }
        }
        let fill: number | undefined;
        if (bar.open <= effStop) {
          fill = bar.open;
        } else if (target !== undefined && bar.open >= target) {
          fill = bar.open;
          reason = "target";
        } else if (bar.low <= effStop) {
          fill = effStop;
        } else if (target !== undefined && bar.high >= target) {
          fill = target;
          reason = "target";
        } else if (j - (i + 1) + 1 >= exit.timeStopDays) {
          fill = bar.close;
          reason = "time";
        }
        if (fill !== undefined && fill > 0) {
          const entryNet = entryPrice * (1 + costRate);
          const exitNet = fill * (1 - costRate);
          done = {
            symbol,
            entryDate: entryBar.date,
            exitDate: bar.date,
            entryPrice,
            exitPrice: fill,
            pnlR: (exitNet - entryNet) / risk,
            returnPct: exitNet / entryNet - 1,
            holdingDays: j - (i + 1) + 1,
            exitReason: reason,
          };
          trades.push(done);
          i = j + 1;
          break;
        }
      }
      if (done === undefined) {
        // Still open at the end of history: close at the last close ("end").
        const lastBar = bars[bars.length - 1]!;
        const entryNet = entryPrice * (1 + costRate);
        const exitNet = lastBar.close * (1 - costRate);
        if (lastBar.close > 0 && bars.length - 1 > i + 1) {
          trades.push({
            symbol,
            entryDate: entryBar.date,
            exitDate: lastBar.date,
            entryPrice,
            exitPrice: lastBar.close,
            pnlR: (exitNet - entryNet) / risk,
            returnPct: exitNet / entryNet - 1,
            holdingDays: bars.length - 1 - (i + 1) + 1,
            exitReason: "end",
          });
        }
        break;
      }
    }
    const summary = summarize(symbol, trades, bars, windowStart);
    symbols.push(summary);
    pooledTrades.push(...trades);
    const window = bars.slice(windowStart);
    pooledBars += window.length;
    const dates = new Set<string>();
    for (const t of trades) {
      const from = bars.findIndex((b) => b.date >= t.entryDate);
      const to = bars.findIndex((b) => b.date > t.exitDate);
      const end = to === -1 ? bars.length : to;
      for (let k = Math.max(0, from); k < end; k++) dates.add(bars[k]!.date);
    }
    pooledInMarket += dates.size;
    if (summary.buyHoldReturn !== undefined) buyHolds.push(summary.buyHoldReturn);
  }

  pooledTrades.sort((a, b) => (a.exitDate < b.exitDate ? -1 : a.exitDate > b.exitDate ? 1 : 0));
  const pnls = pooledTrades.map((t) => t.pnlR);
  const grossProfit = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = -pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0);
  const equity: number[] = [];
  let cum = 0;
  for (const p of pnls) {
    cum += p;
    equity.push(cum);
  }
  const holdings = pooledTrades.map((t) => t.holdingDays);
  const pooled: PooledBacktest = {
    symbols: symbols.length,
    trades: pooledTrades.length,
    wins: pooledTrades.filter((t) => t.pnlR > 0).length,
    ...(pooledTrades.length === 0
      ? {}
      : {
          winRate: pooledTrades.filter((t) => t.pnlR > 0).length / pooledTrades.length,
          avgR: pnls.reduce((a, b) => a + b, 0) / pnls.length,
          expectancyR: pnls.reduce((a, b) => a + b, 0) / pnls.length,
          profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : undefined,
          maxDrawdownR: maxDrawdownOf(equity),
          avgHoldingDays: holdings.reduce((a, b) => a + b, 0) / holdings.length,
          timeInvestedPct: pooledBars === 0 ? undefined : (pooledInMarket / pooledBars) * 100,
        }),
    ...(buyHolds.length === 0 ? {} : { buyHoldReturn: buyHolds.reduce((a, b) => a + b, 0) / buyHolds.length }),
    lastTrades: pooledTrades.slice(-5),
    ...(pooledTrades.length < 30
      ? { warning: `Only ${pooledTrades.length} pooled trades; under 30, so the result is suggestive, not conclusive.` }
      : {}),
  };
  return { entry, exit, years, costBps, symbols, pooled };
}
