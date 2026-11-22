import assert from "node:assert/strict";
import { test } from "node:test";
import { optionOrderRequest, optionPlacementAcknowledgment, optionPlacementRequest } from "./option-order-mapping.ts";

const SPY_PUT = "10000000-0000-0000-0000-000000000001";
const BROKER_ORDER = "20000000-0000-0000-0000-000000000002";
const ticket = {
  instrumentId: SPY_PUT, symbol: "SPY", expiration: "2026-12-18", strikeCents: 65_000,
  contractType: "put", side: "buy-to-open", contracts: 2, limitCents: 175,
} as const;

test("the placement candidate matches the reviewed terms and has one deterministic reference per order", () => {
  const request = optionOrderRequest(ticket, "MCP-fixture");
  assert.equal(request.limitNotionalCents, 35_000);
  assert.deepEqual(request.review, {
    account_number: "MCP-fixture",
    legs: [{ option_id: SPY_PUT, side: "buy", position_effect: "open", ratio_quantity: 1 }],
    type: "limit", quantity: "2", price: "1.75", time_in_force: "gfd", market_hours: "regular_hours",
  });
  const { ref_id: refId, ...terms } = optionPlacementRequest(request, "local-1");
  assert.deepEqual(terms, request.review);
  assert.match(refId, /^[0-9a-f]{64}$/);
  assert.equal(optionPlacementRequest(optionOrderRequest(ticket, "MCP-fixture"), "local-1").ref_id, refId);
  assert.notEqual(optionPlacementRequest(request, "local-2").ref_id, refId);
  assert.throws(() => optionPlacementRequest(request, ""), /durable local order ID/);
});

test("the write candidate cannot encode a sell to open or mixed broker terms", () => {
  assert.deepEqual(optionOrderRequest({ ...ticket, side: "sell-to-close" }, "MCP-fixture").review.legs,
    [{ option_id: SPY_PUT, side: "sell", position_effect: "close", ratio_quantity: 1 }]);
  for (const invalid of [
    { ...ticket, side: "sell-to-open" },
    { ...ticket, contracts: 0.5 },
    { ...ticket, expiration: "2026-11-31" },
    { ...ticket, legs: [{ position_effect: "open", side: "sell" }] },
    { ...ticket, account_number: "wrong-account" },
  ]) {
    assert.throws(() => optionOrderRequest(invalid, "MCP-fixture"), /single exact option contract/);
  }
});

test("an approval or ambiguous broker reply is not treated as an order acknowledgment", () => {
  assert.deepEqual(optionPlacementAcknowledgment({
    customer_approval_required: false, order: { id: BROKER_ORDER, ref_id: "different-broker-reference" },
  }), { brokerOrderId: BROKER_ORDER });
  assert.deepEqual(optionPlacementAcknowledgment({
    customer_approval_required: true, approval_id: BROKER_ORDER,
  }), { approvalId: BROKER_ORDER });
  assert.deepEqual(optionPlacementAcknowledgment({
    customer_approval_required: false, approval_id: BROKER_ORDER,
  }), { approvalId: BROKER_ORDER });
  for (const ambiguous of [
    { customer_approval_required: true, order: { id: BROKER_ORDER } },
    { order: { id: BROKER_ORDER } },
    { customer_approval_required: false, order: { id: BROKER_ORDER, order_id: SPY_PUT } },
  ]) assert.equal(optionPlacementAcknowledgment(ambiguous), undefined);
});
