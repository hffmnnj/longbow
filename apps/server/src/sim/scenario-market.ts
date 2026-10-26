import type { Bar, HistoryRange } from "@rh/shared";
import type { MarketData } from "../ports.ts";
import type { SectorDirectory } from "../market/sectors.ts";
import { avgDollarVolume } from "../market/indicators.ts";
import { endOfEtDateMs } from "../market/market-data.ts";
import { createRng, geometricLength, intIn, pick } from "./rng.ts";

/**
 * Fictional markets for blind and bootstrap simulation runs.
 *
 * Both modes hide every real-world handle from the agent: tickers become
 * aliases, dates move to a fictional weekday calendar in 2031-2032, and
 * prices are rescaled. Blind replays real history (returns unchanged);
 * bootstrap resamples it in stationary blocks so the path is synthetic but
 * keeps the joint cross-sectional structure.
 */

export const BENCHMARK_ALIAS = "MKT";

/** SPDR sector ETF, in a fixed order, with its alias and disclosed sector. */
export const SECTOR_ETFS: readonly { real: string; alias: string; sector: string }[] = [
  { real: "XLK", alias: "STECH", sector: "Technology" },
  { real: "XLF", alias: "SFIN", sector: "Financials" },
  { real: "XLE", alias: "SENGY", sector: "Energy" },
  { real: "XLV", alias: "SHLTH", sector: "Health Care" },
  { real: "XLY", alias: "SDISC", sector: "Consumer Discretionary" },
  { real: "XLP", alias: "SSTPL", sector: "Consumer Staples" },
  { real: "XLI", alias: "SINDU", sector: "Industrials" },
  { real: "XLB", alias: "SMATL", sector: "Materials" },
  { real: "XLU", alias: "SUTIL", sector: "Utilities" },
  { real: "XLRE", alias: "SREAL", sector: "Real Estate" },
  { real: "XLC", alias: "SCOMM", sector: "Communication Services" },
];

const BROAD_MARKET_SECTOR = "Broad Market";

/** Extra history every scenario market carries before the simulated window, in sessions. */
export const WARMUP_SESSIONS = 300;

/** Joint history starts here; every bootstrap draw comes from a common date at or after it. */
export const BOOTSTRAP_HISTORY_START = "2016-10-24";

/** Mean stationary-bootstrap block length, in sessions. */
const BOOTSTRAP_BLOCK_MEAN = 10;

/** Sessions counted back per range, mirroring the live market store. */
const RANGE_SESSIONS: Record<HistoryRange, number> = {
  "1m": 21,
  "3m": 63,
  "6m": 126,
  "1y": 252,
  "2y": 504,
  "5y": Number.MAX_SAFE_INTEGER,
};

export interface ScenarioMarketSpec {
  mode: "blind" | "bootstrap";
  seed: number;
  /** Real symbols requested (the run watchlist). SPY and the sector ETFs are always added. */
  watchlist: string[];
  /** Trading days to simulate. */
  days: number;
  /** First simulated source date; required for blind, ignored by bootstrap. */
  startDate?: string;
  /** ET date the source history may run through (today), YYYY-MM-DD. */
  today: string;
  /** Source daily bars, `from <= date <= to`, oldest first. */
  fetch(symbol: string, from: string, to: string): Promise<Bar[]>;
  /** Real-symbol sectors, consulted for the alias disclosures. Absent sectors stay undisclosed. */
  sectors?: SectorDirectory;
}

export interface ScenarioMarket {
  /** Agent-visible symbols, benchmark first. */
  symbols: string[];
  /** The agent-visible benchmark symbol ("MKT"). */
  benchmark: string;
  /** Alias to real symbol (bootstrap: the source symbol). Set on the run only when it ends. */
  aliases: Record<string, string>;
  /** Alias to disclosed sector, when known. */
  sectorOf(alias: string): string | undefined;
  /** Fictional calendar: first simulated day, plus the source window for blind. */
  calendar: { firstDay: string; sourceStart?: string; sourceEnd?: string };
  /** Real symbols dropped for missing history. */
  dropped: string[];
  /** Fictional simulated dates, oldest first. */
  simDates: string[];
  /** Full fictional sequence (warmup then simulated), oldest first. */
  allDates: string[];
  /** Source ET date behind each fictional session (warmup then simulated), oldest first. */
  sourceDates: string[];
  /** Full fictional series for the paper broker. */
  bars(alias: string): Promise<Bar[]>;
  /** Point-in-time market over the transformed bars; `asOf` is the current simulated fictional day. */
  market(asOf: () => string): MarketData;
  /** "MKT (Broad Market), STECH (Technology), ..." for the simulation prompt. */
  universeText: string;
}

function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T12:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function isWeekend(date: string): boolean {
  const day = new Date(Date.parse(`${date}T12:00:00Z`)).getUTCDay();
  return day === 0 || day === 6;
}

/** Fictional calendar: `warmup` weekdays of history then `days` simulated days, with the first simulated day a seeded weekday between 2031-01-06 and 2032-06-30. */
export function fictionalCalendar(rng: () => number, warmup: number, days: number): string[] {
  let first = addDays("2031-01-06", intIn(rng, 0, 530));
  while (isWeekend(first)) first = addDays(first, 1);
  const before: string[] = [];
  let cur = first;
  while (before.length < warmup) {
    cur = addDays(cur, -1);
    if (!isWeekend(cur)) before.unshift(cur);
  }
  const out = [...before, first];
  cur = first;
  while (out.length < warmup + days) {
    cur = addDays(cur, 1);
    if (!isWeekend(cur)) out.push(cur);
  }
  return out;
}

/** A fixed SectorDirectory over pre-resolved entries (alias to sector), for the order gate and quant tools. */
export function createStaticSectorDirectory(entries: Record<string, string | undefined>): SectorDirectory {
  const known = new Map<string, string | undefined>(
    Object.entries(entries).map(([symbol, sector]) => [symbol.toUpperCase(), sector]),
  );
  return {
    get: (symbol) => known.get(symbol.toUpperCase()),
    resolve: async () => {},
  };
}

function byDate(bars: Bar[]): Map<string, Bar> {
  return new Map(bars.map((b) => [b.date, b]));
}

/** "Z" plus three seeded capital letters. */
function stockAlias(rng: () => number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return `Z${letters[intIn(rng, 0, 25)]}${letters[intIn(rng, 0, 25)]}${letters[intIn(rng, 0, 25)]}`;
}

function createMarketData(
  mode: "blind" | "bootstrap",
  series: Map<string, Bar[]>,
  asOf: () => string,
): MarketData {
  return {
    history: async (symbol, range) => {
      const cutoff = asOf();
      const scoped = (series.get(symbol) ?? []).filter((b) => b.date <= cutoff);
      const want = RANGE_SESSIONS[range];
      const window = scoped.length > want ? scoped.slice(scoped.length - want) : scoped;
      return { symbol, bars: window.map((b) => ({ ...b })), source: `sim-${mode}`, asOf: endOfEtDateMs(cutoff) };
    },
    nextEarnings: async () => undefined,
    avgDollarVolume: async (symbol, days) => {
      const cutoff = asOf();
      return avgDollarVolume((series.get(symbol) ?? []).filter((b) => b.date <= cutoff), days);
    },
  };
}

function assemble(symbols: string[], aliases: Record<string, string>,
  sectors: Map<string, string | undefined>, calendar: ScenarioMarket["calendar"], dropped: string[],
  simDates: string[], allDates: string[], sourceDates: string[], fictional: Map<string, Bar[]>, mode: "blind" | "bootstrap"): ScenarioMarket {
  const sectorOf = (alias: string): string | undefined => sectors.get(alias);
  const universeText = symbols.map((s) => {
    const sector = sectors.get(s);
    return sector === undefined ? s : `${s} (${sector})`;
  }).join(", ");
  return {
    symbols,
    benchmark: BENCHMARK_ALIAS,
    aliases,
    sectorOf,
    calendar,
    dropped,
    simDates,
    allDates,
    sourceDates,
    bars: async (alias) => (fictional.get(alias) ?? []).map((b) => ({ ...b })),
    market: (asOf) => createMarketData(mode, fictional, asOf),
    universeText,
  };
}

function assignAliases(rng: () => number, stocks: string[], realUniverse: Set<string>): { aliases: Record<string, string>; used: Set<string> } {
  const aliases: Record<string, string> = { MKT: "SPY" };
  const used = new Set<string>(["MKT"]);
  for (const etf of SECTOR_ETFS) {
    aliases[etf.alias] = etf.real;
    used.add(etf.alias);
  }
  for (const real of stocks) {
    let alias = stockAlias(rng);
    while (used.has(alias) || realUniverse.has(alias)) alias = stockAlias(rng);
    aliases[alias] = real;
    used.add(alias);
  }
  return { aliases, used };
}

async function buildBlind(spec: ScenarioMarketSpec, rng: () => number): Promise<ScenarioMarket> {
  const { days, today } = spec;
  const startDate = spec.startDate;
  if (startDate === undefined) throw new Error("Blind simulation needs a start date");
  const realUniverse = [...new Set([...spec.watchlist.map((s) => s.toUpperCase()), "SPY", ...SECTOR_ETFS.map((e) => e.real)])];
  const from = addDays(startDate, -800);
  const fetched = new Map<string, Bar[]>();
  for (const symbol of realUniverse) fetched.set(symbol, await spec.fetch(symbol, from, today));
  const spy = byDate(fetched.get("SPY") ?? []);
  const spyDates = [...spy.keys()].sort();
  const startIdx = spyDates.indexOf(startDate);
  if (startIdx < WARMUP_SESSIONS || startIdx + days > spyDates.length) {
    throw new Error(`Insufficient history around ${startDate} for a blind run of ${days} days`);
  }
  const sourceDates = spyDates.slice(startIdx - WARMUP_SESSIONS, startIdx + days);
  const windowDates = sourceDates.slice(WARMUP_SESSIONS);
  const kept: string[] = [];
  const dropped: string[] = [];
  const sourceBySymbol = new Map<string, Bar[]>();
  for (const symbol of realUniverse) {
    const bars = byDate(fetched.get(symbol) ?? []);
    if (sourceDates.every((d) => bars.has(d))) {
      kept.push(symbol);
      sourceBySymbol.set(symbol, sourceDates.map((d) => bars.get(d)!));
    } else {
      dropped.push(symbol);
    }
  }
  if (!kept.includes("SPY")) throw new Error(`Insufficient history around ${startDate} for a blind run of ${days}`);
  const stocks = kept.filter((s) => s !== "SPY" && !SECTOR_ETFS.some((e) => e.real === s));
  const { aliases } = assignAliases(rng, stocks, new Set(realUniverse));
  await spec.sectors?.resolve(kept);
  const fictionalDates = fictionalCalendar(rng, WARMUP_SESSIONS, days);
  const factors = new Map<string, number>(kept.map((s) => [s, 0.4 + rng() * (2.5 - 0.4)]));
  const fictional = new Map<string, Bar[]>();
  for (const [alias, real] of Object.entries(aliases)) {
    const source = sourceBySymbol.get(real);
    if (source === undefined) continue;
    const factor = factors.get(real) ?? 1;
    fictional.set(alias, source.map((b, i) => ({
      date: fictionalDates[i]!,
      open: b.open * factor,
      high: b.high * factor,
      low: b.low * factor,
      close: b.close * factor,
      volume: Math.max(1, Math.round(b.volume / factor)),
    })));
  }
  const symbols = Object.keys(aliases).filter((a) => fictional.has(a));
  symbols.sort((a, b) => (a === BENCHMARK_ALIAS ? -1 : b === BENCHMARK_ALIAS ? 1 : a.localeCompare(b)));
  const sectors = new Map<string, string | undefined>([[BENCHMARK_ALIAS, BROAD_MARKET_SECTOR]]);
  for (const etf of SECTOR_ETFS) if (fictional.has(etf.alias)) sectors.set(etf.alias, etf.sector);
  for (const [alias, real] of Object.entries(aliases)) {
    if (alias === BENCHMARK_ALIAS || sectors.has(alias)) continue;
    if (fictional.has(alias)) sectors.set(alias, spec.sectors?.get(real));
  }
  return assemble(symbols, aliases, sectors,
    { firstDay: fictionalDates[WARMUP_SESSIONS]!, sourceStart: windowDates[0], sourceEnd: windowDates.at(-1) },
    dropped, fictionalDates.slice(WARMUP_SESSIONS), fictionalDates, sourceDates, fictional, "blind");
}

async function buildBootstrap(spec: ScenarioMarketSpec, rng: () => number): Promise<ScenarioMarket> {
  const { days, today } = spec;
  const realUniverse = [...new Set([...spec.watchlist.map((s) => s.toUpperCase()), "SPY", ...SECTOR_ETFS.map((e) => e.real)])];
  const fetched = new Map<string, Bar[]>();
  for (const symbol of realUniverse) fetched.set(symbol, await spec.fetch(symbol, BOOTSTRAP_HISTORY_START, today));
  const dateSets = new Map<string, Set<string>>(realUniverse.map((s) => [s, new Set((fetched.get(s) ?? []).map((b) => b.date))]));
  // Drop the sparsest names until the joint history covers warmup plus the run. SPY is never dropped.
  const kept = [...realUniverse];
  const dropped: string[] = [];
  const commonDates = (): string[] => {
    const sets = kept.map((s) => dateSets.get(s) ?? new Set<string>());
    const [first, ...rest] = sets;
    if (first === undefined) return [];
    return [...first].filter((d) => rest.every((s) => s.has(d))).sort();
  };
  let common = commonDates();
  while (common.length < WARMUP_SESSIONS + days && kept.length > 1) {
    const sparse = kept.filter((s) => s !== "SPY").sort((a, b) => (dateSets.get(a)?.size ?? 0) - (dateSets.get(b)?.size ?? 0))[0];
    if (sparse === undefined) break;
    kept.splice(kept.indexOf(sparse), 1);
    dropped.push(sparse);
    common = commonDates();
  }
  if (common.length < WARMUP_SESSIONS + days) throw new Error("Insufficient joint history for a bootstrap run");
  const total = WARMUP_SESSIONS + days;
  // Stationary bootstrap: geometric block lengths (mean 10) sharing one source date per session.
  const draws: number[] = [];
  while (draws.length < total) {
    const start = intIn(rng, 0, common.length - 1);
    const length = Math.min(geometricLength(rng, BOOTSTRAP_BLOCK_MEAN), total - draws.length);
    for (let i = 0; i < length; i++) draws.push((start + i) % common.length);
  }
  const sourceDates = draws.map((i) => common[i]!);
  const bySymbol = new Map<string, Map<string, Bar>>();
  for (const symbol of kept) bySymbol.set(symbol, byDate(fetched.get(symbol) ?? []));
  const closeOn = (symbol: string, date: string): number => bySymbol.get(symbol)?.get(date)?.close ?? NaN;
  const stocks = kept.filter((s) => s !== "SPY" && !SECTOR_ETFS.some((e) => e.real === s));
  const { aliases } = assignAliases(rng, stocks, new Set(realUniverse));
  await spec.sectors?.resolve(kept);
  const fictionalDates = fictionalCalendar(rng, WARMUP_SESSIONS, days);
  const seedDate = pick(rng, common);
  const factors = new Map<string, number>(kept.map((s) => [s, 0.4 + rng() * (2.5 - 0.4)]));
  const fictional = new Map<string, Bar[]>();
  for (const [alias, real] of Object.entries(aliases)) {
    if (!kept.includes(real)) continue;
    const factor = factors.get(real) ?? 1;
    let previous = closeOn(real, seedDate) * factor;
    fictional.set(alias, sourceDates.map((date, i) => {
      const bar = bySymbol.get(real)?.get(date);
      if (bar === undefined || !Number.isFinite(previous)) throw new Error(`Missing source bar for ${real} on ${date}`);
      const prevSource = closeOn(real, common[(draws[i]! - 1 + common.length) % common.length]!);
      const open = (bar.open / prevSource) * previous;
      const high = (bar.high / prevSource) * previous;
      const low = (bar.low / prevSource) * previous;
      const close = (bar.close / prevSource) * previous;
      previous = close;
      return { date: fictionalDates[i]!, open, high, low, close, volume: bar.volume };
    }));
  }
  const symbols = Object.keys(aliases).filter((a) => fictional.has(a));
  symbols.sort((a, b) => (a === BENCHMARK_ALIAS ? -1 : b === BENCHMARK_ALIAS ? 1 : a.localeCompare(b)));
  const sectors = new Map<string, string | undefined>([[BENCHMARK_ALIAS, BROAD_MARKET_SECTOR]]);
  for (const etf of SECTOR_ETFS) if (fictional.has(etf.alias)) sectors.set(etf.alias, etf.sector);
  for (const [alias, real] of Object.entries(aliases)) {
    if (alias === BENCHMARK_ALIAS || sectors.has(alias)) continue;
    if (fictional.has(alias)) sectors.set(alias, spec.sectors?.get(real));
  }
  return assemble(symbols, aliases, sectors,
    { firstDay: fictionalDates[WARMUP_SESSIONS]! }, dropped, fictionalDates.slice(WARMUP_SESSIONS), fictionalDates, sourceDates, fictional, "bootstrap");
}

/** Build the in-memory fictional market for a blind or bootstrap run. Deterministic in seed. */
export async function buildScenarioMarket(spec: ScenarioMarketSpec): Promise<ScenarioMarket> {
  const rng = createRng(spec.seed);
  return spec.mode === "blind" ? buildBlind(spec, rng) : buildBootstrap(spec, rng);
}
