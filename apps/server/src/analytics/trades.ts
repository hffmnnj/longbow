import type { ClosedTrade } from "@rh/shared";
import type { Broker, Logger, Store } from "../ports.ts";
import { pairHarnessTrades } from "./compute.ts";

/**
 * Every closed trade, oldest first: harness round trips paired from filled
 * orders plus the broker's own trade history when it is connected. A failing
 * broker still yields the full harness picture. Shared by the dashboard
 * performance summary and the report facts builder.
 */
export async function readAllClosedTrades(deps: { store: Store; broker: Broker; log: Logger }): Promise<ClosedTrade[]> {
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
  return [...harness, ...robinhood].sort((a, b) => a.closedAt - b.closedAt);
}
