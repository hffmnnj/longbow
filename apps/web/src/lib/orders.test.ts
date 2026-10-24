import { describe, expect, it } from "vitest";
import type { OrderStatus } from "@rh/shared";
import { fixtureOrder } from "./mock/fixtures.ts";
import {
  STATUS_LABEL,
  expectedValuePct,
  failedChecks,
  isDoneOrderStatus,
  isOpenOrderStatus,
  notional,
  ruleName,
} from "./orders.ts";

describe("order helpers", () => {
  const order = fixtureOrder("o", "pending_approval");
  it("computes notional from quantity and limit", () => {
    expect(notional(order.intent)).toBeCloseTo(1239.6, 6);
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
