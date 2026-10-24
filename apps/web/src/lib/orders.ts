import type { OrderIntent, OrderRecord, OrderStatus, RiskCheck } from "@rh/shared";

export const notional = (i: OrderIntent): number => i.quantity * i.limitPrice;

/** Expected value in % of notional after estimated round-trip costs. */
export function expectedValuePct(i: OrderIntent): number {
  return i.probabilityWin * i.expectedGainPct - (1 - i.probabilityWin) * i.expectedLossPct - i.estimatedCostPct;
}

export function failedChecks(o: OrderRecord): RiskCheck[] {
  return o.verdict.checks.filter((c) => !c.ok);
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_approval: "Awaiting approval",
  rejected_risk: "Blocked by risk",
  rejected_user: "Rejected",
  expired: "Expired",
  submitted: "Submitted",
  held: "Stop held",
  triggering: "Stop firing",
  partially_filled: "Partly filled",
  filled: "Filled",
  cancelled: "Cancelled",
  failed: "Failed",
};

/** Orders still working or waiting on something (a human, the broker, the harness stop watcher). */
const OPEN_ORDER_STATUS: ReadonlySet<OrderStatus> = new Set([
  "pending_approval",
  "submitted",
  "held",
  "triggering",
  "partially_filled",
]);

/** Terminal states: the order will not move again without a brand-new order. */
const DONE_ORDER_STATUS: ReadonlySet<OrderStatus> = new Set([
  "rejected_risk",
  "rejected_user",
  "expired",
  "filled",
  "cancelled",
  "failed",
]);

/** True while the order is still working or waiting. */
export function isOpenOrderStatus(status: OrderStatus): boolean {
  return OPEN_ORDER_STATUS.has(status);
}

/** True once the order reached a terminal state. */
export function isDoneOrderStatus(status: OrderStatus): boolean {
  return DONE_ORDER_STATUS.has(status);
}

/** "max_position" becomes "Max position". */
export function ruleName(rule: string): string {
  const s = rule.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
