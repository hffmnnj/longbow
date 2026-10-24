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
  failed: "Failed",
};

/** "max_position" becomes "Max position". */
export function ruleName(rule: string): string {
  const s = rule.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
