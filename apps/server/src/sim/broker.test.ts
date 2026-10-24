import { test } from "node:test";
import assert from "node:assert/strict";
import type { OrderIntent } from "@rh/shared";
import { createPaperBroker } from "./broker.ts";
import { createNyseCalendar } from "../risk/calendar.ts";
import { etInstant } from "./path.ts";

const intent: OrderIntent = { symbol: "SPY", side: "buy", quantity: 1, orderType: "limit", limitPrice: 101, timeInForce: "day", invalidationPrice: 90,
  timeStopDate: "2026-07-10", thesis: "A valid test thesis with enough detail.", probabilityWin: 0.6, expectedGainPct: 10, expectedLossPct: 5, estimatedCostPct: 0.1, evidence: ["test historical quote"] };
function fixture(cash = 1200) {
  let now = etInstant("2026-07-01", 9, 30);
  const broker = createPaperBroker({ startingCash: cash, clock: { now: () => now }, calendar: createNyseCalendar(),
    bars: async () => ["2026-06-30", "2026-07-01", "2026-07-02", "2026-07-06"].map((date) => ({ date, open: 100, low: 90, high: 120, close: 110, volume: 1000000 })) });
  return { broker, at: (date: string, hour: number, minute = 0) => { now = etInstant(date, hour, minute); } };
}
test("marketable buy executes at ask, not the higher limit", async () => {
  const { broker } = fixture();
  await broker.placeOrder(intent);
  assert.equal(broker.fills().length, 1);
  assert.equal(broker.fills()[0]!.price, 100.01);
  const account = await broker.snapshot();
  assert.equal(account.positions[0]!.quantity, 1);
  assert.equal(account.cash, 1099.99);
});
test("resting limit fills at its limit when the intervening path traded through it", async () => {
  const { broker, at } = fixture();
  await broker.placeOrder({ ...intent, limitPrice: 95 });
  assert.equal(broker.fills().length, 0);
  at("2026-07-01", 15, 30);
  await broker.advance();
  assert.equal(broker.fills().length, 1);
  assert.equal(broker.fills()[0]!.price, 95);
  assert.equal(broker.fills()[0]!.at, etInstant("2026-07-01", 10, 35));
});
test("day orders cancel at close while GTC orders persist", async () => {
  const { broker, at } = fixture();
  await broker.placeOrder({ ...intent, limitPrice: 80 });
  await broker.placeOrder({ ...intent, limitPrice: 80, timeInForce: "gtc" });
  at("2026-07-01", 16);
  await broker.advance();
  assert.deepEqual(broker.orders().map((o) => o.status), ["cancelled", "open"]);
  assert.deepEqual(broker.fills(), []);
});
test("sale cash cannot fund a same-day rebuy and settles on the next session", async () => {
  const { broker, at } = fixture(100.01);
  await broker.placeOrder({ ...intent, limitPrice: 100.01 });
  await broker.placeOrder({ ...intent, side: "sell", limitPrice: 99 });
  assert.equal((await broker.snapshot()).settledCash, 0);
  assert.ok((await broker.snapshot()).cash > 99);
  await assert.rejects(broker.placeOrder({ ...intent, limitPrice: 99 }), /Insufficient settled cash/);
  at("2026-07-02", 9, 30); await broker.advance();
  assert.equal((await broker.snapshot()).settledCash, 99.99);
  await broker.placeOrder({ ...intent, quantity: 0.5, limitPrice: 100.01 });
  assert.equal(broker.fills().length, 3);
});
test("resting buys reserve cash and cancellation releases it", async () => {
  const { broker } = fixture(100);
  const order = await broker.placeOrder({ ...intent, limitPrice: 95 });
  assert.equal((await broker.snapshot()).buyingPower, 5);
  await assert.rejects(broker.placeOrder({ ...intent, limitPrice: 95 }), /Insufficient settled cash/);
  broker.cancel(order.brokerOrderId);
  assert.equal((await broker.snapshot()).buyingPower, 100);
});
test("stop-limit triggers before it fills, never retroactively on earlier path lows", async () => {
  const { broker, at } = fixture();
  await broker.placeOrder({ ...intent, orderType: "stop_limit", stopPrice: 115, limitPrice: 95 });
  at("2026-07-01", 16); await broker.advance();
  assert.deepEqual(broker.fills(), []);
  assert.equal(broker.orders()[0]!.triggered, true);
  assert.equal(broker.orders()[0]!.status, "cancelled");
});
test("pre-open quotes expose only the previous close", async () => {
  const { broker, at } = fixture();
  at("2026-07-01", 9);
  assert.equal((await broker.quote("SPY")).last, 110);
});
