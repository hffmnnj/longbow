import { isCryptoSymbol, type LongOptionTicket, type OrderIntent, type OrderRecord, type OrderStatus, type RiskCheck } from "@rh/shared";

const OPTION_SYMBOL_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d\d-\d\d$/;

function isRealDate(iso: string): boolean {
  if (!DATE_RE.test(iso)) return false;
  const at = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(at)) return false;
  return new Date(at).toISOString().slice(0, 10) === iso;
}

const isWhole = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);

/** Any presence of longOption routes to the option ticket UI, never the stock ticket. */
export function isOptionIntent(i: OrderIntent): boolean {
  return i.longOption != null;
}

/** Shape check for the shared LongOptionTicket: standard 100-share long contracts only. */
export function isValidLongOptionTicket(t: unknown): t is LongOptionTicket {
  if (typeof t !== "object" || t === null) return false;
  const v = t as Record<string, unknown>;
  return (
    typeof v.instrumentId === "string" &&
    UUID_RE.test(v.instrumentId) &&
    typeof v.symbol === "string" &&
    OPTION_SYMBOL_RE.test(v.symbol) &&
    typeof v.expiration === "string" &&
    isRealDate(v.expiration) &&
    isWhole(v.strikeCents) &&
    (v.strikeCents as number) >= 1 &&
    (v.strikeCents as number) <= 10_000_000 &&
    (v.contractType === "call" || v.contractType === "put") &&
    (v.side === "buy-to-open" || v.side === "sell-to-close") &&
    isWhole(v.contracts) &&
    (v.contracts as number) >= 1 &&
    (v.contracts as number) <= 100 &&
    isWhole(v.limitCents) &&
    (v.limitCents as number) >= 1 &&
    (v.limitCents as number) <= 1_000_000
  );
}

/**
 * Why an option intent cannot be approved as written. Undefined when the
 * ticket and the order agree; a short human reason when they do not. Any
 * defined value must block approval and never fall back to a stock ticket.
 */
export function optionProblem(i: OrderIntent): string | undefined {
  const t = i.longOption;
  if (t == null) return undefined;
  if (!isValidLongOptionTicket(t)) return "Contract details are incomplete or malformed.";
  if (t.symbol !== i.symbol) return "Contract symbol does not match the order.";
  const expectedSide = t.side === "buy-to-open" ? "buy" : "sell";
  if (i.side !== expectedSide) return "Order side does not match buy to open or sell to close.";
  if (!Number.isInteger(i.quantity) || i.quantity !== t.contracts) return "Contracts must equal the order quantity in whole contracts.";
  if (!Number.isFinite(i.limitPrice) || Math.round(i.limitPrice * 100) !== t.limitCents) {
    return "Per-share limit must match the contract limit.";
  }
  if (i.orderType !== "limit" || i.timeInForce !== "day" || i.stopPrice != null) {
    return "Options use a whole-contract day limit with no stop.";
  }
  return undefined;
}

/** True only when the ticket is well formed and agrees with the order. */
export function isValidOptionIntent(i: OrderIntent): boolean {
  return i.longOption != null && optionProblem(i) === undefined;
}

/** "Buy to open" or "Sell to close" for a valid ticket. */
export function optionSideLabel(t: Pick<LongOptionTicket, "side">): string {
  return t.side === "buy-to-open" ? "Buy to open" : "Sell to close";
}

/** "Call" or "Put". */
export function optionTypeLabel(t: Pick<LongOptionTicket, "contractType">): string {
  return t.contractType === "call" ? "Call" : "Put";
}

/** Per-share limit in dollars: limitCents is cents per share. */
export function optionLimitPerShare(t: Pick<LongOptionTicket, "limitCents">): number {
  return t.limitCents / 100;
}

/** Strike in dollars: strikeCents is cents per share. */
export function optionStrike(t: Pick<LongOptionTicket, "strikeCents">): number {
  return t.strikeCents / 100;
}

/**
 * Total debit (buy to open) or proceeds (sell to close) at the limit, before
 * fees, in dollars. One contract is 100 shares, so the per-share cents times
 * 100 shares is limitCents dollars per contract: 2 contracts at $1.75 shows
 * $350, never $3.50.
 */
export function optionTotal(t: Pick<LongOptionTicket, "contracts" | "limitCents">): number {
  return t.contracts * t.limitCents;
}

/** Filled total for option contracts: whole contracts times 100 shares at the per-share fill price. */
export function optionFilledTotal(contracts: number, perSharePrice: number): number {
  return contracts * perSharePrice * 100;
}

/** Status text that never calls an option submission a held stop. */
export function orderStatusLabel(o: OrderRecord): string {
  if (isOptionIntent(o.intent)) {
    if (o.status === "triggering") return "Submission uncertain";
    if (o.status === "held") return "Held";
  }
  return STATUS_LABEL[o.status];
}

/** Total at risk at the limit: full option premium for valid tickets, share notional otherwise. */
export const notional = (i: OrderIntent): number => {
  if (isValidOptionIntent(i) && i.longOption) return optionTotal(i.longOption);
  return i.quantity * i.limitPrice;
};

/** Fractional equity limit intents use the price only for a pre-placement quote check. Options never use a quote ceiling. */
export function fractionalQuoteLabel(i: OrderIntent): string | undefined {
  if (isOptionIntent(i)) return undefined;
  if (i.orderType !== "limit" || isCryptoSymbol(i.symbol) || Number.isInteger(i.quantity)) return undefined;
  return i.side === "buy" ? "Buy quote ceiling" : "Sell quote floor";
}

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
