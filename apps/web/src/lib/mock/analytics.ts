import type {
  AnalyticsRange,
  Bar,
  CalibrationBucket,
  ClosedTrade,
  EquityHistory,
  ExposureRow,
  JournalEntry,
  MarketOverview,
  OrderRecord,
  PerformanceSummary,
  Position,
  SymbolDetail,
  TrendRow,
} from "@rh/shared";
import { sma } from "../chart.ts";
import { mockHistory, mockNote } from "./data.ts";

/** Dev-only analytics fixtures (VITE_MOCK_API=1). They follow the Analytics types in @rh/shared exactly. */

const DAY = 86_400_000;
const POSITIONS: { symbol: string; quantity: number }[] = [
  { symbol: "NVDA", quantity: 12 },
  { symbol: "XLE", quantity: 25 },
  { symbol: "JPM", quantity: 8.5 },
];
const EQUITY_NOW = 25_431.77;
const CASH_NOW = EQUITY_NOW - 1612.8 - 2290.5 - 2093.2;

const DAYS: Record<AnalyticsRange, number> = { "1m": 21, "3m": 63, "1y": 120, all: 120 };

function wobble(i: number, seed: number): number {
  return Math.sin(i * 0.9 + seed) * 0.5 + Math.sin(i * 0.31 + seed * 2) * 0.8;
}

export function mockEquity(range: AnalyticsRange, empty = false): EquityHistory {
  const n = DAYS[range];
  const spy = mockHistory("SPY", "1y").slice(-n);
  if (empty) return { points: spy.slice(-1).map((b) => ({ at: Date.parse(b.date), date: b.date, equity: EQUITY_NOW })), holdingsReplay: [] };

  // The harness only began marking equity about three months ago, so "1y" and "all" are the same series.
  const first = EQUITY_NOW / 1.019;
  const points = spy.map((b, i) => {
    const t = i / Math.max(1, n - 1);
    const equity = first * (1 + 0.019 * t + 0.0042 * wobble(i, 1.3) * (1 - t * 0.2));
    const benchmark = first * (1 + (b.close / spy[0]!.close - 1) * 0.2);
    return { at: Date.parse(`${b.date}T20:00:00Z`), date: b.date, equity, benchmark };
  });
  const lastPoint = points[points.length - 1]!;
  lastPoint.equity = EQUITY_NOW;
  const firstPoint = points[0]!;
  firstPoint.equity = first;

  const closes = POSITIONS.map((p) => ({ ...p, bars: mockHistory(p.symbol, "1y").slice(-n) }));
  const holdingsReplay = spy.map((b, i) => ({
    date: b.date,
    value: CASH_NOW + closes.reduce((a, p) => a + p.quantity * (p.bars[i]?.close ?? 0), 0),
  }));

  const returnPct = ((lastPoint.equity - firstPoint.equity) / firstPoint.equity) * 100;
  const benchmarkReturnPct = ((lastPoint.benchmark - firstPoint.benchmark) / firstPoint.benchmark) * 100;
  let peak = 0;
  let dd = 0;
  for (const p of points) {
    peak = Math.max(peak, p.equity);
    dd = Math.min(dd, ((p.equity - peak) / peak) * 100);
  }
  return { points, holdingsReplay, returnPct, benchmarkReturnPct, maxDrawdownPct: dd };
}

function trades(): ClosedTrade[] {
  const now = Date.now();
  const rows: [string, number, number, number, number | undefined, number | undefined, "harness" | "robinhood", number | undefined][] = [
    // symbol, daysAgo, pnl, holdingDays, R, probability, source, entryPrice
    ["AAPL", 118, 84.2, 9, undefined, undefined, "robinhood", 211.4],
    ["TSLA", 112, -142.5, 4, undefined, undefined, "robinhood", 268.0],
    ["AMD", 104, 61.3, 6, undefined, undefined, "robinhood", 151.2],
    ["SPY", 96, 38.9, 12, undefined, undefined, "robinhood", 559.1],
    ["MSFT", 83, 112.4, 11, 1.9, 0.58, "harness", 401.5],
    ["XLF", 79, -38.1, 5, -0.8, 0.52, "harness", 49.4],
    ["QQQ", 72, 74.8, 8, 1.4, 0.61, "harness", 489.2],
    ["NVDA", 66, -95.0, 3, -1.0, 0.64, "harness", 126.3],
    ["JPM", 61, 52.6, 14, 1.1, 0.55, "harness", 236.8],
    ["XLE", 55, 29.4, 7, 0.6, 0.5, "harness", 90.2],
    ["AMZN", 49, -61.2, 5, -0.9, 0.66, "harness", 189.5],
    ["META", 44, 148.0, 13, 2.2, 0.57, "harness", 560.0],
    ["GOOGL", 38, 41.0, 9, 0.9, 0.6, "harness", 171.3],
    ["IWM", 33, -27.5, 4, -0.7, 0.54, "harness", 218.4],
    ["SMH", 27, 96.7, 10, 1.6, 0.63, "harness", 247.9],
    ["AAPL", 21, 22.8, 6, 0.4, 0.51, "harness", 226.0],
    ["XLK", 15, -48.3, 3, -0.9, 0.68, "harness", 233.1],
    ["MSFT", 9, 58.6, 8, 1.2, 0.59, "harness", 408.0],
  ];
  return rows.map(([symbol, daysAgo, pnl, holdingDays, rMultiple, probabilityWin, source, entryPrice]) => {
    const quantity = Math.max(1, Math.round(600 / (entryPrice ?? 100)));
    return {
      symbol,
      openedAt: now - (daysAgo + holdingDays) * DAY,
      closedAt: now - daysAgo * DAY,
      quantity,
      entryPrice,
      exitPrice: (entryPrice ?? 100) + pnl / quantity,
      pnl,
      pnlPct: entryPrice ? (pnl / (entryPrice * quantity)) * 100 : undefined,
      rMultiple,
      holdingDays,
      probabilityWin,
      source,
    };
  });
}

export function mockPerformance(empty = false): PerformanceSummary {
  if (empty) {
    return { trades: [], realizedPnl: 0, calibration: [], exposure: [], sectors: [], ordersByStatus: {} };
  }
  const t = trades();
  const harness = t.filter((x) => x.source === "harness");
  const wins = t.filter((x) => x.pnl > 0);
  const grossWin = wins.reduce((a, x) => a + x.pnl, 0);
  const grossLoss = -t.filter((x) => x.pnl < 0).reduce((a, x) => a + x.pnl, 0);
  const rs = harness.flatMap((x) => (x.rMultiple === undefined ? [] : [x.rMultiple]));
  const avgR = rs.reduce((a, b) => a + b, 0) / rs.length;
  const calibration: CalibrationBucket[] = [
    { from: 0.5, to: 0.6, predicted: 0.54, realized: 0.57, count: 7 },
    { from: 0.6, to: 0.7, predicted: 0.63, realized: 0.4, count: 5 },
    { from: 0.7, to: 0.8, predicted: 0.75, realized: 0, count: 0 },
  ];
  const stops: Record<string, number> = { NVDA: 118.6, XLE: 88.4, JPM: 236.0 };
  const sectors: Record<string, string> = { NVDA: "Technology", XLE: "Energy", JPM: "Financials" };
  const values: Record<string, [number, number]> = { NVDA: [1612.8, 191.99], XLE: [2290.5, -12], JPM: [2093.2, 42.15] };
  const exposure: ExposureRow[] = POSITIONS.map((p) => {
    const [marketValue, unrealizedPnl] = values[p.symbol]!;
    const price = marketValue / p.quantity;
    const stopPrice = stops[p.symbol]!;
    return {
      symbol: p.symbol,
      sector: sectors[p.symbol],
      marketValue,
      weightPct: (marketValue / EQUITY_NOW) * 100,
      unrealizedPnl,
      stopPrice,
      riskToStopPct: ((price - stopPrice) * p.quantity) / EQUITY_NOW * 100,
    };
  });
  return {
    trades: t,
    realizedPnl: t.reduce((a, x) => a + x.pnl, 0),
    winRatePct: (wins.length / t.length) * 100,
    avgR,
    expectancy: harness.reduce((a, x) => a + x.pnl, 0) / harness.length,
    profitFactor: grossWin / grossLoss,
    avgHoldingDays: t.reduce((a, x) => a + (x.holdingDays ?? 0), 0) / t.length,
    brier: 0.231,
    calibration,
    exposure,
    sectors: [
      { sector: "Energy", weightPct: (2290.5 / EQUITY_NOW) * 100 },
      { sector: "Financials", weightPct: (2093.2 / EQUITY_NOW) * 100 },
      { sector: "Technology", weightPct: (1612.8 / EQUITY_NOW) * 100 },
    ],
    heatPct: exposure.reduce((a, e) => a + (e.riskToStopPct ?? 0), 0),
    ordersByStatus: { filled: 21, rejected_risk: 9, rejected_user: 3, expired: 2, cancelled: 4, failed: 1, pending_approval: 2, submitted: 1 },
  };
}

const rsi14 = (bars: Bar[]): number => {
  const d = bars.slice(-15).map((b, i, a) => (i ? b.close - a[i - 1]!.close : 0)).slice(1);
  const up = d.filter((x) => x > 0).reduce((a, b) => a + b, 0) / 14;
  const dn = -d.filter((x) => x < 0).reduce((a, b) => a + b, 0) / 14;
  return dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
};

function trendRow(symbol: string, name: string, spyReturn3m: number): TrendRow {
  const bars = mockHistory(symbol, "1y");
  const last = bars[bars.length - 1]!.close;
  const at = (back: number) => bars[Math.max(0, bars.length - 1 - back)]!.close;
  const s50 = sma(bars, 50).at(-1)!.value;
  const s200 = sma(bars, 200).at(-1)!.value;
  const r3 = ((last - at(63)) / at(63)) * 100;
  return {
    symbol,
    name,
    last,
    changePct1d: ((last - at(1)) / at(1)) * 100,
    return1m: ((last - at(21)) / at(21)) * 100,
    return3m: r3,
    aboveSma50: last > s50,
    aboveSma200: last > s200,
    rsi14: rsi14(bars),
    relStrength3m: r3 - spyReturn3m,
    spark: bars.slice(-60).map((b) => b.close),
  };
}

function isoPlus(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
}

export function mockMarket(): MarketOverview {
  const spyBars = mockHistory("SPY", "1y");
  const spy3 = ((spyBars.at(-1)!.close - spyBars.at(-64)!.close) / spyBars.at(-64)!.close) * 100;
  const indices = [
    ["SPY", "S&P 500"],
    ["QQQ", "Nasdaq 100"],
    ["IWM", "Russell 2000"],
    ["DIA", "Dow Jones"],
  ].map(([s, n]) => trendRow(s!, n!, spy3));
  const sectors = [
    ["XLK", "Technology"],
    ["XLF", "Financials"],
    ["XLE", "Energy"],
    ["XLV", "Health care"],
    ["XLY", "Consumer discretionary"],
    ["XLP", "Consumer staples"],
    ["XLI", "Industrials"],
    ["XLU", "Utilities"],
    ["XLB", "Materials"],
    ["XLC", "Communication"],
  ]
    .map(([s, n]) => trendRow(s!, n!, spy3))
    .sort((a, b) => (b.relStrength3m ?? 0) - (a.relStrength3m ?? 0));

  const vixBars = mockHistory("VIXY", "1y").slice(-120);
  const vixScale = 14.8 / vixBars.at(-1)!.close;
  const history = vixBars.map((b) => ({ date: b.date, value: b.close * vixScale * 1.05 }));
  history[history.length - 1] = { ...history.at(-1)!, value: 14.8 };

  const tenBars = mockHistory("TLT", "1y").slice(-120);
  const tenScale = 4.18 / tenBars.at(-1)!.close;
  const tenYearHistory = tenBars.map((b) => ({ date: b.date, value: 8.2 - b.close * tenScale * 3.95 + 0.4 }));
  tenYearHistory[tenYearHistory.length - 1] = { ...tenYearHistory.at(-1)!, value: 4.18 };

  return {
    asOf: Date.now() - 4 * 60_000,
    regime: "Uptrend, falling volatility",
    indices,
    sectors,
    volatility: {
      vix: 14.8,
      vix9d: 13.1,
      vix3m: 17.2,
      percentile: 24,
      contango: true,
      history,
    },
    yields: [
      { tenor: "1M", yieldPct: 4.38 },
      { tenor: "3M", yieldPct: 4.31 },
      { tenor: "6M", yieldPct: 4.18 },
      { tenor: "1Y", yieldPct: 3.99 },
      { tenor: "2Y", yieldPct: 3.86 },
      { tenor: "5Y", yieldPct: 3.94 },
      { tenor: "10Y", yieldPct: 4.18 },
      { tenor: "30Y", yieldPct: 4.62 },
    ],
    tenYearHistory,
    breadth: { aboveSma50: 318, total: 503 },
    calendar: [
      { date: isoPlus(1), time: "08:30", event: "Core PCE price index", importance: "high" },
      { date: isoPlus(2), time: "10:00", event: "ISM manufacturing PMI", importance: "medium" },
      { date: isoPlus(3), time: "14:00", event: "FOMC minutes", importance: "high" },
      { date: isoPlus(4), time: "08:30", event: "Initial jobless claims", importance: "low" },
      { date: isoPlus(5), time: "08:30", event: "Nonfarm payrolls", importance: "high" },
      { date: isoPlus(5), time: "10:00", event: "Consumer sentiment", importance: "low" },
    ],
    earnings: [
      { symbol: "JPM", date: isoPlus(2), time: "Before open", held: true },
      { symbol: "AAPL", date: isoPlus(3), time: "After close", held: false },
      { symbol: "AMZN", date: isoPlus(3), time: "After close", held: false },
      { symbol: "XOM", date: isoPlus(5), time: "Before open", held: false },
      { symbol: "NVDA", date: isoPlus(24), time: "After close", held: true },
      { symbol: "MSFT", date: isoPlus(9), time: "After close", held: false },
    ],
  };
}

export function mockSymbolDetail(
  symbol: string,
  ctx: { positions: Position[]; orders: OrderRecord[]; journal: JournalEntry[] },
): SymbolDetail {
  const bars = mockHistory(symbol, "1y");
  const last = bars.at(-1)!;
  const closes = bars.map((b) => b.close);
  const avg = (n: number) => sma(bars, n).at(-1)?.value;
  const at = (back: number) => bars[Math.max(0, bars.length - 1 - back)]!.close;
  const position = ctx.positions.find((p) => p.symbol === symbol);
  const held: Record<string, number> = { NVDA: 118.6, XLE: 88.4, JPM: 236.0 };
  const earnings: Record<string, number> = { NVDA: 24, JPM: 2, MSFT: 9, AAPL: 3 };
  const thesis = mockNote(`theses/${symbol}.md`);
  return {
    symbol,
    name: { NVDA: "NVIDIA", XLE: "Energy Select Sector SPDR", JPM: "JPMorgan Chase", MSFT: "Microsoft", SPY: "SPDR S&P 500 ETF" }[symbol],
    quote: { symbol, bid: last.close - 0.02, ask: last.close + 0.02, last: last.close, at: Date.now() - 20_000 },
    position,
    history: { symbol, bars, source: "mock", asOf: Date.now() },
    indicators: {
      sma20: avg(20),
      sma50: avg(50),
      sma200: avg(200),
      rsi14: rsi14(bars),
      atr14: bars.slice(-14).reduce((a, b) => a + (b.high - b.low), 0) / 14,
      avgDollarVolume: bars.slice(-20).reduce((a, b) => a + b.volume * b.close, 0) / 20,
      return1m: ((last.close - at(21)) / at(21)) * 100,
      return3m: ((last.close - at(63)) / at(63)) * 100,
      high52w: Math.max(...closes),
      low52w: Math.min(...closes),
    },
    thesis,
    orders: ctx.orders.filter((o) => o.intent.symbol === symbol),
    journal: ctx.journal.filter((j) => j.symbol === symbol).slice(0, 8),
    nextEarnings: earnings[symbol] !== undefined ? { date: isoPlus(earnings[symbol]!), time: "After close" } : undefined,
    stop: held[symbol] !== undefined ? { price: held[symbol]!, source: symbol === "XLE" ? "robinhood" : "thesis" } : undefined,
  };
}
