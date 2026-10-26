import type { Bar, HistoryRange, PriceHistory } from "@rh/shared";
import { isCryptoSymbol } from "@rh/shared";
import type { Clock, Logger, MarketData } from "../ports.ts";
import { etDate, isRegularSession, MarketCache, TTL } from "./cache.ts";
import {
  fetchEarningsDate,
  fetchNasdaqHistory,
  findUpcomingEarnings,
  type NasdaqAsset,
} from "./sources/nasdaq.ts";
import { fetchCoinbaseHistory } from "./sources/coinbase.ts";
import { avgDollarVolume } from "./indicators.ts";

/**
 * Simulator entry point for price paths: `MarketStore.barsBetween(symbol,
 * from, to)` returns daily bars with `from <= date <= to` (oldest first) for
 * the replay window and the benchmark leg. Everything else point-in-time
 * (truncated histories, indicators, earnings, SEC filings) goes through
 * `createMarketExtension({ ..., asOf })` or `createPointInTimeMarketData`,
 * which enforce the as-of cutoff instead of trusting the caller.
 */

/** Calendar months of history per range. */
const RANGE_MONTHS: Record<HistoryRange, number> = {
  "1m": 1,
  "3m": 3,
  "6m": 6,
  "1y": 12,
  "2y": 24,
  "5y": 60,
};

/** Trading sessions counted back from the cutoff per range (for count-back slicing). */
const RANGE_SESSIONS: Record<HistoryRange, number> = {
  "1m": 21,
  "3m": 63,
  "6m": 126,
  "1y": 252,
  "2y": 504,
  "5y": Number.MAX_SAFE_INTEGER,
};

/**
 * Calendar days counted back from the cutoff per range for crypto pairs,
 * which trade every day (about 365 bars per year, 30 per month).
 */
const RANGE_CALENDAR_DAYS: Record<HistoryRange, number> = {
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
  "2y": 730,
  "5y": Number.MAX_SAFE_INTEGER,
};

export interface MarketDataDeps {
  dataDir: string;
  log: Logger;
  clock: Clock;
  /** ET date YYYY-MM-DD the simulation has reached; absent for the live harness. */
  asOf?: () => string | undefined;
  /** Overridable fetch for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface ExtendedHistory {
  /** Bars inside the requested range window (oldest first). */
  window: Bar[];
  /** Window plus ~9 extra months of lookback for indicator warmup. */
  full: Bar[];
}

function shiftMonths(today: string, months: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1));
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

const etWallFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Offset of America/New_York from UTC in milliseconds at the given instant. */
function etOffsetMs(utcMs: number): number {
  const parts = Object.fromEntries(etWallFmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"]),
    Number(parts["minute"]),
    Number(parts["second"]),
  );
  return asUtc - utcMs;
}

/**
 * Epoch ms of 23:59:59.999 ET on the given ET date. Used as the `asOf`
 * timestamp of point-in-time histories so nothing served can sort after the
 * simulated date.
 */
export function endOfEtDateMs(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m === null) throw new Error(`invalid ET date: ${date}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const nextMidnightUtc = Date.UTC(year, month - 1, day) + 86_400_000;
  // Midday UTC falls on the same ET date and shares the end-of-day offset
  // (ET transitions happen at 02:00, never between midday and midnight).
  const offset = etOffsetMs(Date.UTC(year, month - 1, day, 16));
  return nextMidnightUtc - offset - 1;
}

/**
 * Shared market-data core: implements the `MarketData` port and exposes
 * `extended()` (range window plus warmup lookback) for the market tools.
 * When `deps.asOf` is set, every read is cut off at that ET date: history
 * windows count back from it (fetching the window ending today, since Nasdaq
 * only serves windows ending near today, then slicing), and earnings search
 * forward from it.
 */
export class MarketStore {
  readonly cache: MarketCache;
  private readonly deps: MarketDataDeps;
  private readonly assetMemory = new Map<string, NasdaqAsset>();

  constructor(deps: MarketDataDeps) {
    this.deps = deps;
    this.cache = new MarketCache(deps.dataDir, deps.log, deps.clock, deps.fetchImpl);
  }

  /** Simulated ET date, or today when running live. */
  private cutoff(): string {
    return this.deps.asOf?.() ?? etDate(this.deps.clock.now());
  }

  private async historyWithFallback(symbol: string, from: string, to: string, ttlMs: number): Promise<Bar[]> {
    if (isCryptoSymbol(symbol)) {
      return fetchCoinbaseHistory(this.cache, symbol, from, to, ttlMs);
    }
    const preferred = this.assetMemory.get(symbol);
    const order: NasdaqAsset[] = preferred === "etf" ? ["etf", "stocks"] : ["stocks", "etf"];
    let last: Bar[] = [];
    for (const asset of order) {
      const bars = await fetchNasdaqHistory(this.cache, symbol, asset, from, to, ttlMs);
      if (bars.length > 0) {
        this.assetMemory.set(symbol, asset);
        return bars;
      }
      last = bars;
    }
    return last;
  }

  async extended(symbol: string, range: HistoryRange): Promise<ExtendedHistory> {
    const today = etDate(this.deps.clock.now());
    const cutoff = this.cutoff();
    const ttlMs = isRegularSession(this.deps.clock.now()) ? TTL.historyOpenMs : TTL.historyClosedMs;
    // Nasdaq only serves windows ending near today, so always fetch through
    // today and slice at the cutoff: a 1y window at an as-of two years ago
    // still returns about 250 bars.
    const full = (await this.historyWithFallback(symbol, shiftMonths(cutoff, RANGE_MONTHS[range] + 9), today, ttlMs)).filter(
      (b) => b.date <= cutoff,
    );
    const windowCut = shiftMonths(cutoff, RANGE_MONTHS[range]);
    return { window: full.filter((b) => b.date >= windowCut), full };
  }

  async history(symbol: string, range: HistoryRange): Promise<PriceHistory> {
    const { window } = await this.extended(symbol, range);
    const cutoff = this.deps.asOf?.();
    return {
      symbol,
      bars: window,
      source: isCryptoSymbol(symbol) ? "coinbase" : "nasdaq",
      asOf: cutoff === undefined ? this.deps.clock.now() : endOfEtDateMs(cutoff),
    };
  }

  /**
   * Daily bars with `from <= date <= to` (oldest first) for an explicit
   * replay window and its benchmark. The window is honored literally and is
   * NOT cut at asOf: the caller controls the range, so this is the primitive
   * for building the simulation price path.
   */
  async barsBetween(symbol: string, from: string, to: string): Promise<Bar[]> {
    if (from > to) return [];
    const ttlMs = isRegularSession(this.deps.clock.now()) ? TTL.historyOpenMs : TTL.historyClosedMs;
    const bars = await this.historyWithFallback(symbol, from, to, ttlMs);
    return bars.filter((b) => b.date >= from && b.date <= to);
  }

  async nextEarnings(symbol: string): Promise<string | undefined> {
    const anchor = this.cutoff();
    const horizon = new Date(`${anchor}T12:00:00Z`).getTime() + 30 * 86_400_000;
    try {
      const single = await fetchEarningsDate(this.cache, symbol);
      if (single !== undefined && single.date > anchor) {
        return new Date(`${single.date}T12:00:00Z`).getTime() <= horizon ? single.date : undefined;
      }
    } catch {
      // Fall through to the calendar scan.
    }
    try {
      return (await findUpcomingEarnings(this.cache, symbol, anchor))?.date;
    } catch {
      return undefined;
    }
  }

  async avgDollarVolume(symbol: string, days: number): Promise<number | undefined> {
    const { full } = await this.extended(symbol, "1y");
    return avgDollarVolume(full, days);
  }
}

export function createMarketData(deps: MarketDataDeps): MarketData {
  const store = new MarketStore(deps);
  return {
    history: (symbol, range) => store.history(symbol, range),
    nextEarnings: (symbol) => store.nextEarnings(symbol),
    avgDollarVolume: (symbol, days) => store.avgDollarVolume(symbol, days),
  };
}

/**
 * Point-in-time view over any `MarketData` implementation for a simulated
 * ET date: `history` counts the range back from asOf over a longer (5y)
 * underlying fetch and drops every bar after asOf; `avgDollarVolume` uses
 * the last `days` bars on or before asOf; `nextEarnings` delegates to the
 * base, so pass an as-of-aware base (e.g. a `MarketStore` built with `asOf`,
 * or the `market_earnings` tool) for historical replay.
 */
export function createPointInTimeMarketData(base: MarketData, asOf: () => string): MarketData {
  return {
    history: async (symbol, range) => {
      const cutoff = asOf();
      const underlying = await base.history(symbol, "5y");
      const bars = underlying.bars.filter((b) => b.date <= cutoff);
      const want = isCryptoSymbol(symbol) ? RANGE_CALENDAR_DAYS[range] : RANGE_SESSIONS[range];
      const window = bars.length > want ? bars.slice(bars.length - want) : bars;
      return { symbol, bars: window, source: underlying.source, asOf: endOfEtDateMs(cutoff) };
    },
    nextEarnings: (symbol) => base.nextEarnings(symbol),
    avgDollarVolume: async (symbol, days) => {
      const cutoff = asOf();
      const underlying = await base.history(symbol, "5y");
      return avgDollarVolume(
        underlying.bars.filter((b) => b.date <= cutoff),
        days,
      );
    },
  };
}

/** Today's ET calendar date plus the daily-history TTL for this moment. */
export function historyTtl(clock: Clock): number {
  return isRegularSession(clock.now()) ? TTL.historyOpenMs : TTL.historyClosedMs;
}
