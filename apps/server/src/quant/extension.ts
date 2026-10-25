import { defineExtension, type Extension } from "@earendil-works/pi-durable";
import type { AccountSnapshot, RiskConfig } from "@rh/shared";
import type { Clock, Logger, MarketData } from "../ports.ts";

/**
 * Quant tool suite shared by the live agent and simulations: market_screen, quant_backtest, portfolio_risk and
 * size_position. Every read goes through `market`, so a simulation's point-in-time or scenario market keeps the
 * tools free of look-ahead and of real-world names in blind runs.
 */
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

export function createQuantExtension(_deps: QuantDeps): Extension {
  return defineExtension({ name: "quant", tools: [] });
}
