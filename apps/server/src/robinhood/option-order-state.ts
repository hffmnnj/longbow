import { type OrderRecord } from "@rh/shared";
import { BrokerMappingError, record } from "./mapping.ts";
import { optionBrokerId } from "./option-order-mapping.ts";

type State = Pick<OrderRecord, "brokerOrderId" | "status" | "filledQuantity" | "averageFillPrice">;

function positiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value))) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function optionOrderRows(data: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(data.orders)) throw new BrokerMappingError("Robinhood returned no options orders array");
  return data.orders.map(record);
}

/**
 * Bind updates to a broker order ID or to the broker-issued approval ID.
 * The client's submitted idempotency key is not returned on the placed order.
 * Matching price/time/contract isn't proof of ownership. No match, including
 * a complete empty list, is not proof that an uncertain send was rejected.
 */
export function reconcileOptionOrder(order: OrderRecord, accountId: string, rows: Record<string, unknown>[], approvalId?: string): State | undefined {
  const t = order.intent.longOption;
  if (!t) throw new BrokerMappingError("Options reconciliation requires a contract ticket");
  const found = rows.filter((row) => order.brokerOrderId !== undefined
    ? (row.id ?? row.order_id) === order.brokerOrderId
    : approvalId !== undefined && row.ref_id === approvalId);
  if (found.length === 0) return undefined;
  if (found.length !== 1) throw new BrokerMappingError("Robinhood options order identity was ambiguous");
  const row = found[0]!;
  const id = row.id ?? row.order_id;
  const mismatch = () => new BrokerMappingError("Robinhood options order did not match the approved contract and terms");
  if (typeof id !== "string" || !optionBrokerId.test(id) ||
      row.id !== undefined && row.order_id !== undefined && row.id !== row.order_id ||
      row.account_number !== undefined && row.account_number !== accountId ||
      !Array.isArray(row.legs) || row.legs.length !== 1 ||
      positiveNumber(row.quantity) !== t.contracts || positiveNumber(row.price) !== t.limitCents / 100) throw mismatch();
  const leg = record(row.legs[0]);
  const buy = t.side === "buy-to-open";
  if (leg.option_id !== t.instrumentId || leg.side !== (buy ? "buy" : "sell") ||
      leg.position_effect !== (buy ? "open" : "close") || positiveNumber(leg.ratio_quantity) !== 1) throw mismatch();

  const filled = positiveNumber(row.processed_quantity ?? row.cumulative_quantity);
  if (filled === undefined || !Number.isInteger(filled) || filled > t.contracts) throw mismatch();
  let status: State["status"];
  switch (row.state) {
    case "queued":
    case "unconfirmed":
    case "confirmed":
    case "pending_cancelled": status = filled > 0 ? "partially_filled" : "submitted"; break;
    case "partially_filled": status = "partially_filled"; break;
    case "filled": status = "filled"; break;
    case "cancelled":
    case "voided": status = "cancelled"; break;
    case "rejected":
    case "failed": status = "failed"; break;
    default: throw new BrokerMappingError("Unrecognized Robinhood options order state");
  }
  if (status === "filled" && filled !== t.contracts ||
      status === "partially_filled" && (filled === 0 || filled === t.contracts)) throw mismatch();
  const averageFillPrice = positiveNumber(row.average_price ?? row.average_fill_price);
  if (filled > 0 && (averageFillPrice === undefined || averageFillPrice <= 0)) throw mismatch();
  return { brokerOrderId: id, status, filledQuantity: filled, ...(filled > 0 ? { averageFillPrice } : {}) };
}

export function terminalOptionApproval(data: Record<string, unknown>, accountId: string, approvalId: string) {
  if (!Array.isArray(data.approvals)) throw new BrokerMappingError("Robinhood returned no trade approvals array");
  const matches = data.approvals.map(record).filter((row) => (row.approval_id ?? row.id) === approvalId);
  if (matches.length === 0) return undefined;
  if (matches.length !== 1) throw new BrokerMappingError("Robinhood options approval identity was ambiguous");
  const row = matches[0]!;
  if ((row.account_number !== undefined && row.account_number !== accountId) ||
      (row.id !== undefined && row.approval_id !== undefined && row.id !== row.approval_id) ||
      (row.state !== undefined && row.status !== undefined && row.state !== row.status) ||
      (row.asset_class !== undefined && row.asset_class !== "option")) {
    throw new BrokerMappingError("Robinhood options approval did not match the saved receipt");
  }
  const state = row.state ?? row.status;
  return state === "declined" || state === "expired" ? state : undefined;
}
