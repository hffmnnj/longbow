import type { ClosedTrade } from "@rh/shared";
import type { Broker, Logger, Store } from "../ports.ts";
import { pairHarnessTrades } from "./compute.ts";

/**
 * Closed trades for aggregate metrics, oldest first. Robinhood's realized
 * history can already include harness fills, but has no shared execution IDs
 * or coverage bounds. Prefer the account history as one source rather than
 * guessing which local FIFO closes to add or merge. The harness is a fallback
 * when broker history is empty or unavailable.
 */
export async function readAllClosedTrades(deps: { store: Store; broker: Broker; log: Logger }): Promise<ClosedTrade[]> {
  if (deps.broker.status().state === "connected" && typeof deps.broker.tradeHistory === "function") {
    try {
      const history = await deps.broker.tradeHistory();
      if (history.length > 0) {
        return history.map((t) => ({
          symbol: t.symbol,
          closedAt: t.closedAt,
          quantity: t.quantity,
          exitPrice: t.exitPrice,
          pnl: t.pnl,
          source: "robinhood" as const,
        })).sort((a, b) => a.closedAt - b.closedAt);
      }
    } catch (error) {
      deps.log.warn("robinhood trade history unavailable", { error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return pairHarnessTrades(deps.store.ordersSince(0));
}
