import type { Bar, HistoryRange, PriceHistory } from "@rh/shared";
import type { Clock, Logger, MarketData } from "../ports.ts";
import { etDate, isRegularSession, MarketCache, TTL } from "./cache.ts";
import {
  fetchEarningsDate,
  fetchNasdaqHistory,
  findUpcomingEarnings,
  type NasdaqAsset,
} from "./sources/nasdaq.ts";
import { avgDollarVolume } from "./indicators.ts";

/** Calendar months of history per range. */
const RANGE_MONTHS: Record<HistoryRange, number> = {
  "1m": 1,
  "3m": 3,
  "6m": 6,
  "1y": 12,
  "2y": 24,
  "5y": 60,
};

export interface MarketDataDeps {
  dataDir: string;
  log: Logger;
  clock: Clock;
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

/**
 * Shared market-data core: implements the `MarketData` port and exposes
 * `extended()` (range window plus warmup lookback) for the market tools.
 */
export class MarketStore {
  readonly cache: MarketCache;
  private readonly deps: MarketDataDeps;
  private readonly assetMemory = new Map<string, NasdaqAsset>();

  constructor(deps: MarketDataDeps) {
    this.deps = deps;
    this.cache = new MarketCache(deps.dataDir, deps.log, deps.clock);
  }

  private async historyWithFallback(symbol: string, from: string, to: string, ttlMs: number): Promise<Bar[]> {
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
    const ttlMs = isRegularSession(this.deps.clock.now()) ? TTL.historyOpenMs : TTL.historyClosedMs;
    const full = await this.historyWithFallback(symbol, shiftMonths(today, RANGE_MONTHS[range] + 9), today, ttlMs);
    const cutoff = shiftMonths(today, RANGE_MONTHS[range]);
    return { window: full.filter((b) => b.date >= cutoff), full };
  }

  async history(symbol: string, range: HistoryRange): Promise<PriceHistory> {
    const { window } = await this.extended(symbol, range);
    return { symbol, bars: window, source: "nasdaq", asOf: this.deps.clock.now() };
  }

  async nextEarnings(symbol: string): Promise<string | undefined> {
    const today = etDate(this.deps.clock.now());
    const horizon = new Date(`${today}T12:00:00Z`).getTime() + 30 * 86_400_000;
    try {
      const single = await fetchEarningsDate(this.cache, symbol);
      if (single !== undefined && single.date > today) {
        return new Date(`${single.date}T12:00:00Z`).getTime() <= horizon ? single.date : undefined;
      }
    } catch {
      // Fall through to the calendar scan.
    }
    try {
      return (await findUpcomingEarnings(this.cache, symbol, today))?.date;
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

/** Today's ET calendar date plus the daily-history TTL for this moment. */
export function historyTtl(clock: Clock): number {
  return isRegularSession(clock.now()) ? TTL.historyOpenMs : TTL.historyClosedMs;
}
