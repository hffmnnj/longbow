import { describe, expect, it } from "vitest";
import { fixtureOrder } from "./mock/fixtures.ts";
import { expectedValuePct, failedChecks, notional, ruleName } from "./orders.ts";

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
