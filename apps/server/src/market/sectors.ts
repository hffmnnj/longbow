import type { Logger } from "../ports.ts";
import type { MarketCache } from "./cache.ts";
import { fetchCompanyInfo, fetchTickerMap } from "./sources/sec.ts";

/**
 * Sector names follow the eleven SPDR sector ETFs, so a position's sector can be compared
 * with the Markets view and with the risk engine's sector cap.
 */
export type Sector =
  | "Technology"
  | "Financials"
  | "Energy"
  | "Health Care"
  | "Consumer Discretionary"
  | "Consumer Staples"
  | "Industrials"
  | "Materials"
  | "Utilities"
  | "Real Estate"
  | "Communication Services"
  | "Broad Market";

/**
 * Where SIC and the sector ETFs disagree for widely held names (SIC files Alphabet and Meta
 * under computer services, the ETFs under communication), and for ETFs, which have no SIC.
 */
const OVERRIDES: Record<string, Sector> = {
  GOOGL: "Communication Services",
  GOOG: "Communication Services",
  META: "Communication Services",
  NFLX: "Communication Services",
  DIS: "Communication Services",
  AMZN: "Consumer Discretionary",
  TSLA: "Consumer Discretionary",
  V: "Financials",
  MA: "Financials",
  PYPL: "Financials",
  SPY: "Broad Market",
  VOO: "Broad Market",
  IVV: "Broad Market",
  VTI: "Broad Market",
  DIA: "Broad Market",
  IWM: "Broad Market",
  QQQ: "Technology",
  XLK: "Technology",
  SMH: "Technology",
  SOXX: "Technology",
  XLF: "Financials",
  XLE: "Energy",
  XLV: "Health Care",
  XLY: "Consumer Discretionary",
  XLP: "Consumer Staples",
  XLI: "Industrials",
  XLB: "Materials",
  XLU: "Utilities",
  XLRE: "Real Estate",
  XLC: "Communication Services",
};

/** Coarse SIC code to sector mapping; undefined when the code says nothing useful. */
export function sectorFromSic(sic: string): Sector | undefined {
  const code = Number.parseInt(sic, 10);
  if (!Number.isFinite(code)) return undefined;
  const between = (from: number, to: number) => code >= from && code <= to;
  if (between(2830, 2836) || between(3841, 3851) || between(8000, 8099) || code === 5122) return "Health Care";
  if (
    between(3570, 3579) ||
    between(3660, 3699) ||
    between(3820, 3829) ||
    between(7370, 7379) ||
    code === 3577 ||
    code === 3559
  ) {
    return "Technology";
  }
  if (between(4800, 4899) || between(2710, 2799) || between(7810, 7819)) return "Communication Services";
  if (between(4900, 4949) || code === 4991) return "Utilities";
  if (between(1300, 1399) || between(2900, 2999) || between(4610, 4619) || code === 5172) return "Energy";
  if (between(6798, 6798) || between(6500, 6553)) return "Real Estate";
  if (between(6000, 6799)) return "Financials";
  if (between(2000, 2199) || between(2840, 2844) || between(5140, 5149) || between(5400, 5499) || code === 5912) {
    return "Consumer Staples";
  }
  if (
    between(1000, 1099) ||
    between(1400, 1499) ||
    between(2600, 2699) ||
    between(2800, 2829) ||
    between(2850, 2899) ||
    between(3300, 3399)
  ) {
    return "Materials";
  }
  if (
    between(2300, 2399) ||
    between(3711, 3711) ||
    between(3714, 3716) ||
    between(5200, 5399) ||
    between(5500, 5999) ||
    between(7000, 7099) ||
    between(5940, 5949) ||
    between(5800, 5899) ||
    between(1520, 1549)
  ) {
    return "Consumer Discretionary";
  }
  if (
    between(3400, 3569) ||
    between(3580, 3659) ||
    between(3710, 3799) ||
    between(3812, 3812) ||
    between(4000, 4799) ||
    between(7380, 7389) ||
    between(8700, 8799) ||
    between(1600, 1799)
  ) {
    return "Industrials";
  }
  return undefined;
}

export interface SectorDirectory {
  /** The resolved sector, or undefined when unknown or not yet resolved. */
  get(symbol: string): string | undefined;
  /** Resolve symbols not seen yet; never throws, unknown symbols simply stay unknown. */
  resolve(symbols: readonly string[]): Promise<void>;
}

export function createSectorDirectory(deps: { cache: MarketCache; log: Logger }): SectorDirectory {
  const known = new Map<string, string | undefined>(Object.entries(OVERRIDES));
  return {
    get: (symbol) => known.get(symbol.toUpperCase()),
    async resolve(symbols) {
      const pending = [...new Set(symbols.map((s) => s.toUpperCase()))].filter((s) => !known.has(s));
      if (pending.length === 0) return;
      let tickers: Map<string, string>;
      try {
        tickers = await fetchTickerMap(deps.cache);
      } catch (error) {
        deps.log.warn("sector lookup unavailable", { error: error instanceof Error ? error.message : "unknown" });
        return;
      }
      for (const symbol of pending) {
        // SEC tickers use a dash for share classes (BRK-B); brokers often use a dot.
        const cik = tickers.get(symbol) ?? tickers.get(symbol.replace(".", "-"));
        if (cik === undefined) {
          known.set(symbol, undefined);
          continue;
        }
        try {
          known.set(symbol, sectorFromSic((await fetchCompanyInfo(deps.cache, cik)).sic));
        } catch {
          // Leave it unresolved so the next refresh retries.
        }
      }
    },
  };
}
