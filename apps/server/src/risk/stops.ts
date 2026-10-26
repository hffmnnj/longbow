import { isCryptoSymbol, type OrderIntent, type OrderRecord } from "@rh/shared";
import type { Broker, Clock, EventBus, Logger, MarketCalendar, Store } from "../ports.ts";
import type { RobinhoodBroker } from "../robinhood/broker.ts";
import { orderRef } from "../robinhood/mapping.ts";

export type TradingBroker = Broker & Pick<RobinhoodBroker, "quotes" | "cancelOrder" | "orderState" | "executeStop">;
export function supportsTrading(broker: Broker): broker is TradingBroker {
  return ["quotes", "cancelOrder", "orderState", "executeStop"].every((key) => key in broker && typeof Reflect.get(broker, key) === "function");
}
export function isHeldStop(intent: OrderIntent): boolean {
  // Crypto stops rest natively at Robinhood; only fractional shares need the harness to watch them.
  return intent.side === "sell" && intent.orderType === "stop_limit" && !Number.isInteger(intent.quantity) && !isCryptoSymbol(intent.symbol);
}
export interface StopDeps { broker: TradingBroker; store: Store; clock: Clock; calendar: MarketCalendar; bus: EventBus; log?: Logger }
export function orderChanged(deps: Pick<StopDeps, "store" | "clock" | "bus">, order: OrderRecord): void {
  deps.bus.publish({ type: "order", order });
  const entry = deps.store.addJournal({ at: deps.clock.now(), action: order.intent.side, symbol: order.intent.symbol,
    summary: `${order.intent.symbol} order ${order.status}`, rationale: order.error ?? `Order ${order.id}: ${order.intent.quantity} ${isCryptoSymbol(order.intent.symbol) ? order.intent.symbol.split("-")[0] : "shares"}`,
    evidence: order.intent.evidence, orderId: order.id, ...(order.cycleId ? { cycleId: order.cycleId } : {}) });
  deps.bus.publish({ type: "journal", entry });
}
export async function syncOrders(deps: StopDeps): Promise<void> {
  for (const order of deps.store.ordersSince(0).filter((o) => o.brokerOrderId && ["submitted", "partially_filled", "triggering"].includes(o.status))) {
    try {
      const patch = await deps.broker.orderState(order.brokerOrderId!, order.intent.symbol);
      if (patch.status !== order.status || patch.filledQuantity !== order.filledQuantity || patch.averageFillPrice !== order.averageFillPrice) {
        orderChanged(deps, deps.store.updateOrder(order.id, { ...patch, updatedAt: deps.clock.now() }));
      }
    } catch { deps.log?.warn("order reconciliation failed", { orderId: order.id }); }
  }
}
export async function cancelOrder(deps: StopDeps, id: string): Promise<OrderRecord> {
  const order = deps.store.getOrder(id);
  if (!order) throw new Error(`unknown order ${id}`);
  if (order.status === "held") {
    const cancelled = deps.store.updateOrder(id, { status: "cancelled", updatedAt: deps.clock.now() });
    orderChanged(deps, cancelled);
    return cancelled;
  }
  if (!order.brokerOrderId || !["submitted", "partially_filled"].includes(order.status)) throw new Error(`order ${id} is not cancellable`);
  await deps.broker.cancelOrder(order.brokerOrderId, order.intent.symbol);
  // A cancellation request can race a fill: only the broker can confirm the final state.
  const updated = deps.store.updateOrder(id, { ...await deps.broker.orderState(order.brokerOrderId, order.intent.symbol), updatedAt: deps.clock.now() });
  orderChanged(deps, updated);
  return updated;
}
/** Native crypto stop orders resting at Robinhood for a symbol. They lock the coins until cancelled. */
export function restingCryptoStops(store: Store, symbol: string): OrderRecord[] {
  return store.ordersSince(0).filter((o) => o.intent.symbol === symbol && o.intent.side === "sell" && o.intent.orderType === "stop_limit" && ["submitted", "partially_filled"].includes(o.status));
}
export async function watchStops(deps: StopDeps): Promise<void> {
  await syncOrders(deps);
  const settings = deps.store.getSettings();
  if (!deps.calendar.clock(deps.clock.now()).isOpen || settings.killSwitch || settings.mode === "off") return;
  const held = deps.store.ordersSince(0).filter((order) => order.status === "held");
  if (!held.length) return;
  const quotes = await deps.broker.quotes([...new Set(held.map((o) => o.intent.symbol))]);
  for (const candidate of held) {
    const order = deps.store.getOrder(candidate.id);
    // This persisted guard also protects restart/re-entry after an uncertain broker response.
    if (!order || order.status !== "held") continue;
    const quote = quotes.find((q) => q.symbol === order.intent.symbol);
    if (!quote || order.intent.stopPrice === undefined || quote.last > order.intent.stopPrice) continue;
    const claimed = deps.store.updateOrder(order.id, { status: "triggering", updatedAt: deps.clock.now() });
    orderChanged(deps, claimed);
    try {
      const snapshot = await deps.broker.snapshot();
      const position = snapshot.positions.find((p) => p.symbol === order.intent.symbol);
      const reserved = deps.store.ordersSince(0).filter((o) => o.id !== order.id && o.intent.symbol === order.intent.symbol && o.intent.side === "sell" && ["submitted", "partially_filled", "triggering"].includes(o.status)).reduce((sum, o) => sum + Math.max(0, o.intent.quantity - (o.filledQuantity ?? 0)), 0);
      const available = Math.max(0, Math.min(position?.quantity ?? 0, position?.sharesAvailableForSells ?? 0) - reserved);
      const quantity = Math.floor(Math.min(order.intent.quantity, available) * 1e6) / 1e6;
      if (quantity <= 0) throw new Error("No unreserved shares available for protective stop sale");
      const currentSettings = deps.store.getSettings();
      if (currentSettings.killSwitch || currentSettings.mode === "off" || !deps.calendar.clock(deps.clock.now()).isOpen) throw new Error("Protective stop execution blocked by kill switch, mode off, or market close");
      const intent = { ...order.intent, quantity };
      const placed = await deps.broker.executeStop(intent, orderRef(intent, `held-stop:${order.id}:`));
      const submitted = deps.store.updateOrder(order.id, { status: "submitted", intent, brokerOrderId: placed.brokerOrderId, updatedAt: deps.clock.now() });
      orderChanged(deps, submitted);
    } catch (error) {
      orderChanged(deps, deps.store.updateOrder(order.id, { status: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "Protective stop failed; reconcile before retrying", updatedAt: deps.clock.now() }));
    }
  }
  await syncOrders(deps);
}
