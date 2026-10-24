import type {
  AccountSnapshot,
  AnalyticsRange,
  ClosedTrade,
  EquityHistory,
  ExposureRow,
  MarketOverview,
  OrderStatus,
  PerformanceSummary,
  PriceHistory,
  SymbolDetail,
  TrendRow,
} from "@rh/shared";
import type { Broker, Clock, Logger, MarketCalendar, MarketData, Notes, Store } from "../ports.ts";
import { MarketCache, etDate } from "../market/cache.ts";
import { avgDollarVolume, atr, classifyTrend, closes, periodReturn, rsi, sma } from "../market/indicators.ts";
import { fetchEconomicEvents } from "../market/sources/nasdaq.ts";
import { fetchVixSeries } from "../market/sources/cboe.ts";
import { fetchYieldCurve } from "../market/sources/treasury.ts";
import {
  brierScore,
  calibrationBuckets,
  classifyRegime,
  economicCalendar,
  holdingsReplayValues,
  maxDrawdownPct,
  pairHarnessTrades,
  parseThesisStop,
  returnPct,
  summarizeTrades,
} from "./compute.ts";

export interface AnalyticsDeps {
  store: Store;
  market: MarketData;
  broker: Broker;
  getAccount: () => AccountSnapshot | null;
  notes: Notes;
  calendar: MarketCalendar;
  clock: Clock;
  log: Logger;
  dataDir: string;
}

const RANGE_DAYS: Record<AnalyticsRange, number> = { "1m": 31, "3m": 93, "1y": 365, "all": 0 };

const INDEX_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA"] as const;
const SECTOR_SYMBOLS = ["XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLB", "XLU", "XLRE", "XLC"] as const;

const SYMBOL_NAMES: Record<string, string> = {
  SPY: "S&P 500",
  QQQ: "Nasdaq 100",
  IWM: "Russell 2000",
  DIA: "Dow Jones",
  XLK: "Technology",
  XLF: "Financials",
  XLE: "Energy",
  XLV: "Health Care",
  XLY: "Consumer Discretionary",
  XLP: "Consumer Staples",
  XLI: "Industrials",
  XLB: "Materials",
  XLU: "Utilities",
  XLRE: "Real Estate",
  XLC: "Communication",
};

const YIELD_TENORS = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"] as const;
const OVERVIEW_CACHE_MS = 15 * 60_000;
const FETCH_POOL = 6;

function etDateMinusDays(today: string, days: number): string {
  return new Date(new Date(`${today}T12:00:00Z`).getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

function etDatePlusDays(today: string, days: number): string {
  return new Date(new Date(`${today}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Close on `date`, or the most recent earlier close (up to 10 calendar days back). */
function closeOnOrBefore(byDate: Map<string, number>, date: string): number | undefined {
  for (let back = 0; back <= 10; back++) {
    const day = etDateMinusDays(date, back);
    const close = byDate.get(day);
    if (close !== undefined) return close;
  }
  return undefined;
}

/** Bounded-concurrency map that never throws: each item resolves to a settled result. */
async function mapSettled<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<{ item: T; value?: R }[]> {
  const out: { item: T; value?: R }[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(undefined).map(async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index] as T;
      try {
        out[index] = { item, value: await fn(item) };
      } catch {
        out[index] = { item };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

function trendRow(symbol: string, bars: PriceHistory["bars"], spyCloses: number[] | undefined): TrendRow | undefined {
  if (bars.length < 2) return undefined;
  const c = closes(bars);
  const last = c[c.length - 1] as number;
  const prev = c[c.length - 2] as number;
  const sma50 = sma(c, 50);
  const sma200 = sma(c, 200);
  const ret1m = periodReturn(c, 21);
  const ret3m = periodReturn(c, 63);
  const row: TrendRow = {
    symbol,
    ...(SYMBOL_NAMES[symbol] === undefined ? {} : { name: SYMBOL_NAMES[symbol] }),
    last,
    changePct1d: (last / prev - 1) * 100,
    return1m: ret1m === undefined ? 0 : ret1m * 100,
    return3m: ret3m === undefined ? 0 : ret3m * 100,
    aboveSma50: sma50 === undefined ? false : last > sma50,
    aboveSma200: sma200 === undefined ? false : last > sma200,
    ...(rsi(c, 14) === undefined ? {} : { rsi14: rsi(c, 14) as number }),
    spark: c.slice(Math.max(0, c.length - 60)),
  };
  if (spyCloses !== undefined && ret3m !== undefined) {
    const spyRet3m = periodReturn(spyCloses, 63);
    if (spyRet3m !== undefined) row.relStrength3m = (ret3m - spyRet3m) * 100;
  }
  return row;
}

export function createAnalyticsService(deps: AnalyticsDeps) {
  const cache = new MarketCache(deps.dataDir, deps.log, deps.clock);
  let overviewCache: { at: number; data: MarketOverview } | undefined;

  /** Stop for a held symbol: held stop order, then Robinhood stop, then the thesis invalidation. */
  async function resolveStop(symbol: string, rhStops: { symbol: string; stopPrice: number }[]): Promise<{ price: number; source: "held" | "robinhood" | "thesis" } | undefined> {
    const held = deps.store
      .ordersSince(0)
      .filter((o) => o.status === "held" && o.intent.symbol === symbol && o.intent.stopPrice !== undefined)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (held?.intent.stopPrice !== undefined) return { price: held.intent.stopPrice, source: "held" };
    const rh = rhStops.find((s) => s.symbol === symbol);
    if (rh !== undefined) return { price: rh.stopPrice, source: "robinhood" };
    try {
      const thesis = await deps.notes.read(`theses/${symbol}.md`);
      if (thesis !== undefined) {
        const price = parseThesisStop(thesis.content);
        if (price !== undefined) return { price, source: "thesis" };
      }
    } catch {
      // A missing or unreadable thesis simply means no thesis stop.
    }
    return undefined;
  }

  async function readRhStops(): Promise<{ symbol: string; stopPrice: number }[]> {
    if (deps.broker.status().state !== "connected" || typeof deps.broker.openStopOrders !== "function") return [];
    try {
      return await deps.broker.openStopOrders();
    } catch (error) {
      deps.log.warn("robinhood stop orders unavailable", { error: error instanceof Error ? error.message : "unknown" });
      return [];
    }
  }

  async function historyCloses(symbols: readonly string[], range: "1y" | "5y"): Promise<Map<string, Map<string, number>>> {
    const settled = await mapSettled(symbols, FETCH_POOL, (symbol) => deps.market.history(symbol, range));
    const out = new Map<string, Map<string, number>>();
    for (const { item, value } of settled) {
      if (value === undefined) continue;
      out.set(item, new Map(value.bars.map((b) => [b.date, b.close])));
    }
    return out;
  }

  async function equity(range: AnalyticsRange): Promise<EquityHistory> {
    const today = deps.calendar.etDate(deps.clock.now());
    const days = RANGE_DAYS[range];
    const cutoff = days === 0 ? "0000-00-00" : etDateMinusDays(today, days);
    // equity_marks already keeps one row per ET day, so every range over 1m
    // is naturally thinned to a single point per day.
    const rows = deps.store.equitySeries().filter((r) => r.etDate >= cutoff && r.etDate <= today);
    const points: EquityHistory["points"] = rows.map((r) => ({
      at: Date.parse(`${r.etDate}T12:00:00Z`),
      date: r.etDate,
      // The day's latest observed equity: a close while marks keep arriving through the session.
      equity: r.dayLast,
    }));
    // Trading days in the range, from SPY's bars: the replay's x axis, independent of when marks began.
    let tradingDays: string[] = [];
    try {
      const spy = await deps.market.history("SPY", range === "all" ? "5y" : "1y");
      tradingDays = spy.bars.map((b) => b.date).filter((date) => date >= cutoff && date <= today);
      const byDate = new Map(spy.bars.map((b) => [b.date, b.close]));
      const first = points[0];
      const base = first === undefined ? undefined : closeOnOrBefore(byDate, first.date);
      if (first !== undefined && base !== undefined && base > 0) {
        for (const point of points) {
          const close = closeOnOrBefore(byDate, point.date);
          if (close !== undefined) point.benchmark = (close / base) * first.equity;
        }
      }
    } catch (error) {
      deps.log.warn("equity benchmark unavailable", { error: error instanceof Error ? error.message : "unknown" });
    }
    const history: EquityHistory = { points, holdingsReplay: [] };
    const equities = points.map((p) => p.equity);
    if (points.length >= 2) {
      const ret = returnPct(equities);
      if (ret !== undefined) history.returnPct = ret;
      const benchmarks = points.map((p) => p.benchmark).filter((b): b is number => b !== undefined);
      if (benchmarks.length >= 2) {
        const benchRet = returnPct(benchmarks);
        if (benchRet !== undefined) history.benchmarkReturnPct = benchRet;
      }
      const dd = maxDrawdownPct(equities);
      if (dd !== undefined) history.maxDrawdownPct = dd;
    }
    const account = deps.getAccount();
    if (account !== null && tradingDays.length > 0) {
      const closesBySymbol = await historyCloses(account.positions.map((p) => p.symbol), range === "all" ? "5y" : "1y");
      const plain: Record<string, Record<string, number>> = {};
      for (const [symbol, byDate] of closesBySymbol) plain[symbol] = Object.fromEntries(byDate);
      history.holdingsReplay = holdingsReplayValues(
        tradingDays,
        plain,
        account.positions.map((p) => ({ symbol: p.symbol, quantity: p.quantity })),
        account.cash,
      );
    }
    return history;
  }

  async function performance(): Promise<PerformanceSummary> {
    const orders = deps.store.ordersSince(0);
    const harness = pairHarnessTrades(orders);
    let robinhood: ClosedTrade[] = [];
    if (deps.broker.status().state === "connected" && typeof deps.broker.tradeHistory === "function") {
      try {
        robinhood = (await deps.broker.tradeHistory()).map((t) => ({
          symbol: t.symbol,
          closedAt: t.closedAt,
          quantity: t.quantity,
          exitPrice: t.exitPrice,
          pnl: t.pnl,
          source: "robinhood" as const,
        }));
      } catch (error) {
        // Older trades are a supplement: a disconnected or failing broker
        // still yields the full harness picture.
        deps.log.warn("robinhood trade history unavailable", { error: error instanceof Error ? error.message : "unknown" });
      }
    }
    const trades = [...harness, ...robinhood].sort((a, b) => a.closedAt - b.closedAt);
    const summary = summarizeTrades(trades);
    const rhStops = await readRhStops();
    const account = deps.getAccount();
    const equityValue = account?.equity ?? 0;
    const exposure: ExposureRow[] = [];
    for (const position of account?.positions ?? []) {
      const row: ExposureRow = {
        symbol: position.symbol,
        ...(position.sector === undefined ? {} : { sector: position.sector }),
        marketValue: position.marketValue,
        weightPct: equityValue > 0 ? (position.marketValue / equityValue) * 100 : 0,
        unrealizedPnl: position.unrealizedPnl,
      };
      const stop = await resolveStop(position.symbol, rhStops);
      if (stop !== undefined) {
        row.stopPrice = stop.price;
        if (equityValue > 0) row.riskToStopPct = ((position.marketValue - stop.price * position.quantity) / equityValue) * 100;
      }
      exposure.push(row);
    }
    const sectors = new Map<string, number>();
    for (const position of account?.positions ?? []) {
      sectors.set(position.sector ?? "Unknown", (sectors.get(position.sector ?? "Unknown") ?? 0) + position.marketValue);
    }
    const ordersByStatus: Partial<Record<OrderStatus, number>> = {};
    for (const o of orders) ordersByStatus[o.status] = (ordersByStatus[o.status] ?? 0) + 1;
    const heat = exposure.reduce((sum, e) => sum + Math.max(0, e.riskToStopPct ?? 0), 0);
    return {
      trades,
      realizedPnl: summary.realizedPnl,
      ...(summary.winRatePct === undefined ? {} : { winRatePct: summary.winRatePct }),
      ...(summary.avgR === undefined ? {} : { avgR: summary.avgR }),
      ...(summary.expectancy === undefined ? {} : { expectancy: summary.expectancy }),
      ...(summary.profitFactor === undefined ? {} : { profitFactor: summary.profitFactor }),
      ...(summary.avgHoldingDays === undefined ? {} : { avgHoldingDays: summary.avgHoldingDays }),
      ...(() => {
        const brier = brierScore(harness);
        return brier === undefined ? {} : { brier };
      })(),
      calibration: calibrationBuckets(harness),
      exposure,
      sectors: [...sectors].map(([sector, marketValue]) => ({
        sector,
        weightPct: equityValue > 0 ? (marketValue / equityValue) * 100 : 0,
      })),
      ...(equityValue > 0 ? { heatPct: heat } : {}),
      ordersByStatus,
    };
  }

  async function marketOverview(): Promise<MarketOverview> {
    const now = deps.clock.now();
    if (overviewCache !== undefined && now - overviewCache.at < OVERVIEW_CACHE_MS) return overviewCache.data;
    const today = etDate(now);
    const spy = await deps.market.history("SPY", "1y");
    if (spy.bars.length < 2) throw new Error("SPY history is empty");
    const spyCloses = closes(spy.bars);
    const rest = await mapSettled([...INDEX_SYMBOLS.slice(1), ...SECTOR_SYMBOLS], FETCH_POOL, (symbol) => deps.market.history(symbol, "1y"));
    const bySymbol = new Map<string, PriceHistory["bars"]>([["SPY", spy.bars]]);
    for (const { item, value } of rest) {
      if (value !== undefined) bySymbol.set(item, value.bars);
    }
    const indices: TrendRow[] = [];
    for (const symbol of INDEX_SYMBOLS) {
      const bars = bySymbol.get(symbol);
      if (bars === undefined) continue;
      const row = trendRow(symbol, bars, undefined);
      if (row !== undefined) indices.push(row);
    }
    const sectors: TrendRow[] = [];
    for (const symbol of SECTOR_SYMBOLS) {
      const bars = bySymbol.get(symbol);
      if (bars === undefined) continue;
      const row = trendRow(symbol, bars, spyCloses);
      if (row !== undefined) sectors.push(row);
    }
    const vixBars = await fetchVixSeries(cache, "VIX");
    if (vixBars.length === 0) throw new Error("VIX history is empty");
    const vixCloses = vixBars.map((b) => b.close);
    const vix = vixCloses[vixCloses.length - 1] as number;
    const window = vixCloses.slice(Math.max(0, vixCloses.length - 252));
    const percentile = window.length === 0 ? undefined : (window.filter((c) => c <= vix).length / window.length) * 100;
    const recent20 = vixCloses.slice(Math.max(0, vixCloses.length - 20));
    const vixSma20 = recent20.length === 0 ? undefined : recent20.reduce((a, b) => a + b, 0) / recent20.length;
    let vix9d: number | undefined;
    let vix3m: number | undefined;
    try {
      const [nine, three] = await Promise.all([fetchVixSeries(cache, "VIX9D"), fetchVixSeries(cache, "VIX3M")]);
      vix9d = nine[nine.length - 1]?.close;
      vix3m = three[three.length - 1]?.close;
    } catch {
      // Term-structure legs are supplementary; VIX alone still sets the regime.
    }
    let yields: MarketOverview["yields"] = [];
    let tenYearHistory: MarketOverview["tenYearHistory"] = [];
    try {
      const curve = await fetchYieldCurve(cache, Number(today.slice(0, 4)));
      const latest = curve[curve.length - 1];
      if (latest !== undefined) {
        yields = YIELD_TENORS.filter((t) => latest.curve[t] !== undefined).map((t) => ({ tenor: t, yieldPct: latest.curve[t] as number }));
        const yearAgo = etDateMinusDays(today, 365);
        tenYearHistory = curve
          .filter((r) => r.date >= yearAgo && r.curve["10Y"] !== undefined)
          .map((r) => ({ date: r.date, value: r.curve["10Y"] as number }));
      }
    } catch (error) {
      deps.log.warn("treasury yields unavailable", { error: error instanceof Error ? error.message : "unknown" });
    }
    const spyLast = spyCloses[spyCloses.length - 1] as number;
    const spyHigh52 = Math.max(...spy.bars.slice(Math.max(0, spy.bars.length - 252)).map((b) => b.high));
    const breadth = {
      aboveSma50: sectors.filter((s) => s.aboveSma50).length,
      total: SECTOR_SYMBOLS.length,
    };
    const regime = classifyRegime({
      trend: classifyTrend(spyLast, sma(spyCloses, 50), sma(spyCloses, 200)),
      vix,
      ...(percentile === undefined ? {} : { vixPercentile: percentile }),
      ...(vixSma20 === undefined ? {} : { vixSma20 }),
      drawdownFromHigh52w: spyHigh52 <= 0 ? 0 : 1 - spyLast / spyHigh52,
    });
    const calendarDays = Array.from({ length: 7 }, (_, i) => etDatePlusDays(today, i));
    const calendarSettled = await mapSettled(calendarDays, FETCH_POOL, (date) => fetchEconomicEvents(cache, date));
    const calendar: MarketOverview["calendar"] = economicCalendar(
      calendarSettled.flatMap(({ item, value }) => (value === undefined ? [] : [{ date: item, events: value }])),
    );
    const account = deps.getAccount();
    const earningsUniverse = [...new Set([...(account?.positions.map((p) => p.symbol) ?? []), ...deps.store.getSettings().watchlist])].slice(0, 40);
    const heldSet = new Set(account?.positions.map((p) => p.symbol) ?? []);
    const earningsSettled = await mapSettled(earningsUniverse, FETCH_POOL, (symbol) => deps.market.nextEarnings(symbol));
    const earnings: MarketOverview["earnings"] = [];
    for (const { item, value } of earningsSettled) {
      if (value === undefined) continue;
      earnings.push({ symbol: item, date: value, held: heldSet.has(item) });
    }
    earnings.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const data: MarketOverview = {
      asOf: now,
      regime,
      indices,
      sectors,
      volatility: {
        vix,
        ...(vix9d === undefined ? {} : { vix9d }),
        ...(vix3m === undefined ? {} : { vix3m }),
        ...(percentile === undefined ? {} : { percentile }),
        contango: vix3m === undefined ? true : vix3m >= vix,
        history: vixBars.slice(Math.max(0, vixBars.length - 252)).map((b) => ({ date: b.date, value: b.close })),
      },
      yields,
      tenYearHistory,
      breadth,
      calendar,
      earnings,
    };
    overviewCache = { at: now, data };
    return data;
  }

  async function symbolDetail(symbol: string): Promise<SymbolDetail> {
    const history = await deps.market.history(symbol, "1y");
    if (history.bars.length === 0) throw new Error(`${symbol} history is empty`);
    const c = closes(history.bars);
    const year = history.bars.slice(Math.max(0, history.bars.length - 252));
    let quote: SymbolDetail["quote"];
    if (deps.broker.status().state === "connected") {
      try {
        quote = await deps.broker.quote(symbol);
      } catch (error) {
        deps.log.warn("quote unavailable", { symbol, error: error instanceof Error ? error.message : "unknown" });
      }
    }
    const account = deps.getAccount();
    const position = account?.positions.find((p) => p.symbol === symbol);
    let thesis: SymbolDetail["thesis"];
    try {
      thesis = await deps.notes.read(`theses/${symbol}.md`);
    } catch {
      thesis = undefined;
    }
    let nextEarnings: SymbolDetail["nextEarnings"];
    try {
      const date = await deps.market.nextEarnings(symbol);
      if (date !== undefined) nextEarnings = { date };
    } catch {
      // No earnings date found; the field stays absent.
    }
    const stop = await resolveStop(symbol, await readRhStops());
    return {
      symbol,
      ...(SYMBOL_NAMES[symbol] === undefined ? {} : { name: SYMBOL_NAMES[symbol] }),
      ...(quote === undefined ? {} : { quote }),
      ...(position === undefined ? {} : { position }),
      history,
      indicators: {
        ...(sma(c, 20) === undefined ? {} : { sma20: sma(c, 20) as number }),
        ...(sma(c, 50) === undefined ? {} : { sma50: sma(c, 50) as number }),
        ...(sma(c, 200) === undefined ? {} : { sma200: sma(c, 200) as number }),
        ...(rsi(c, 14) === undefined ? {} : { rsi14: rsi(c, 14) as number }),
        ...(atr(history.bars, 14) === undefined ? {} : { atr14: atr(history.bars, 14) as number }),
        ...(avgDollarVolume(history.bars, 20) === undefined ? {} : { avgDollarVolume: avgDollarVolume(history.bars, 20) as number }),
        ...(periodReturn(c, 21) === undefined ? {} : { return1m: (periodReturn(c, 21) as number) * 100 }),
        ...(periodReturn(c, 63) === undefined ? {} : { return3m: (periodReturn(c, 63) as number) * 100 }),
        high52w: Math.max(...year.map((b) => b.high)),
        low52w: Math.min(...year.map((b) => b.low)),
      },
      ...(thesis === undefined ? {} : { thesis }),
      orders: deps.store.ordersSince(0).filter((o) => o.intent.symbol === symbol),
      journal: deps.store.listJournal(500).filter((e) => e.symbol === symbol),
      ...(nextEarnings === undefined ? {} : { nextEarnings }),
      ...(stop === undefined ? {} : { stop }),
    };
  }

  return { equity, performance, marketOverview, symbolDetail };
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
