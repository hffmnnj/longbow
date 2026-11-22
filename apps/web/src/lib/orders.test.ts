import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@rh/shared";
import { fixtureOrder } from "./mock/fixtures.ts";
import {
  STATUS_LABEL,
  expectedValuePct,
  failedChecks,
  fractionalQuoteLabel,
  isDoneOrderStatus,
  isOpenOrderStatus,
  isOptionIntent,
  isValidLongOptionTicket,
  isValidOptionIntent,
  notional,
  optionFilledTotal,
  optionLimitPerShare,
  optionProblem,
  optionSideLabel,
  optionStrike,
  optionTotal,
  optionTypeLabel,
  orderStatusLabel,
  ruleName,
} from "./orders.ts";

describe("order helpers", () => {
  const order = fixtureOrder("o", "pending_approval");
  it("computes notional from quantity and limit", () => {
    expect(notional(order.intent)).toBeCloseTo(1239.6, 6);
  });
  it("distinguishes fractional equity quote checks from actual limits and protective stops", () => {
    const fraction = { ...order.intent, quantity: 0.5 };
    expect(fractionalQuoteLabel(fraction)).toBe("Buy quote ceiling");
    expect(fractionalQuoteLabel({ ...fraction, side: "sell" })).toBe("Sell quote floor");
    expect(fractionalQuoteLabel(order.intent)).toBeUndefined();
    expect(fractionalQuoteLabel({ ...fraction, symbol: "BTC-USD" })).toBeUndefined();
    expect(fractionalQuoteLabel({ ...fraction, side: "sell", orderType: "stop_limit", stopPrice: 408 })).toBeUndefined();
  });
  it("computes EV after costs from win probability, gain, loss and cost", () => {
    // 0.58*4.2 - 0.42*1.5 - 0.08 = 1.726
    expect(expectedValuePct(order.intent)).toBeCloseTo(1.726, 6);
  });
  it("lists only failing checks", () => {
    expect(failedChecks(order)).toHaveLength(0);
    const bad = { ...order, verdict: { ...order.verdict, checks: [{ rule: "x", ok: false, detail: "d" }, ...order.verdict.checks] } };
    expect(failedChecks(bad).map((c) => c.rule)).toEqual(["x"]);
  });
  it("humanizes rule ids", () => {
    expect(ruleName("max_position")).toBe("Max position");
  });
});

describe("long option tickets", () => {
  const base = fixtureOrder("opt", "pending_approval").intent;
  const ticket = {
    instrumentId: "10000000-0000-0000-0000-000000000001",
    symbol: "AAPL",
    expiration: "2026-12-18",
    strikeCents: 15_000,
    contractType: "put" as const,
    side: "buy-to-open" as const,
    contracts: 2,
    limitCents: 175,
  };
  const option = { ...base, symbol: "AAPL", side: "buy" as const, quantity: 2, limitPrice: 1.75, orderType: "limit" as const, timeInForce: "day" as const, stopPrice: undefined, longOption: ticket };

  it("prices the full 100-share premium: 2 contracts at $1.75 is $350", () => {
    expect(isOptionIntent(option)).toBe(true);
    expect(isValidLongOptionTicket(ticket)).toBe(true);
    expect(isValidOptionIntent(option)).toBe(true);
    expect(optionProblem(option)).toBeUndefined();
    expect(optionLimitPerShare(ticket)).toBeCloseTo(1.75, 6);
    expect(optionStrike(ticket)).toBeCloseTo(150, 6);
    expect(optionSideLabel(ticket)).toBe("Buy to open");
    expect(optionTypeLabel(ticket)).toBe("Put");
    // The regression this guards: quantity * limitPrice is $3.50.
    expect(optionTotal(ticket)).toBe(350);
    expect(notional(option)).toBe(350);
    expect(optionFilledTotal(2, 1.75)).toBe(350);
    expect(fractionalQuoteLabel(option)).toBeUndefined();
  });

  it("routes any longOption presence to the option UI and blocks mismatched tickets", () => {
    const mismatched = { ...option, quantity: 1 };
    expect(isOptionIntent(mismatched)).toBe(true);
    expect(isValidOptionIntent(mismatched)).toBe(false);
    expect(optionProblem(mismatched)).toMatch(/Contracts must equal/);
    const malformed = { ...option, longOption: { ...ticket, limitCents: 0 } };
    expect(isOptionIntent(malformed)).toBe(true);
    expect(isValidOptionIntent(malformed)).toBe(false);
    expect(optionProblem(malformed)).toMatch(/incomplete or malformed/);
    // Stock math must not leak into the option path: the UI branches on
    // isOptionIntent first and disables approval when optionProblem is set.
    expect(isValidLongOptionTicket({ ...ticket, expiration: "2026-02-30" })).toBe(false);
    expect(isValidLongOptionTicket({ ...ticket, contractType: "stock" })).toBe(false);
  });

  it("never calls an option submission a held stop", () => {
    const triggering = { ...fixtureOrder("t", "triggering"), intent: option };
    const held = { ...fixtureOrder("h", "held"), intent: option };
    expect(orderStatusLabel(triggering)).toBe("Submission uncertain");
    expect(orderStatusLabel(held)).toBe("Held");
    const stockTriggering = fixtureOrder("s", "triggering");
    expect(orderStatusLabel(stockTriggering)).toBe("Stop firing");
  });
});

describe("order status labels", () => {
  it("labels every status, including the harness-held and terminal ones", () => {
    expect(STATUS_LABEL).toEqual({
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
    });
  });

  it("treats working orders as open and terminal ones as done", () => {
    const open: OrderStatus[] = ["pending_approval", "submitted", "held", "triggering", "partially_filled"];
    const done: OrderStatus[] = ["rejected_risk", "rejected_user", "expired", "filled", "cancelled", "failed"];
    expect([...open, ...done].sort()).toEqual(Object.keys(STATUS_LABEL).sort());
    for (const s of open) {
      expect(isOpenOrderStatus(s)).toBe(true);
      expect(isDoneOrderStatus(s)).toBe(false);
    }
    for (const s of done) {
      expect(isOpenOrderStatus(s)).toBe(false);
      expect(isDoneOrderStatus(s)).toBe(true);
    }
  });
});
