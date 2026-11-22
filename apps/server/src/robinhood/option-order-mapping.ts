import { createHash } from "node:crypto";
import { LongOptionTicketSchema } from "@rh/shared";
import { BrokerMappingError, record } from "./mapping.ts";

export const optionContractMultiplier = 100;

/** Called with the persisted local order ID, not the ticker or same-shaped ticket. */
export function optionOrderReference(localOrderId: string): string {
  if (localOrderId.trim() === "" || localOrderId !== localOrderId.trim()) {
    throw new BrokerMappingError("A durable local order ID is required for options execution.");
  }
  return createHash("sha256").update(`longbow:option:v1:${localOrderId}`).digest("hex");
}

export function optionOrderRequest(input: unknown, accountId: string) {
  const parsed = LongOptionTicketSchema.safeParse(input);
  if (!parsed.success) {
    throw new BrokerMappingError("Use a single exact option contract and a positive whole-contract quantity and limit.");
  }
  if (accountId.trim() === "") throw new BrokerMappingError("MCP trading account has not been identified");
  const ticket = parsed.data;
  const buy = ticket.side === "buy-to-open";
  return {
    ticket,
    limitNotionalCents: ticket.limitCents * optionContractMultiplier * ticket.contracts,
    review: {
      account_number: accountId,
      legs: [{ option_id: ticket.instrumentId, side: buy ? "buy" : "sell", position_effect: buy ? "open" : "close", ratio_quantity: 1 }],
      type: "limit", quantity: String(ticket.contracts), price: (ticket.limitCents / 100).toFixed(2),
      time_in_force: "gfd", market_hours: "regular_hours",
    },
  } as const;
}

/** No live send here. Bind the exact reviewed request to the persist-before-send ID. */
export function optionPlacementRequest(prepared: ReturnType<typeof optionOrderRequest>, localOrderId: string) {
  return { ...prepared.review, ref_id: optionOrderReference(localOrderId) };
}

/**
 * A returned order may have an approval-derived reference, different from our
 * submitted idempotency key. Only an explicitly identified broker order is a
 * placement acknowledgment. The caller must retain an uncertain attempt.
 */
export function optionPlacementAcknowledgment(response: unknown): { brokerOrderId: string } | undefined {
  const payload = record(response);
  if (payload.customer_approval_required !== false || payload.order == null) return undefined;
  const order = record(payload.order);
  const id = order.order_id ?? order.id;
  if (typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return undefined;
  if (order.order_id !== undefined && order.id !== undefined && order.order_id !== order.id) return undefined;
  return { brokerOrderId: id };
}
