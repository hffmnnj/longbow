import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import type { AccountSnapshot, Bar, RiskConfig } from "@rh/shared";
import type { Clock, Logger, MarketData } from "../ports.ts";
import { runBacktest, type BacktestEntry } from "./backtest.ts";
import { evaluateScreen, type ScreenPreset, type ScreenRow } from "./screen.ts";
import {
  alignLast,
  annualizedVol,
  correlationMatrix,
  portfolioBeta,
  portfolioSeries,
  varEs95,
  worstDayIndices,
  type DatedReturn,
} from "./riskmath.ts";
import { computeSize } from "./sizing.ts";
import { UNIVERSE_SECTORS } from "./universe.ts";
import { atr, closes, dailyReturns, periodReturn } from "../market/indicators.ts";

export interface QuantDeps {
  market: MarketData;
  /** Fresh account snapshot, or null when the broker is unavailable. */
  getAccount: () => Promise<AccountSnapshot | null>;
  /** Current risk settings, so sizing matches the risk engine. */
  getRisk: () => RiskConfig;
  /** Symbols a screen may scan: the live universe, or a simulation's aliased universe. */
  universe: () => readonly string[];
  /** Sector of a symbol when known (live: SEC-based directory; blind runs: the alias's disclosed sector). */
  sectorOf?: (symbol: string) => string | undefined;
  /** The benchmark symbol: "SPY" live, the alias of the market index in blind and bootstrap runs. */
  benchmark: () => string;
  clock: Clock;
  log: Logger;
}

const SYMBOL_PATTERN = "^[A-Z.]{1,10}$";

const symbolField = (description: string) =>
  Type.String({ description, pattern: SYMBOL_PATTERN, minLength: 1, maxLength: 10 });

const numOrNull = (description: string) => Type.Union([Type.Number(), Type.Null()], { description });

function err(text: string) {
  return { output: [{ type: "text" as const, text }], isError: true };
}

function fmtPct(value: number | undefined | null, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "n/a";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(digits)}%`;
}

function fmtNum(value: number | undefined | null, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}

function money(v: number): string {
  return `$${v.toFixed(2)}`;
}

/** JSON-safe structured output (Infinity from profit factors becomes null). */
function clean<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) => (typeof v === "number" && !Number.isFinite(v) ? null : v)),
  ) as T;
}

/** Bounded-concurrency map; a fetch failure drops out with a note instead of failing the call. */
async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

async function fetchBars(
  deps: QuantDeps,
  symbol: string,
  range: "1y" | "2y" | "5y" | "6m",
): Promise<{ symbol: string; bars?: Bar[]; error?: string }> {
  try {
    const history = await deps.market.history(symbol, range);
    if (history.bars.length === 0) return { symbol, error: "no bars returned" };
    return { symbol, bars: history.bars };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { symbol, error: msg.slice(0, 160) };
  }
}

function sectorOf(deps: QuantDeps, symbol: string): string | undefined {
  return deps.sectorOf?.(symbol) ?? UNIVERSE_SECTORS[symbol];
}

const screenRowSchema = Type.Object({
  symbol: Type.String(),
  sector: Type.Optional(Type.String()),
  last: Type.Number(),
  ret1m: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  ret3m: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  relStrength: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  dist52w: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  atrPct: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  rsi14: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  above50: Type.Optional(Type.Boolean()),
  above200: Type.Optional(Type.Boolean()),
  adv20: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  score: Type.Number(),
});

const screenSchema = Type.Object({
  preset: Type.String(),
  scanned: Type.Number(),
  rows: Type.Array(screenRowSchema),
  dropped: Type.Array(Type.Object({ symbol: Type.String(), reason: Type.String() })),
});

const backtestTradeSchema = Type.Object({
  symbol: Type.String(),
  entryDate: Type.String(),
  exitDate: Type.String(),
  entryPrice: Type.Number(),
  exitPrice: Type.Number(),
  pnlR: Type.Number(),
  returnPct: Type.Number(),
  holdingDays: Type.Number(),
  exitReason: Type.String(),
});

const symbolBacktestSchema = Type.Object({
  symbol: Type.String(),
  bars: Type.Number(),
  firstDate: Type.Optional(Type.String()),
  lastDate: Type.Optional(Type.String()),
  trades: Type.Number(),
  wins: Type.Number(),
  winRate: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  avgR: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  expectancyR: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  profitFactor: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  maxDrawdownR: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  avgHoldingDays: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  timeInvestedPct: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  buyHoldReturn: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  lastTrades: Type.Array(backtestTradeSchema),
});

const backtestSchema = Type.Object({
  entry: Type.String(),
  years: Type.Number(),
  costBps: Type.Number(),
  symbols: Type.Array(symbolBacktestSchema),
  pooled: Type.Object({
    symbols: Type.Number(),
    trades: Type.Number(),
    wins: Type.Number(),
    winRate: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    avgR: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    expectancyR: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    profitFactor: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    maxDrawdownR: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    avgHoldingDays: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    timeInvestedPct: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    buyHoldReturn: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    lastTrades: Type.Array(backtestTradeSchema),
    warning: Type.Optional(Type.String()),
  }),
});

const riskSchema = Type.Object({
  equity: Type.Union([Type.Number(), Type.Null()]),
  note: Type.Optional(Type.String()),
  weights: Type.Array(
    Type.Object({
      symbol: Type.String(),
      sector: Type.Union([Type.String(), Type.Null()]),
      marketValue: Type.Number(),
      weightPct: Type.Number(),
    }),
  ),
  sectors: Type.Array(
    Type.Object({
      sector: Type.String(),
      weightPct: Type.Number(),
      overCap: Type.Boolean(),
      capPct: Type.Number(),
    }),
  ),
  correlation: Type.Object({
    symbols: Type.Array(Type.String()),
    matrix: Type.Array(Type.Array(Type.Union([Type.Number(), Type.Null()]))),
    top: Type.Optional(
      Type.Object({ a: Type.String(), b: Type.String(), correlation: Type.Number() }),
    ),
  }),
  beta: numOrNull("Portfolio beta to the benchmark on 1y of daily returns."),
  volatilityAnnPct: numOrNull("Annualized portfolio volatility, percent."),
  var95: Type.Union([
    Type.Object({ dollars: Type.Number(), pct: Type.Number() }),
    Type.Null(),
  ]),
  expectedShortfall: Type.Union([
    Type.Object({ dollars: Type.Number(), pct: Type.Number() }),
    Type.Null(),
  ]),
  stress: Type.Array(
    Type.Object({
      date: Type.String(),
      benchmarkReturnPct: Type.Number(),
      portfolioReturnPct: Type.Number(),
    }),
  ),
  candidate: Type.Optional(
    Type.Object({
      symbol: Type.String(),
      notional: Type.Number(),
      beta: numOrNull("Beta with the candidate added."),
      volatilityAnnPct: numOrNull("Volatility with the candidate added, percent."),
      varDollars: Type.Union([Type.Number(), Type.Null()]),
      topCorrelation: Type.Union([Type.Number(), Type.Null()]),
      deltaBeta: Type.Union([Type.Number(), Type.Null()]),
      deltaVolatilityPct: Type.Union([Type.Number(), Type.Null()]),
      deltaVarDollars: Type.Union([Type.Number(), Type.Null()]),
    }),
  ),
});

const sizeSchema = Type.Object({
  symbol: Type.String(),
  entry: Type.Number(),
  stop: Type.Number(),
  quantity: Type.Number(),
  notional: Type.Number(),
  equityPct: Type.Number(),
  riskDollars: Type.Number(),
  rPerShare: Type.Number(),
  boundBy: Type.String(),
  checks: Type.Array(
    Type.Object({ rule: Type.String(), ok: Type.Boolean(), detail: Type.String() }),
  ),
});

export function createQuantExtension(deps: QuantDeps): Extension {
  const marketScreen = defineTool({
    name: "market_screen",
    description:
      "Scan a universe for one technical preset (trend_template, breakout_52w, pullback_20d, " +
      "rsi_oversold_uptrend, relative_strength, volatility_contraction) and return ranked rows with " +
      "returns, relative strength, distance to the 52-week high, ATR, RSI, trend position, and dollar volume. " +
      "Use the structured output for math; the text is only a summary.",
    parameters: Type.Object({
      preset: Type.Union(
        [
          Type.Literal("trend_template"),
          Type.Literal("breakout_52w"),
          Type.Literal("pullback_20d"),
          Type.Literal("rsi_oversold_uptrend"),
          Type.Literal("relative_strength"),
          Type.Literal("volatility_contraction"),
        ],
        { description: "Which setup to scan for." },
      ),
      symbols: Type.Optional(
        Type.Array(symbolField("Uppercase ticker."), {
          description: "Symbols to scan; defaults to the harness universe.",
          maxItems: 200,
        }),
      ),
      limit: Type.Optional(
        Type.Number({ description: "Max rows to return, default 15, max 40.", minimum: 1, maximum: 40 }),
      ),
    }),
    structuredOutputSchema: screenSchema,
    replay: "safe",
    outputLimits: { maxBytes: 12_000, maxLines: 40 },
    async execute(args) {
      const preset = args.preset as ScreenPreset;
      const limit = Math.min(40, Math.max(1, Math.floor(args.limit ?? 15)));
      const symbols = [...new Set(args.symbols ?? deps.universe())];
      if (symbols.length === 0) return err("No symbols to scan.");
      const benchmark = deps.benchmark();
      let benchRet3m: number | undefined;
      try {
        const bench = await deps.market.history(benchmark, "1y");
        benchRet3m = periodReturn(closes(bench.bars), 63);
      } catch {
        benchRet3m = undefined;
      }
      const fetched = await mapPool(symbols, 6, (s) => fetchBars(deps, s, "2y"));
      const rows: ScreenRow[] = [];
      const dropped: { symbol: string; reason: string }[] = [];
      for (const f of fetched) {
        if (!f.bars) {
          dropped.push({ symbol: f.symbol, reason: f.error ?? "fetch failed" });
          continue;
        }
        const result = evaluateScreen(
          { symbol: f.symbol, bars: f.bars, sector: sectorOf(deps, f.symbol), benchRet3m },
          preset,
        );
        if (result.row) rows.push(result.row);
        else dropped.push({ symbol: f.symbol, reason: result.skip ?? "no row" });
      }
      rows.sort((a, b) => b.score - a.score);
      const top = rows.slice(0, limit);
      const lines = top.map(
        (r) =>
          `${r.symbol}: last ${r.last.toFixed(2)}, ret3m ${fmtPct(r.ret3m)} RS ${fmtPct(r.relStrength)} ` +
          `dist52w ${fmtPct(r.dist52w)} ATR% ${fmtPct(r.atrPct)} RSI14 ${fmtNum(r.rsi14, 1)} score ${r.score.toFixed(3)}`,
      );
      const text =
        `${preset}: ${rows.length}/${symbols.length} passed` +
        (lines.length === 0 ? "." : `, top ${top.length}:\n${lines.join("\n")}`);
      return {
        output: [{ type: "text" as const, text }],
        structuredOutput: clean({ preset, scanned: symbols.length, rows: top, dropped }),
      };
    },
  });

  const quantBacktest = defineTool({
    name: "quant_backtest",
    description:
      "Deterministic rule backtest over daily bars: signals use the signal day's close and fill at the " +
      "next open (no look-ahead); stops and targets fill at the open on gap-through bars; one position per " +
      "symbol; costs applied per side. Reports per-symbol and pooled trades, win rate, average R, expectancy, " +
      "profit factor, max drawdown in R, holding days, time invested, buy-and-hold, and the last five trades. " +
      "Under 30 pooled trades the result is suggestive, not conclusive.",
    parameters: Type.Object({
      symbols: Type.Array(symbolField("Uppercase ticker."), {
        description: "Up to 20 tickers to backtest.",
        minItems: 1,
        maxItems: 20,
      }),
      entry: Type.Union(
        [
          Type.Literal("breakout_20d"),
          Type.Literal("pullback_20sma_uptrend"),
          Type.Literal("rsi2_mean_reversion"),
          Type.Literal("sma_cross_20_50"),
          Type.Literal("trend_template"),
        ],
        { description: "Entry preset." },
      ),
      exit: Type.Optional(
        Type.Object({
          stopAtr: Type.Optional(Type.Number({ description: "Stop distance in ATR multiples.", minimum: 0.1, maximum: 20 })),
          targetR: Type.Optional(Type.Number({ description: "Profit target in R multiples.", minimum: 0.1, maximum: 50 })),
          timeStopDays: Type.Optional(Type.Number({ description: "Sessions then exit at the close.", minimum: 1, maximum: 252 })),
          trailAtr: Type.Optional(Type.Number({ description: "Trailing stop in ATR multiples.", minimum: 0.1, maximum: 20 })),
        }),
      ),
      years: Type.Optional(Type.Number({ description: "Lookback in years, 1 to 5; default 3.", minimum: 1, maximum: 5 })),
      costBps: Type.Optional(Type.Number({ description: "Cost per side in basis points; default 5.", minimum: 0, maximum: 200 })),
    }),
    structuredOutputSchema: backtestSchema,
    replay: "safe",
    outputLimits: { maxBytes: 12_000, maxLines: 60 },
    async execute(args) {
      const entry = args.entry as BacktestEntry;
      const years = Math.min(5, Math.max(1, args.years ?? 3));
      const costBps = args.costBps ?? 5;
      const exit = {
        stopAtr: args.exit?.stopAtr ?? 2,
        ...(args.exit?.targetR === undefined ? {} : { targetR: args.exit.targetR }),
        timeStopDays: args.exit?.timeStopDays ?? 20,
        ...(args.exit?.trailAtr === undefined ? {} : { trailAtr: args.exit.trailAtr }),
      };
      const symbols = [...new Set(args.symbols)];
      const fetched = await mapPool(symbols, 6, (s) => fetchBars(deps, s, "5y"));
      const barsBySymbol = new Map<string, Bar[]>();
      const missing: string[] = [];
      for (const f of fetched) {
        if (f.bars) barsBySymbol.set(f.symbol, f.bars);
        else missing.push(f.symbol);
      }
      if (barsBySymbol.size === 0) return err(`No history for ${symbols.join(", ")}.`);
      const result = runBacktest(barsBySymbol, { entry, exit, years, costBps });
      const p = result.pooled;
      const text =
        `${entry} ${years}y costs ${costBps}bps/side: ${p.trades} pooled trades, ` +
        `win rate ${fmtPct(p.winRate)} avgR ${fmtNum(p.avgR)} expectancy ${fmtNum(p.expectancyR)}R ` +
        `profit factor ${fmtNum(p.profitFactor)} maxDD ${fmtNum(p.maxDrawdownR)}R ` +
        `avg hold ${fmtNum(p.avgHoldingDays, 1)}d invested ${fmtNum(p.timeInvestedPct, 1)}% ` +
        `buy-hold ${fmtPct(p.buyHoldReturn)}` +
        (missing.length === 0 ? "" : ` (no data: ${missing.join(", ")})`) +
        (p.warning === undefined ? "" : `\nWarning: ${p.warning}`);
      return { output: [{ type: "text" as const, text }], structuredOutput: clean(result) };
    },
  });

  const portfolioRisk = defineTool({
    name: "portfolio_risk",
    description:
      "Risk of the current account: weights and sectors, the 60-day correlation matrix of holdings plus an " +
      "optional candidate, the top pairwise correlation, portfolio beta and annualized volatility on 1y of " +
      "daily returns at current weights, 1-day 95% historical VaR and expected shortfall, sector concentration " +
      "against the risk cap, and a stress replay of the benchmark's five worst days in the past year. " +
      "With a candidate, reports the change in beta, volatility, VaR, and top correlation.",
    parameters: Type.Object({
      candidate: Type.Optional(
        Type.Object({
          symbol: symbolField("Uppercase ticker to evaluate adding."),
          notional: Type.Number({ description: "Candidate notional in USD.", exclusiveMinimum: 0 }),
        }),
      ),
    }),
    structuredOutputSchema: riskSchema,
    replay: "safe",
    outputLimits: { maxBytes: 12_000, maxLines: 60 },
    async execute(args) {
      let account: Awaited<ReturnType<QuantDeps["getAccount"]>>;
      try {
        account = await deps.getAccount();
      } catch {
        account = null;
      }
      const risk = deps.getRisk();
      const benchmark = deps.benchmark();
      const positions = (account?.positions ?? []).filter((p) => p.quantity > 0 && p.marketValue > 0);
      const candidate = args.candidate;
      const names = [...positions.map((p) => p.symbol), ...(candidate ? [candidate.symbol] : []), benchmark];
      const uniq = [...new Set(names)];
      const fetched = await mapPool(uniq, 6, (s) => fetchBars(deps, s, "1y"));
      const bySymbol = new Map<string, Bar[]>();
      const missing: string[] = [];
      for (const f of fetched) {
        if (f.bars) bySymbol.set(f.symbol, f.bars);
        else missing.push(f.symbol);
      }
      const rets = new Map<string, DatedReturn[]>();
      for (const [s, bars] of bySymbol) rets.set(s, dailyReturns(bars));

      if (!account || positions.length === 0) {
        const note =
          account === null || account === undefined
            ? "No account snapshot; analysing the candidate alone."
            : "No positions; analysing the candidate alone.";
        if (!candidate || !bySymbol.has(candidate.symbol) || !bySymbol.has(benchmark)) {
          return {
            output: [{ type: "text" as const, text: `${note} Need a candidate and benchmark history.` }],
            structuredOutput: clean({
              equity: account?.equity ?? null,
              note,
              weights: [],
              sectors: [],
              correlation: { symbols: [], matrix: [] },
              beta: null,
              volatilityAnnPct: null,
              var95: null,
              expectedShortfall: null,
              stress: [],
            }),
          };
        }
        const cRed = rets.get(candidate.symbol) ?? [];
        const bRet = rets.get(benchmark) ?? [];
        const common = new Map(bRet.map((p) => [p.date, p.r] as const));
        const paired = cRed.filter((p) => common.has(p.date));
        const cVec = paired.map((p) => p.r);
        const bVec = paired.map((p) => common.get(p.date) ?? 0);
        const year = cVec.slice(-252);
        const yearB = bVec.slice(-252);
        const betaV = portfolioBeta(year, yearB);
        const vol = annualizedVol(year);
        const ve = varEs95(year);
        const text =
          `${note} ${candidate.symbol}: beta ${fmtNum(betaV)} vs ${benchmark}, ` +
          `ann vol ${fmtPct(vol === undefined ? null : vol)}` +
            `, 1d 95% VaR ${candidate.notional === undefined ? "n/a" : money((ve?.varPct ?? 0) * candidate.notional)}.`;
        return {
          output: [{ type: "text" as const, text }],
          structuredOutput: clean({
            equity: account?.equity ?? null,
            note,
            weights: [],
            sectors: [],
            correlation: { symbols: [], matrix: [] },
            beta: betaV ?? null,
            volatilityAnnPct: vol === undefined ? null : vol * 100,
            var95: ve ? { dollars: ve.varPct * candidate.notional, pct: ve.varPct * 100 } : null,
            expectedShortfall: ve ? { dollars: ve.esPct * candidate.notional, pct: ve.esPct * 100 } : null,
            stress: [],
            candidate: {
              symbol: candidate.symbol,
              notional: candidate.notional,
              beta: betaV ?? null,
              volatilityAnnPct: vol === undefined ? null : vol * 100,
              varDollars: ve ? ve.varPct * candidate.notional : null,
              topCorrelation: null,
              deltaBeta: null,
              deltaVolatilityPct: null,
              deltaVarDollars: null,
            },
          }),
        };
      }

      const equity = account.equity;
      const weights = new Map(positions.map((p) => [p.symbol, equity > 0 ? p.marketValue / equity : 0] as const));
      const held = positions.map((p) => p.symbol).filter((s) => rets.has(s));
      const corrSyms = [...held, ...(candidate && rets.has(candidate.symbol) ? [candidate.symbol] : [])];
      const { matrix: corrVecs } = alignLast(rets, corrSyms, 60);
      const corr = correlationMatrix(corrVecs);

      // Portfolio series on dates common to holdings, candidate, and benchmark (up to 1y).
      const all = [...held, benchmark, ...(candidate && rets.has(candidate.symbol) ? [candidate.symbol] : [])];
      const { dates, matrix } = alignLast(rets, all, 252);
      const portVec = portfolioSeries(matrix, weights);
      const benchVec = matrix.get(benchmark) ?? [];
      const betaV = portfolioBeta(portVec, benchVec);
      const vol = annualizedVol(portVec);
      const ve = varEs95(portVec);
      const worst = worstDayIndices(benchVec, 5);
      const stress = worst.map((k) => {
        let pr = 0;
        for (const s of held) pr += (weights.get(s) ?? 0) * (matrix.get(s)?.[k] ?? 0);
        return {
          date: dates[k] ?? "",
          benchmarkReturnPct: (benchVec[k] ?? 0) * 100,
          portfolioReturnPct: pr * 100,
        };
      });

      const sectorW = new Map<string, number>();
      for (const p of positions) {
        const sec = p.sector ?? sectorOf(deps, p.symbol) ?? "Unknown";
        sectorW.set(sec, (sectorW.get(sec) ?? 0) + (equity > 0 ? (p.marketValue / equity) * 100 : 0));
      }
      const sectors = [...sectorW.entries()].map(([sector, weightPct]) => ({
        sector,
        weightPct,
        overCap: weightPct > risk.maxSectorPct,
        capPct: risk.maxSectorPct,
      }));

      let candidateOut:
        | {
            symbol: string;
            notional: number;
            beta: number | null;
            volatilityAnnPct: number | null;
            varDollars: number | null;
            topCorrelation: number | null;
            deltaBeta: number | null;
            deltaVolatilityPct: number | null;
            deltaVarDollars: number | null;
          }
        | undefined;
      if (candidate && rets.has(candidate.symbol) && equity > 0) {
        const w2 = new Map(weights);
        w2.set(candidate.symbol, (w2.get(candidate.symbol) ?? 0) + candidate.notional / equity);
        const port2 = portfolioSeries(matrix, w2);
        const beta2 = portfolioBeta(port2, benchVec);
        const vol2 = annualizedVol(port2);
        const ve2 = varEs95(port2);
        const top2 = corr.top?.correlation ?? null;
        candidateOut = {
          symbol: candidate.symbol,
          notional: candidate.notional,
          beta: beta2 ?? null,
          volatilityAnnPct: vol2 === undefined ? null : vol2 * 100,
          varDollars: ve2 ? ve2.varPct * equity : null,
          topCorrelation: top2,
          deltaBeta: beta2 !== undefined && betaV !== undefined ? beta2 - betaV : null,
          deltaVolatilityPct: vol2 !== undefined && vol !== undefined ? (vol2 - vol) * 100 : null,
          deltaVarDollars: ve2 && ve ? (ve2.varPct - ve.varPct) * equity : null,
        };
      }

      const text =
        `Equity ${money(equity)} in ${held.length} positions` +
        (missing.length === 0 ? "" : ` (no data: ${missing.join(", ")})`) +
        `: beta ${fmtNum(betaV)} vs ${benchmark}, ann vol ${fmtPct(vol === undefined ? null : vol)}, ` +
        `1d 95% VaR ${ve ? `${money(ve.varPct * equity)} (${fmtPct(ve.varPct)})` : "n/a"}, ` +
        `ES ${ve ? money(ve.esPct * equity) : "n/a"}, ` +
        `top corr ${corr.top ? `${corr.top.a}/${corr.top.b} ${corr.top.correlation.toFixed(2)}` : "n/a"}` +
        (sectors.filter((s) => s.overCap).length === 0
          ? ", no sector over its cap."
          : `, OVER CAP: ${sectors.filter((s) => s.overCap).map((s) => `${s.sector} ${s.weightPct.toFixed(1)}%`).join(", ")}.`) +
        (candidateOut
          ? ` Candidate ${candidate!.symbol} ${money(candidate!.notional)}: beta ${fmtNum((candidateOut as { beta: number | null }).beta)} ` +
            `(Δ ${fmtNum((candidateOut as { deltaBeta: number | null }).deltaBeta)}), ` +
            `VaR Δ ${fmtNum((candidateOut as { deltaVarDollars: number | null }).deltaVarDollars, 0)}.`
          : "");
      return {
        output: [{ type: "text" as const, text }],
        structuredOutput: clean({
          equity,
          weights: positions.map((p) => ({
            symbol: p.symbol,
            sector: p.sector ?? sectorOf(deps, p.symbol) ?? null,
            marketValue: p.marketValue,
            weightPct: equity > 0 ? (p.marketValue / equity) * 100 : 0,
          })),
          sectors,
          correlation: corr,
          beta: betaV ?? null,
          volatilityAnnPct: vol === undefined ? null : vol * 100,
          var95: ve ? { dollars: ve.varPct * equity, pct: ve.varPct * 100 } : null,
          expectedShortfall: ve ? { dollars: ve.esPct * equity, pct: ve.esPct * 100 } : null,
          stress,
          ...(candidateOut === undefined ? {} : { candidate: candidateOut }),
        }),
      };
    },
  });

  const sizePosition = defineTool({
    name: "size_position",
    description:
      "Size a long entry from its dollar risk: quantity is equity times risk percent over risk per share " +
      "(entry minus stop, floored to 6 decimals), then capped by the max position percent, the max order " +
      "notional, and buying power. Without a stop, the stop is entry minus atrMultiple times ATR(14). " +
      "Reports quantity, notional, percent of equity, dollars at risk, R per share, which cap bound the " +
      "size, and whether the order would pass each sizing rule.",
    parameters: Type.Object({
      symbol: symbolField("Uppercase ticker to size."),
      entry: Type.Number({ description: "Entry price in USD.", exclusiveMinimum: 0 }),
      stop: Type.Optional(Type.Number({ description: "Invalidation price in USD; below entry for longs.", exclusiveMinimum: 0 })),
      riskPct: Type.Optional(
        Type.Number({ description: "Percent of equity to risk; defaults to maxRiskPerTradePct.", exclusiveMinimum: 0, maximum: 100 }),
      ),
      atrMultiple: Type.Optional(
        Type.Number({ description: "ATR multiples for the default stop; default 2.", minimum: 0.1, maximum: 20 }),
      ),
    }),
    structuredOutputSchema: sizeSchema,
    replay: "safe",
    outputLimits: { maxBytes: 4_000, maxLines: 20 },
    async execute(args) {
      let account: Awaited<ReturnType<QuantDeps["getAccount"]>>;
      try {
        account = await deps.getAccount();
      } catch {
        account = null;
      }
      if (!account) return err("No account snapshot; cannot size without equity and buying power.");
      const risk = deps.getRisk();
      const existing = account.positions.find((p) => p.symbol === args.symbol)?.marketValue ?? 0;
      let atrValue: number | undefined;
      if (args.stop === undefined) {
        const fetched = await fetchBars(deps, args.symbol, "6m");
        if (!fetched.bars) return err(`No history for ${args.symbol}; pass an explicit stop.`);
        atrValue = atr(fetched.bars, 14);
        if (atrValue === undefined) return err(`Not enough history for ATR(14) on ${args.symbol}; pass an explicit stop.`);
      }
      const sized = computeSize({
        symbol: args.symbol,
        entry: args.entry,
        ...(args.stop === undefined ? {} : { stop: args.stop }),
        ...(atrValue === undefined ? {} : { atr: atrValue }),
        atrMultiple: args.atrMultiple ?? 2,
        riskPct: args.riskPct ?? risk.maxRiskPerTradePct,
        equity: account.equity,
        buyingPower: account.buyingPower,
        ...(account.settledCash === undefined ? {} : { settledCash: account.settledCash }),
        existingMarketValue: existing,
        risk,
      });
      if ("error" in sized) return err(sized.error);
      const failed = sized.checks.filter((c) => !c.ok);
      const text =
        `${sized.symbol}: buy ${sized.quantity} @ ${money(sized.entry)} = ${money(sized.notional)} ` +
        `(${sized.equityPct.toFixed(2)}% of equity), risk ${money(sized.riskDollars)}, ` +
        `stop ${money(sized.stop)}, R/share ${money(sized.rPerShare)}, bound by ${sized.boundBy}` +
        (failed.length === 0 ? "; passes all sizing rules." : `; FAILS: ${failed.map((c) => c.rule).join(", ")}.`);
      return { output: [{ type: "text" as const, text }], structuredOutput: clean(sized) };
    },
  });

  return defineExtension({
    name: "quant",
    tools: [marketScreen, quantBacktest, portfolioRisk, sizePosition],
  });
}
