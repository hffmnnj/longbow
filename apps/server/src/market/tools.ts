import { Type, type Static } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import type { HistoryRange } from "@rh/shared";
import { isCryptoSymbol } from "@rh/shared";
import type { Clock, Logger, MarketData } from "../ports.ts";
import { etDate, MarketCache } from "./cache.ts";
import {
  avgDollarVolume,
  atr,
  betaAndCorrelation,
  bollinger,
  classifyTrend,
  closes,
  correlation,
  dailyReturns,
  alignReturns,
  donchian,
  ema,
  macd,
  maxDrawdown,
  periodReturn,
  realizedVol,
  rsi,
  sma,
} from "./indicators.ts";
import { createPointInTimeMarketData, MarketStore } from "./market-data.ts";
import type { ExtendedHistory } from "./market-data.ts";
import {
  fetchEarningsCalendar,
  fetchEarningsDate,
  fetchEconomicEvents,
  findUpcomingEarnings,
} from "./sources/nasdaq.ts";
import { fetchVixSeries, type VixKind } from "./sources/cboe.ts";
import { fetchYieldCurve } from "./sources/treasury.ts";
import { fetchCompanyFacts, fetchCompanyInfo, fetchTickerMap } from "./sources/sec.ts";

/**
 * The `market` extension: free public market data (Nasdaq, CBOE, Treasury,
 * SEC EDGAR) as pi-durable tools for Code Mode scripts. Every tool declares
 * a `structuredOutputSchema` and keeps its text output to a short summary;
 * full series live in `structuredOutput` for scripts to compute over.
 */

export interface MarketExtensionDeps {
  market: MarketData;
  dataDir: string;
  log: Logger;
  clock: Clock;
  /** ET date YYYY-MM-DD the simulation has reached; absent for the live harness. */
  asOf?: () => string | undefined;
  /** Overridable fetch for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Blind and bootstrap simulations: register only price history, indicators
   * and compare, all reading the injected point-in-time market. Earnings,
   * calendars, VIX, yields and SEC tools stay unregistered so the agent can
   * never reach a real-world source through them.
   */
  pricesOnly?: boolean;
}

const SYMBOL_PATTERN = "^[A-Z.]{1,10}$";

/** Tickers plus crypto pairs like BTC-USD; only the price tools accept pairs. */
const CRYPTO_OR_TICKER_PATTERN = "^([A-Z.]{1,10}|[A-Z]{2,10}-USD)$";

const symbolField = (description: string) =>
  Type.String({ description, pattern: SYMBOL_PATTERN, minLength: 1, maxLength: 10 });

const cryptoSymbolField = (description: string) =>
  Type.String({ description, pattern: CRYPTO_OR_TICKER_PATTERN, minLength: 1, maxLength: 14 });

const HISTORY_RANGES = ["1m", "3m", "6m", "1y", "2y", "5y"] as const satisfies readonly HistoryRange[];

const rangeUnion = (description: string) =>
  Type.Union(
    [
      Type.Literal(HISTORY_RANGES[0]),
      Type.Literal(HISTORY_RANGES[1]),
      Type.Literal(HISTORY_RANGES[2]),
      Type.Literal(HISTORY_RANGES[3]),
      Type.Literal(HISTORY_RANGES[4]),
      Type.Literal(HISTORY_RANGES[5]),
    ],
    { description },
  );

const rangeField = (description: string) => Type.Optional(rangeUnion(description));

const numOrNull = (description: string) =>
  Type.Union([Type.Number(), Type.Null()], { description });

type RangeArg = HistoryRange | undefined;

function rangeOr(value: RangeArg, fallback: HistoryRange): HistoryRange {
  return value ?? fallback;
}

function err(text: string) {
  return { output: [{ type: "text" as const, text }], isError: true };
}

function fmtPct(value: number | undefined | null, digits = 2): string {
  if (value === undefined || value === null) return "n/a";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

function fmtNum(value: number | undefined | null, digits = 2): string {
  if (value === undefined || value === null) return "n/a";
  return value.toFixed(digits);
}

function nullIfUndef(value: number | undefined): number | null {
  return value === undefined ? null : value;
}

function calendarDays(fromDate: string, toDate: string): number {
  return Math.round(
    (new Date(`${toDate}T12:00:00Z`).getTime() - new Date(`${fromDate}T12:00:00Z`).getTime()) / 86_400_000,
  );
}

const barSchema = Type.Object({
  date: Type.String({ description: "ET trading date YYYY-MM-DD." }),
  open: Type.Number(),
  high: Type.Number(),
  low: Type.Number(),
  close: Type.Number(),
  volume: Type.Number({ description: "Share volume." }),
});

const priceHistorySchema = Type.Object({
  symbol: Type.String(),
  bars: Type.Array(barSchema, { description: "Daily bars, oldest first." }),
  source: Type.String(),
  asOf: Type.Number({ description: "Epoch ms when the history was served." }),
});

const macdSchema = Type.Union([
  Type.Object({
    macd: Type.Number(),
    signal: Type.Number(),
    histogram: Type.Number(),
  }),
  Type.Null(),
]);

const indicatorsSchema = Type.Object({
  symbol: Type.String(),
  date: Type.Union([Type.String(), Type.Null()]),
  close: numOrNull("Last close."),
  sma20: numOrNull("20-session simple moving average."),
  sma50: numOrNull("50-session simple moving average."),
  sma200: numOrNull("200-session simple moving average."),
  ema20: numOrNull("20-session exponential moving average."),
  rsi14: numOrNull("14-period Wilder RSI."),
  atr14: numOrNull("14-period Wilder ATR in USD."),
  atrPct: numOrNull("ATR as a fraction of the last close."),
  macd: macdSchema,
  bollinger: Type.Union([
    Type.Object({
      upper: Type.Number(),
      middle: Type.Number(),
      lower: Type.Number(),
      percentB: Type.Number({ description: "Last close position within the bands, 0 to 1." }),
    }),
    Type.Null(),
  ]),
  donchian20: Type.Union([Type.Object({ high: Type.Number(), low: Type.Number() }), Type.Null()]),
  high52w: numOrNull("Highest high of the last 252 sessions, when covered."),
  low52w: numOrNull("Lowest low of the last 252 sessions, when covered."),
  ret1m: numOrNull("21-session return as a fraction."),
  ret3m: numOrNull("63-session return as a fraction."),
  ret6m: numOrNull("126-session return as a fraction."),
  ret1y: numOrNull("252-session return as a fraction."),
  realizedVol20: numOrNull("Annualized realized volatility over 20 sessions."),
  maxDrawdown1y: numOrNull("Worst peak-to-trough drawdown over the last 252 sessions, negative fraction."),
  avgDollarVolume20: numOrNull("Average daily dollar volume over 20 sessions, USD."),
  trend: Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("sideways")], {
    description: "Up when close > sma50 > sma200, down for the mirror, else sideways.",
  }),
});

const compareSchema = Type.Object({
  benchmark: Type.String(),
  rows: Type.Array(
    Type.Object({
      symbol: Type.String(),
      returnPct: numOrNull("Window return as a fraction."),
      volPct: numOrNull("Annualized volatility as a fraction."),
      beta: numOrNull("Beta of daily returns against the benchmark."),
      correlation: numOrNull("Correlation of daily returns against the benchmark."),
      relativeStrengthPct: numOrNull("Return minus the benchmark return, as a fraction."),
    }),
  ),
  correlation: Type.Object({
    symbols: Type.Array(Type.String()),
    matrix: Type.Array(
      Type.Array(Type.Union([Type.Number(), Type.Null()]), {
        description: "Pairwise correlation of daily returns; row i vs column j.",
      }),
    ),
  }),
});

const earningsSchema = Type.Object({
  symbol: Type.String(),
  nextDate: Type.Union([Type.String(), Type.Null()], {
    description: "Next scheduled earnings date (ET, YYYY-MM-DD) within 30 days, or null.",
  }),
  daysUntil: Type.Union([Type.Number(), Type.Null()]),
  time: Type.Optional(Type.String({ description: "Report session, e.g. after hours." })),
  epsForecast: Type.Optional(Type.String({ description: "Consensus EPS forecast, e.g. $2.00." })),
});

const earningsCalendarSchema = Type.Object({
  date: Type.String(),
  rows: Type.Array(
    Type.Object({
      symbol: Type.String(),
      name: Type.String(),
      time: Type.String({ description: "Report session; empty when not published." }),
      epsForecast: Type.Optional(Type.String()),
      actualEps: Type.Optional(
        Type.String({ description: "Reported EPS; only present for dates before the simulation as-of date." }),
      ),
      marketCap: Type.Optional(Type.String()),
    }),
    { description: "Largest 50 by market cap." },
  ),
});

const economicCalendarSchema = Type.Object({
  date: Type.String(),
  events: Type.Array(
    Type.Object({
      time: Type.String({ description: "GMT time HH:MM as published." }),
      country: Type.String(),
      event: Type.String(),
      actual: Type.Optional(Type.String()),
      consensus: Type.Optional(Type.String()),
      previous: Type.Optional(Type.String()),
    }),
    { description: "US events only." },
  ),
});

const vixPointSchema = Type.Object({
  date: Type.String(),
  close: Type.Number(),
});

const volatilitySchema = Type.Object({
  vix: Type.Object({
    date: Type.Union([Type.String(), Type.Null()]),
    close: numOrNull("Latest VIX close."),
    percentile1y: numOrNull("Percentile rank of the close within the requested window, 0-100."),
    sma20: numOrNull("20-session SMA of VIX closes."),
  }),
  vix3m: Type.Optional(vixPointSchema),
  vix9d: Type.Optional(vixPointSchema),
  termStructure: Type.Optional(Type.Union([Type.Literal("contango"), Type.Literal("backwardation")], {
    description: "Contango when VIX3M is above VIX, backwardation otherwise.",
  })),
});

const yieldsSchema = Type.Object({
  date: Type.Union([Type.String(), Type.Null()]),
  curve: Type.Record(Type.String(), Type.Number(), { description: "Par yields in percent by tenor." }),
  spread2s10s: numOrNull("10Y minus 2Y, percentage points."),
  spread3m10y: numOrNull("10Y minus 3M, percentage points."),
  change10y20d: numOrNull("10Y change over the last 20 sessions, percentage points."),
});

const secCompanySchema = Type.Object({
  cik: Type.String(),
  name: Type.String(),
  sic: Type.String(),
  sicDescription: Type.String(),
  recentFilings: Type.Array(
    Type.Object({
      form: Type.String(),
      filedAt: Type.String({ description: "Filing date YYYY-MM-DD." }),
      url: Type.String({ description: "Filing index on sec.gov." }),
      description: Type.String(),
    }),
    { description: "Last 15 filings, newest first." },
  ),
  facts: Type.Record(
    Type.String(),
    Type.Array(
      Type.Object({
        period: Type.String(),
        end: Type.String(),
        value: Type.Number(),
        form: Type.String(),
        filed: Type.Optional(Type.String({ description: "SEC filing date YYYY-MM-DD when this value was published." })),
      }),
    ),
    { description: "Last 8 reported periods per fact group, oldest first." },
  ),
});

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

const VOL_WINDOW: Record<HistoryRange, number> = {
  "1m": 21,
  "3m": 63,
  "6m": 126,
  "1y": 252,
  "2y": 504,
  "5y": Number.MAX_SAFE_INTEGER,
};

/** Calendar-day count-back per range for crypto series, which trade every day. */
const CRYPTO_VOL_WINDOW: Record<HistoryRange, number> = {
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
  "2y": 730,
  "5y": Number.MAX_SAFE_INTEGER,
};

export function createMarketExtension(deps: MarketExtensionDeps): Extension {
  const { market, clock, log, asOf } = deps;
  const store = new MarketStore({ dataDir: deps.dataDir, log, clock, asOf, fetchImpl: deps.fetchImpl });
  const cache = store.cache;
  // Point-in-time view over the injected market for simulated dates (also
  // safe when the injected market is already point-in-time: truncation and
  // count-back are idempotent). The live port is used unchanged when asOf is
  // absent. The cutoff is read per call because the simulated date advances.
  const pit = createPointInTimeMarketData(market, () => asOf?.() ?? etDate(clock.now()));

  /**
   * Indicator input for pricesOnly markets: the full transformed series from
   * the injected market (warmup included), with the range window counted back
   * from the simulated date. Never touches the Nasdaq-backed store.
   */
  async function scenarioExtended(symbol: string, range: HistoryRange): Promise<ExtendedHistory> {
    const full = (await pit.history(symbol, "5y")).bars;
    const want = isCryptoSymbol(symbol) ? CRYPTO_VOL_WINDOW[range] : VOL_WINDOW[range];
    const window = full.length > want ? full.slice(full.length - want) : full;
    return { window, full };
  }

  /** "As of <date>: " prefix for every text output when simulating, else "". */
  function tag(): string {
    const cutoff = asOf?.();
    return cutoff === undefined ? "" : `As of ${cutoff}: `;
  }

  /** Error result, prefixed with the simulation date when set. */
  function fail(text: string): ReturnType<typeof err> {
    return err(`${tag()}${text}`);
  }

  const priceHistory = defineTool({
    name: "market_price_history",
    description:
      "Daily price history for a US stock or ETF from Nasdaq (free, 1m/3m/6m/1y/2y/5y, oldest first). " +
      "Crypto pairs like BTC-USD use daily Coinbase candles in UTC days (including the current partial day as the last bar) and trade 24/7, so equity session counts like 252 do not apply. " +
      "Use the structured output for math; the text is only a summary.",
    parameters: Type.Object({
      symbol: cryptoSymbolField("Uppercase ticker or crypto pair, e.g. AAPL, SPY or BTC-USD."),
      range: rangeUnion("History window."),
    }),
    structuredOutputSchema: priceHistorySchema,
    replay: "safe",
    outputLimits: { maxBytes: 4_000, maxLines: 20 },
    async execute(args) {
      try {
        const history = await (asOf?.() === undefined ? market : pit).history(args.symbol, args.range);
        const bars = history.bars;
        if (bars.length === 0) return fail(`No price history found for ${args.symbol} (${args.range}).`);
        const first = bars[0];
        const last = bars[bars.length - 1];
        if (!first || !last) return fail(`No price history found for ${args.symbol} (${args.range}).`);
        const ret = last.close / first.close - 1;
        let high = -Infinity;
        let low = Infinity;
        for (const b of bars) {
          if (b.high > high) high = b.high;
          if (b.low < low) low = b.low;
        }
        const text =
          `${tag()}${history.symbol} ${args.range}: ${bars.length} bars ${first.date}..${last.date}, ` +
          `last close ${last.close.toFixed(2)}, period return ${fmtPct(ret)}, ` +
          `window high ${high.toFixed(2)} low ${low.toFixed(2)}.`;
        return { output: [{ type: "text" as const, text }], structuredOutput: {
          symbol: history.symbol,
          bars: history.bars.map((b) => ({ ...b })),
          source: history.source,
          asOf: history.asOf,
        } };
      } catch (error) {
        return fail(`Price history failed for ${args.symbol}: ${shortError(error)}`);
      }
    },
  });

  const indicators = defineTool({
    name: "market_indicators",
    description:
      "Deterministic technical indicators for one ticker over daily bars: moving averages, RSI, ATR, MACD, " +
      "Bollinger, Donchian, period returns, realized volatility, drawdown, dollar volume, and trend. " +
      "Crypto pairs like BTC-USD use daily Coinbase candles in UTC days (including the current partial day as the last bar) and trade 24/7: their ret1m/ret3m/ret6m/ret1y span 30/90/180/365 bars, 52-week extremes use the last 365 bars, and volatility annualizes with sqrt(365), so 252 does not apply. " +
      "Absent values are null when history is too short. Use the structured output for math.",
    parameters: Type.Object({
      symbol: cryptoSymbolField("Uppercase ticker or crypto pair, e.g. NVDA or BTC-USD."),
      range: rangeField("History window for the computation; defaults to 1y."),
    }),
    structuredOutputSchema: indicatorsSchema,
    replay: "safe",
    outputLimits: { maxBytes: 4_000, maxLines: 30 },
    async execute(args) {
      try {
        const range = rangeOr(args.range as RangeArg, "1y");
        const { window, full } = deps.pricesOnly === true
          ? await scenarioExtended(args.symbol, range)
          : await store.extended(args.symbol, range);
        const last = window[window.length - 1] ?? full[full.length - 1];
        if (!last) return fail(`No price history found for ${args.symbol} (${range}).`);
        const crypto = isCryptoSymbol(args.symbol);
        // Crypto trades every day, so return windows count calendar days
        // (30/90/180/365) instead of equity sessions (21/63/126/252).
        const retWindows = crypto ? [30, 90, 180, 365] : [21, 63, 126, 252];
        const yearBars = crypto ? 365 : 252;
        const c = closes(full);
        const sma20 = sma(c, 20);
        const sma50 = sma(c, 50);
        const sma200 = sma(c, 200);
        const ema20v = ema(c, 20);
        const rsi14 = rsi(c, 14);
        const atr14 = atr(full, 14);
        const macdV = macd(c);
        const bb = bollinger(c, 20, 2);
        const dc = donchian(full, 20);
        const year = full.slice(Math.max(0, full.length - yearBars));
        const yc = closes(year);
        const highs = year.map((b) => b.high);
        const lows = year.map((b) => b.low);
        const structured = {
          symbol: args.symbol,
          date: last.date,
          close: last.close,
          sma20: nullIfUndef(sma20),
          sma50: nullIfUndef(sma50),
          sma200: nullIfUndef(sma200),
          ema20: nullIfUndef(ema20v),
          rsi14: nullIfUndef(rsi14),
          atr14: nullIfUndef(atr14),
          atrPct: atr14 === undefined ? null : atr14 / last.close,
          macd: macdV === undefined ? null : { ...macdV },
          bollinger: bb === undefined ? null : { ...bb },
          donchian20: dc === undefined ? null : { ...dc },
          high52w: highs.length === 0 ? null : Math.max(...highs),
          low52w: lows.length === 0 ? null : Math.min(...lows),
          ret1m: nullIfUndef(periodReturn(c, retWindows[0] ?? 21)),
          ret3m: nullIfUndef(periodReturn(c, retWindows[1] ?? 63)),
          ret6m: nullIfUndef(periodReturn(c, retWindows[2] ?? 126)),
          ret1y: nullIfUndef(periodReturn(c, retWindows[3] ?? 252)),
          realizedVol20: nullIfUndef(realizedVol(c, 20, crypto ? 365 : 252)),
          maxDrawdown1y: nullIfUndef(maxDrawdown(yc)),
          avgDollarVolume20: nullIfUndef(avgDollarVolume(full, 20)),
          trend: classifyTrend(last.close, sma50, sma200),
        };
        const text =
          `${tag()}${args.symbol} ${last.date}: close ${last.close.toFixed(2)}, trend ${structured.trend}, ` +
          `RSI14 ${fmtNum(rsi14, 1)}, SMA50 ${fmtNum(sma50)} SMA200 ${fmtNum(sma200)}, ` +
          `ret1m ${fmtPct(structured.ret1m)} ret1y ${fmtPct(structured.ret1y)}, ` +
          `realizedVol20 ${fmtPct(structured.realizedVol20)} maxDD1y ${fmtPct(structured.maxDrawdown1y)}.`;
        return { output: [{ type: "text" as const, text }], structuredOutput: structured };
      } catch (error) {
        return fail(`Indicators failed for ${args.symbol}: ${shortError(error)}`);
      }
    },
  });

  const compare = defineTool({
    name: "market_compare",
    description:
      "Compare up to 12 tickers over one window against a benchmark (default SPY): window return, " +
      "annualized volatility, beta, correlation, return minus benchmark, and the pairwise correlation matrix. " +
      "Crypto pairs like BTC-USD use daily Coinbase candles in UTC days and trade 24/7; mixed calendars are aligned by date so only common days count. " +
      "Use the structured output for math; the text is only a summary.",
    parameters: Type.Object({
      symbols: Type.Array(cryptoSymbolField("Uppercase ticker or crypto pair."), {
        description: "Up to 12 tickers to compare.",
        minItems: 1,
        maxItems: 12,
      }),
      range: rangeField("History window; defaults to 6m."),
      benchmark: Type.Optional(
        Type.String({
          description: "Benchmark ticker or crypto pair; defaults to SPY.",
          pattern: CRYPTO_OR_TICKER_PATTERN,
          minLength: 1,
          maxLength: 14,
        }),
      ),
    }),
    structuredOutputSchema: compareSchema,
    replay: "safe",
    outputLimits: { maxBytes: 6_000, maxLines: 40 },
    async execute(args) {
      try {
        const range = rangeOr(args.range as RangeArg, "6m");
        const benchmark = args.benchmark ?? "SPY";
        const effective = asOf?.() === undefined ? market : pit;
        const symbols = [...new Set(args.symbols)].filter((s) => s !== benchmark);
        const bench = await effective.history(benchmark, range);
        if (bench.bars.length < 2) return fail(`No benchmark history for ${benchmark} (${range}).`);
        const benchCl = closes(bench.bars);
        const benchRet = periodReturn(benchCl, benchCl.length - 1) ?? 0;
        const rows: Static<typeof compareSchema>["rows"] = [];
        const series = new Map<string, { date: string; r: number }[]>();
        series.set(benchmark, dailyReturns(bench.bars));
        for (const symbol of symbols) {
          const hist = await effective.history(symbol, range);
          if (hist.bars.length < 2) {
            rows.push({ symbol, returnPct: null, volPct: null, beta: null, correlation: null, relativeStrengthPct: null });
            continue;
          }
          const cl = closes(hist.bars);
          const ret = periodReturn(cl, cl.length - 1);
          const vol = realizedVol(cl, cl.length - 1, isCryptoSymbol(symbol) ? 365 : 252);
          const { beta, correlation: corr } = betaAndCorrelation(hist.bars, bench.bars);
          rows.push({
            symbol,
            returnPct: nullIfUndef(ret),
            volPct: nullIfUndef(vol),
            beta: nullIfUndef(beta),
            correlation: nullIfUndef(corr),
            relativeStrengthPct: ret === undefined ? null : ret - benchRet,
          });
          series.set(symbol, dailyReturns(hist.bars));
        }
        const names = [benchmark, ...symbols];
        const matrix = names.map((a) =>
          names.map((b) => {
            if (a === b) return 1;
            const sa = series.get(a);
            const sb = series.get(b);
            if (!sa || !sb) return null;
            return correlation(...pairArrays(sa, sb)) ?? null;
          }),
        );
        const structured = { benchmark, rows, correlation: { symbols: names, matrix } };
        const lines = rows.map(
          (r) => `${r.symbol}: ret ${fmtPct(r.returnPct)} vs bench ${fmtPct(r.relativeStrengthPct)} beta ${fmtNum(r.beta)} corr ${fmtNum(r.correlation)}`,
        );
        const text =
          `${tag()}Compare ${range} vs ${benchmark} (bench ret ${fmtPct(benchRet)}):\n` +
          (lines.length === 0 ? "(no symbols)" : lines.join("\n"));
        return { output: [{ type: "text" as const, text }], structuredOutput: structured };
      } catch (error) {
        return fail(`Compare failed: ${shortError(error)}`);
      }
    },
  });

  const earnings = defineTool({
    name: "market_earnings",
    description:
      "Next scheduled earnings date for one ticker within the next 30 days (Nasdaq), " +
      "with the report session and consensus EPS forecast when published.",
    parameters: Type.Object({ symbol: symbolField("Uppercase ticker, e.g. AAPL.") }),
    structuredOutputSchema: earningsSchema,
    replay: "safe",
    outputLimits: { maxBytes: 2_000, maxLines: 10 },
    async execute(args) {
      try {
        const anchor = asOf?.() ?? etDate(clock.now());
        let found: { date: string; time?: string; epsForecast?: string } | undefined;
        try {
          const single = await fetchEarningsDate(cache, args.symbol);
          if (single !== undefined && single.date > anchor && calendarDays(anchor, single.date) <= 30) found = single;
        } catch {
          // Fall through to the calendar scan.
        }
        found ??= await findUpcomingEarnings(cache, args.symbol, anchor).catch(() => undefined);
        if (found === undefined) {
          const structured = { symbol: args.symbol, nextDate: null, daysUntil: null };
          return {
            output: [{ type: "text" as const, text: `${tag()}${args.symbol}: no earnings date found in the next 30 days.` }],
            structuredOutput: structured,
          };
        }
        const structured = {
          symbol: args.symbol,
          nextDate: found.date,
          daysUntil: calendarDays(anchor, found.date),
          ...(found.time === undefined ? {} : { time: found.time }),
          ...(found.epsForecast === undefined ? {} : { epsForecast: found.epsForecast }),
        };
        const extra = [found.time, found.epsForecast ? `EPS est ${found.epsForecast}` : undefined]
          .filter((p) => p !== undefined)
          .join(", ");
        return {
          output: [
            {
              type: "text" as const,
              text: `${tag()}${args.symbol} next earnings ${found.date} (${structured.daysUntil}d${extra === "" ? "" : `, ${extra}`}).`,
            },
          ],
          structuredOutput: structured,
        };
      } catch (error) {
        return fail(`Earnings lookup failed for ${args.symbol}: ${shortError(error)}`);
      }
    },
  });

  const earningsCalendar = defineTool({
    name: "market_earnings_calendar",
    description:
      "All companies reporting earnings on one ET date (Nasdaq calendar), limited to the largest 50 by market cap. " +
      "Use the structured output for the full list; the text names the top five.",
    parameters: Type.Object({
      date: Type.String({ description: "ET date YYYY-MM-DD.", pattern: DATE_PATTERN }),
    }),
    structuredOutputSchema: earningsCalendarSchema,
    replay: "safe",
    outputLimits: { maxBytes: 8_000, maxLines: 30 },
    async execute(args) {
      try {
        const rows = await fetchEarningsCalendar(cache, args.date);
        const sorted = [...rows].sort((a, b) => (b.marketCapNum ?? 0) - (a.marketCapNum ?? 0)).slice(0, 50);
        // Reported actuals are only known after the fact: blank them on and
        // after the simulated date (schedules themselves are public in advance).
        const cutoff = asOf?.();
        const hideActual = cutoff !== undefined && args.date >= cutoff;
        const structured = {
          date: args.date,
          rows: sorted.map((r) => ({
            symbol: r.symbol,
            name: r.name,
            time: r.time,
            ...(r.epsForecast === undefined ? {} : { epsForecast: r.epsForecast }),
            ...(r.actualEps === undefined || hideActual ? {} : { actualEps: r.actualEps }),
            ...(r.marketCap === undefined ? {} : { marketCap: r.marketCap }),
          })),
        };
        const top = sorted
          .slice(0, 5)
          .map((r) => `${r.symbol}${r.marketCap === undefined ? "" : ` ${r.marketCap}`}`)
          .join(", ");
        const text =
          sorted.length === 0
            ? `${tag()}${args.date}: no earnings reports on the calendar.`
            : `${tag()}${args.date}: ${sorted.length} companies reporting; largest: ${top}.`;
        return { output: [{ type: "text" as const, text }], structuredOutput: structured };
      } catch (error) {
        return fail(`Earnings calendar failed for ${args.date}: ${shortError(error)}`);
      }
    },
  });

  const economicCalendar = defineTool({
    name: "market_economic_calendar",
    description:
      "US economic events on one ET date (Nasdaq economic calendar): time, event, actual, consensus, and previous. " +
      "Use the structured output for the full list.",
    parameters: Type.Object({
      date: Type.String({ description: "ET date YYYY-MM-DD.", pattern: DATE_PATTERN }),
    }),
    structuredOutputSchema: economicCalendarSchema,
    replay: "safe",
    outputLimits: { maxBytes: 8_000, maxLines: 40 },
    async execute(args) {
      try {
        const cutoff = asOf?.();
        if (cutoff !== undefined && args.date > cutoff) {
          return fail(`${args.date} is not available in the simulation yet (simulation date ${cutoff}).`);
        }
        const fetched = (await fetchEconomicEvents(cache, args.date)).filter((e) => e.country === "United States");
        // Outcomes are only known after the fact: blank actuals for the
        // simulated date itself.
        const events =
          cutoff !== undefined && args.date === cutoff
            ? fetched.map((e) => ({ ...e, actual: undefined as string | undefined }))
            : fetched;
        const structured = {
          date: args.date,
          events: events.map((e) => ({
            time: e.time,
            country: e.country,
            event: e.event,
            ...(e.actual === undefined ? {} : { actual: e.actual }),
            ...(e.consensus === undefined ? {} : { consensus: e.consensus }),
            ...(e.previous === undefined ? {} : { previous: e.previous }),
          })),
        };
        const text =
          events.length === 0
            ? `${tag()}${args.date}: no US economic events on the calendar.`
            : `${tag()}${args.date}: ${events.length} US events: ` +
              events.map((e) => `${e.time} ${e.event}`).join("; ");
        return { output: [{ type: "text" as const, text }], structuredOutput: structured };
      } catch (error) {
        return fail(`Economic calendar failed for ${args.date}: ${shortError(error)}`);
      }
    },
  });

  const volatility = defineTool({
    name: "market_volatility",
    description:
      "VIX level and context from CBOE daily history: latest close, percentile rank within the window, 20-day " +
      "average, plus VIX3M/VIX9D closes and the term structure (contango when VIX3M is above VIX).",
    parameters: Type.Object({ range: rangeField("Window for the percentile rank; defaults to 1y.") }),
    structuredOutputSchema: volatilitySchema,
    replay: "safe",
    outputLimits: { maxBytes: 2_000, maxLines: 10 },
    async execute(args) {
      try {
        const range = rangeOr(args.range as RangeArg, "1y");
        const cutoff = asOf?.();
        const all = await fetchVixSeries(cache, "VIX");
        const vix = cutoff === undefined ? all : all.filter((b) => b.date <= cutoff);
        if (vix.length === 0) return fail("VIX history is empty.");
        const latest = vix[vix.length - 1];
        if (!latest) return fail("VIX history is empty.");
        const window = vix.slice(Math.max(0, vix.length - VOL_WINDOW[range])).map((b) => b.close);
        const rank = window.filter((c) => c <= latest.close).length;
        const percentile = window.length === 0 ? null : (rank / window.length) * 100;
        const sma20v = sma(
          vix.slice(Math.max(0, vix.length - 20)).map((b) => b.close),
          Math.min(20, vix.length),
        );
        const vix3m = await latestPoint(cache, "VIX3M", cutoff);
        const vix9d = await latestPoint(cache, "VIX9D", cutoff);
        const term =
          vix3m === undefined ? undefined : vix3m.close >= latest.close ? "contango" : "backwardation";
        const structured = {
          vix: { date: latest.date, close: latest.close, percentile1y: percentile, sma20: nullIfUndef(sma20v) },
          ...(vix3m === undefined ? {} : { vix3m }),
          ...(vix9d === undefined ? {} : { vix9d }),
          ...(term === undefined ? {} : { termStructure: term as "contango" | "backwardation" }),
        };
        const text =
          `${tag()}VIX ${latest.close.toFixed(2)} (${latest.date}), percentile ${fmtNum(percentile, 1)}, ` +
          `SMA20 ${fmtNum(sma20v)}` +
          (vix3m && vix9d ? `, VIX3M ${vix3m.close.toFixed(2)} VIX9D ${vix9d.close.toFixed(2)}, ${term}` : "") +
          ".";
        return { output: [{ type: "text" as const, text }], structuredOutput: structured };
      } catch (error) {
        return fail(`Volatility lookup failed: ${shortError(error)}`);
      }
    },
  });

  const yields = defineTool({
    name: "market_yields",
    description:
      "Latest US Treasury daily par yield curve with the 2s10s and 3m10y spreads and the 10-year change " +
      "over the last 20 sessions. Values are percent yields.",
    parameters: Type.Object({}),
    structuredOutputSchema: yieldsSchema,
    replay: "safe",
    outputLimits: { maxBytes: 2_000, maxLines: 10 },
    async execute() {
      try {
        const cutoff = asOf?.();
        const anchor = cutoff ?? etDate(clock.now());
        const year = Number(anchor.slice(0, 4));
        const all = await fetchYieldCurve(cache, year);
        const rows = cutoff === undefined ? all : all.filter((r) => r.date <= cutoff);
        const latest = rows[rows.length - 1];
        if (!latest) return fail("Treasury yield data is empty.");
        const prior = rows.length > 20 ? rows[rows.length - 21] : undefined;
        const y10 = latest.curve["10Y"];
        const y2 = latest.curve["2Y"];
        const y3m = latest.curve["3M"];
        const prior10 = prior?.curve["10Y"];
        const structured = {
          date: latest.date,
          curve: latest.curve,
          spread2s10s: y10 === undefined || y2 === undefined ? null : y10 - y2,
          spread3m10y: y10 === undefined || y3m === undefined ? null : y10 - y3m,
          change10y20d: y10 === undefined || prior10 === undefined ? null : y10 - prior10,
        };
        const bp = (v: number | null): string => (v === null ? "n/a" : `${v >= 0 ? "+" : ""}${Math.round(v * 100)}bp`);
        const text =
          `${tag()}${latest.date}: 2Y ${fmtNum(y2)}% 10Y ${fmtNum(y10)}% 30Y ${fmtNum(latest.curve["30Y"])}%, ` +
          `2s10s ${bp(structured.spread2s10s)}, 3m10y ${bp(structured.spread3m10y)}, ` +
          `10Y 20d change ${bp(structured.change10y20d)}.`;
        return { output: [{ type: "text" as const, text }], structuredOutput: structured };
      } catch (error) {
        return fail(`Yield lookup failed: ${shortError(error)}`);
      }
    },
  });

  const secCompany = defineTool({
    name: "sec_company",
    description:
      "SEC EDGAR company snapshot for a ticker: CIK, name, SIC, the last 15 filings with index links, " +
      "and the last 8 reported periods of revenue, net income, diluted EPS, shares outstanding, cash, " +
      "and long-term debt from XBRL company facts. Use the structured output for math.",
    parameters: Type.Object({ symbol: symbolField("Uppercase ticker, e.g. AAPL.") }),
    structuredOutputSchema: secCompanySchema,
    replay: "safe",
    outputLimits: { maxBytes: 12_000, maxLines: 60 },
    async execute(args) {
      try {
        const tickers = await fetchTickerMap(cache);
        const cik = tickers.get(args.symbol);
        if (cik === undefined) return fail(`Unknown ticker ${args.symbol}: no SEC CIK mapping.`);
        const [info, facts] = await Promise.all([fetchCompanyInfo(cache, cik), fetchCompanyFacts(cache, cik)]);
        const cutoff = asOf?.();
        // Filings after the simulated date do not exist yet; fact values are
        // only known once filed, so keep the last 8 filed on or before it.
        const filings = cutoff === undefined ? info.filings : info.filings.filter((f) => f.filedAt <= cutoff);
        const scopedFacts =
          cutoff === undefined
            ? facts
            : Object.fromEntries(
                Object.entries(facts).map(([group, points]) => [
                  group,
                  points.filter((p) => p.filed <= cutoff).slice(-8),
                ]),
              );
        const structured = {
          cik,
          name: info.name,
          sic: info.sic,
          sicDescription: info.sicDescription,
          recentFilings: filings.map((f) => ({ ...f })),
          facts: Object.fromEntries(Object.entries(scopedFacts).map(([group, points]) => [group, points.map((p) => ({ ...p }))])),
        };
        const groups = Object.keys(scopedFacts);
        const text =
          `${tag()}${info.name} (${args.symbol}, CIK ${Number(cik)}, SIC ${info.sic} ${info.sicDescription}), ` +
          `${filings.length} recent filings` +
          (groups.length === 0 ? ", no XBRL facts found." : `, facts: ${groups.join(", ")}.`);
        return { output: [{ type: "text" as const, text }], structuredOutput: structured };
      } catch (error) {
        return fail(`SEC lookup failed for ${args.symbol}: ${shortError(error)}`);
      }
    },
  });

  return defineExtension({
    name: "market",
    tools: deps.pricesOnly === true
      ? [priceHistory, indicators, compare]
      : [priceHistory, indicators, compare, earnings, earningsCalendar, economicCalendar, volatility, yields, secCompany],
  });
}

async function latestPoint(
  cache: MarketCache,
  kind: VixKind,
  cutoff?: string,
): Promise<{ date: string; close: number } | undefined> {
  try {
    const series = await fetchVixSeries(cache, kind);
    const scoped = cutoff === undefined ? series : series.filter((b) => b.date <= cutoff);
    const last = scoped[scoped.length - 1];
    return last === undefined ? undefined : { date: last.date, close: last.close };
  } catch {
    return undefined;
  }
}

function pairArrays(
  a: { date: string; r: number }[],
  b: { date: string; r: number }[],
): [number[], number[]] {
  const { a: pa, b: pb } = alignReturns(a, b);
  return [pa, pb];
}

function shortError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.slice(0, 200);
}
