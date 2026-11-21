import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bar, OrderIntent, SimExecution } from "@rh/shared";
import { createPaperBroker } from "./broker.ts";
import { createNyseCalendar } from "../risk/calendar.ts";
import { etInstant } from "./path.ts";

const intent: OrderIntent = { symbol: "SPY", side: "buy", quantity: 1, orderType: "limit", limitPrice: 101, timeInForce: "day", invalidationPrice: 90,
  timeStopDate: "2026-07-10", thesis: "A valid test thesis with enough detail.", probabilityWin: 0.6, expectedGainPct: 10, expectedLossPct: 5, estimatedCostPct: 0.1, evidence: ["test historical quote"] };
// A flat $100 session makes the realistic path and every quote deterministic.
const latencyBars: Bar[] = [
  { date: "2026-06-30", open: 100, low: 99, high: 101, close: 100, volume: 10_000_000 },
  { date: "2026-07-01", open: 100, low: 100, high: 100, close: 100, volume: 10_000_000 },
];
function fixture(cash = 1200, execution: SimExecution = "ideal") {
  let now = etInstant("2026-07-01", 9, 30);
  const broker = createPaperBroker({ startingCash: cash, clock: { now: () => now }, calendar: createNyseCalendar(), execution,
    bars: async () => ["2026-06-30", "2026-07-01", "2026-07-02", "2026-07-06"].map((date) => ({ date, open: 100, low: 90, high: 120, close: 110, volume: 1000000 })) });
  return { broker, at: (date: string, hour: number, minute = 0) => { now = etInstant(date, hour, minute); } };
}
function barsFixture(bars: Bar[], start: string, cash = 1200, seed = 1, execution: SimExecution = "realistic") {
  let now = etInstant(start, 9, 30);
  const broker = createPaperBroker({ startingCash: cash, clock: { now: () => now }, calendar: createNyseCalendar(),
    bars: async () => bars, execution, seed });
  // Optional sub-minute components pin latency boundaries like 10:15:59.999.
  return { broker, at: (date: string, hour: number, minute = 0, second = 0, millisecond = 0) => {
    now = etInstant(date, hour, minute) + second * 1_000 + millisecond; } };
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
test("fractional intents must be marketable now and do not become resting orders", async () => {
  const { broker } = fixture();
  await assert.rejects(broker.placeOrder({ ...intent, quantity: 0.5, limitPrice: 99 }), { name: "FractionalPreflightError" });
  assert.deepEqual(broker.orders(), []);
  const order = await broker.placeOrder({ ...intent, quantity: 0.5, limitPrice: 100.01 });
  assert.deepEqual(await broker.orderState(order.brokerOrderId), { status: "filled", filledQuantity: 0.5, averageFillPrice: 100.01 });
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
test("an early close ends both execution paths and expires day orders at 13:00 ET", async () => {
  const date = "2026-12-24";
  const bars: Bar[] = [{ date, open: 100, high: 112, low: 98, close: 109, volume: 1_000_000 }];
  for (const execution of ["ideal", "realistic"] as const) {
    const { broker, at } = barsFixture(bars, date, 1200, 1, execution);
    const resting = await broker.placeOrder({ ...intent, limitPrice: 90 });
    at(date, 13);
    await broker.advance();
    assert.deepEqual(await broker.orderState(resting.brokerOrderId), { status: "cancelled" });
    assert.equal((await broker.quote("SPY")).last, 109);
    await assert.rejects(broker.placeOrder(intent), /Simulation market is closed/);
    at(date, 15, 30);
    await broker.advance();
    assert.equal((await broker.quote("SPY")).last, 109);
    assert.deepEqual(broker.fills(), []);
  }
});
test("a late realistic order fills on the early close, not before or after it", async () => {
  const day = "2026-12-24";
  const bars: Bar[] = [{ date: day, open: 100, high: 100, low: 100, close: 100, volume: 1_000_000 }];
  const { broker, at } = barsFixture(bars, day);
  at(day, 12, 59, 55);
  const placed = await broker.placeOrder(intent);
  assert.equal((await broker.orderState(placed.brokerOrderId)).status, "submitted");
  at(day, 12, 59, 59, 999);
  await broker.advance();
  assert.deepEqual(broker.fills(), []);
  at(day, 13);
  await broker.advance();
  assert.equal(broker.fills()[0]?.at, etInstant(day, 13));
  assert.equal((await broker.orderState(placed.brokerOrderId)).status, "filled");
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
test("regulatory fees on a sale over $500 come out of the settled proceeds", async () => {
  const { broker, at } = fixture(1200);
  await broker.placeOrder({ ...intent, quantity: 6, limitPrice: 100.01 });
  await broker.placeOrder({ ...intent, side: "sell", quantity: 6, limitPrice: 99 });
  const sale = broker.fills().at(-1);
  const buy = broker.fills()[0];
  // About $600 sold: SEC fee $0.0124 rounds up to $0.02; TAF and CAT are zero at 6 shares.
  assert.equal(sale?.fees, 0.02);
  assert.equal(buy?.fees, undefined, "a small buy carries no fee");
  at("2026-07-02", 9, 30); await broker.advance();
  assert.ok(buy !== undefined && sale !== undefined);
  const expected = 1200 - 6 * buy.price + 6 * sale.price - 0.02;
  assert.ok(Math.abs(((await broker.snapshot()).settledCash ?? 0) - expected) < 1e-9);
});

test("resting buys reserve cash and cancellation releases it", async () => {
  const { broker } = fixture(100);
  const order = await broker.placeOrder({ ...intent, limitPrice: 95 });
  assert.equal((await broker.snapshot()).buyingPower, 5);
  await assert.rejects(broker.placeOrder({ ...intent, limitPrice: 95 }), /Insufficient settled cash/);
  await broker.cancelOrder(order.brokerOrderId);
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
test("a resting protective stop sells when the path falls through it", async () => {
  const { broker, at } = fixture();
  await broker.placeOrder(intent);
  await broker.placeOrder({ ...intent, side: "sell", orderType: "stop_limit", stopPrice: 95, limitPrice: 94.5, timeInForce: "gtc" });
  at("2026-07-01", 15, 30);
  await broker.advance();
  const sells = broker.fills().filter((f) => f.side === "sell");
  assert.equal(sells.length, 1);
  assert.equal(sells[0]!.price, 94.5);
  assert.equal((await broker.snapshot()).positions.length, 0);
});
test("a realistic marketable fill is causal: it commits at its latency due, not before", async () => {
  const { broker, at } = barsFixture(latencyBars, "2026-07-01");
  at("2026-07-01", 10, 15);
  const placed = await broker.placeOrder({ ...intent, limitPrice: 101 });
  // The attempt is queued 60 seconds out: it reserves cash but commits nothing.
  assert.deepEqual(broker.fills(), []);
  assert.equal(broker.orders()[0]!.status, "open");
  assert.equal((await broker.orderState(placed.brokerOrderId)).status, "submitted");
  const queued = await broker.snapshot();
  assert.deepEqual(queued.positions, []);
  assert.equal(queued.cash, 1200);
  assert.equal(queued.buyingPower, 1200 - 101);

  at("2026-07-01", 10, 15, 59, 999);
  await broker.advance();
  assert.deepEqual(broker.fills(), []);
  assert.equal((await broker.orderState(placed.brokerOrderId)).status, "submitted");
  assert.equal((await broker.snapshot()).cash, 1200);

  at("2026-07-01", 10, 16);
  await broker.advance();
  const fills = broker.fills();
  assert.equal(fills.length, 1);
  const fill = fills[0]!;
  assert.equal(fill.orderId, placed.brokerOrderId);
  assert.equal(fill.at, etInstant("2026-07-01", 10, 16));
  assert.equal(fill.quantity, 1);
  assert.equal(fill.mid, 100);
  assert.ok(fill.price > fill.mid! && fill.price <= 101, `unexpected fill ${fill.price}`);
  const state = await broker.orderState(placed.brokerOrderId);
  assert.equal(state.status, "filled");
  assert.equal(state.filledQuantity, 1);
  assert.equal(state.averageFillPrice, fill.price);
  const done = await broker.snapshot();
  assert.equal(done.positions[0]!.quantity, 1);
  assert.equal(done.cash, 1200 - fill.price);
  assert.equal(done.buyingPower, 1200 - fill.price);
});
test("an order cancelled before due never fills", async () => {
  const { broker, at } = barsFixture(latencyBars, "2026-07-01");
  at("2026-07-01", 10, 15);
  const placed = await broker.placeOrder({ ...intent, limitPrice: 101 });
  assert.deepEqual(broker.fills(), []);
  at("2026-07-01", 10, 15, 59, 999);
  await broker.cancelOrder(placed.brokerOrderId);
  assert.equal((await broker.orderState(placed.brokerOrderId)).status, "cancelled");
  at("2026-07-01", 10, 16);
  await broker.advance();
  assert.deepEqual(broker.fills(), []);
  assert.equal((await broker.orderState(placed.brokerOrderId)).status, "cancelled");
  const after = await broker.snapshot();
  assert.deepEqual(after.positions, []);
  assert.equal(after.cash, 1200);
  assert.equal(after.buyingPower, 1200);
});
test("a realistically modeled protective stop does not pay its entire stop-limit buffer", async () => {
  const bars: Bar[] = [
    { date: "2026-07-06", open: 100, low: 99.9, high: 100.5, close: 100, volume: 100_000_000 },
    { date: "2026-07-07", open: 100, low: 97, high: 100.5, close: 98, volume: 100_000_000 },
  ];
  const { broker, at } = barsFixture(bars, "2026-07-06");
  await broker.placeOrder({ ...intent, limitPrice: 101 });
  at("2026-07-06", 9, 31);
  await broker.advance();
  assert.equal(broker.fills().filter((fill) => fill.side === "buy").length, 1);
  await broker.placeOrder({ ...intent, side: "sell", orderType: "stop_limit", stopPrice: 99.5, limitPrice: 99, timeInForce: "gtc" });
  assert.equal(broker.orders()[1]?.triggered, false);

  at("2026-07-07", 16);
  await broker.advance();
  const sells = broker.fills().filter((fill) => fill.side === "sell");
  assert.equal(sells.length, 1);
  const fill = sells[0]!;
  assert.ok(Math.abs((fill.mid ?? NaN) - 99.5) < 1e-9);
  // Prior $10B ADV gives a 1 bp half-spread, widened to at most 1.5 bp
  // near the open. No volatility term with one prior close.
  assert.ok(fill.price >= 99.5 * (1 - 0.00015) && fill.price <= 99.5 * (1 - 0.0001), `unexpected fill ${fill.price}`);
  assert.equal((await broker.snapshot()).positions.length, 0);
});
test("a sell is refused while a resting stop holds the shares", async () => {
  const { broker } = fixture();
  await broker.placeOrder(intent);
  await broker.placeOrder({ ...intent, side: "sell", orderType: "stop_limit", stopPrice: 95, limitPrice: 94.5, timeInForce: "gtc" });
  await assert.rejects(broker.placeOrder({ ...intent, side: "sell", limitPrice: 99 }), /Insufficient shares/);
  assert.deepEqual(broker.fills().map((f) => f.side), ["buy"]);
});
test("fills record mid and cost in both modes", async () => {
  const { broker } = fixture();
  await broker.placeOrder(intent);
  const fill = broker.fills()[0]!;
  assert.equal(fill.mid, 100);
  assert.ok(Math.abs(fill.cost! - 0.01) < 1e-9);
});
test("a touch-only limit fills in ideal mode but rests in realistic mode", async () => {
  const bars: Bar[] = ["2026-06-29", "2026-06-30"].map((date) => ({ date, open: 100, low: 99, high: 101, close: 100, volume: 10_000_000 }))
    .concat([{ date: "2026-07-01", open: 100, low: 95, high: 120, close: 110, volume: 10_000_000 }]);
  const { broker: idealBroker, at: idealAt } = barsFixture(bars, "2026-07-01", 1200, 1, "ideal");
  await idealBroker.placeOrder({ ...intent, limitPrice: 95 });
  idealAt("2026-07-01", 15, 30);
  await idealBroker.advance();
  assert.equal(idealBroker.fills().length, 1);

  const { broker, at } = barsFixture(bars, "2026-07-01");
  await broker.placeOrder({ ...intent, limitPrice: 95 });
  at("2026-07-01", 15, 30);
  await broker.advance();
  assert.deepEqual(broker.fills(), []);
  assert.equal(broker.orders()[0]!.status, "open");
});
test("a gap below a sell stop triggers at the open while a stop_limit above the gap stays unfilled", async () => {
  const bars: Bar[] = [
    { date: "2026-07-06", open: 100, low: 99, high: 101, close: 100, volume: 10_000_000 },
    { date: "2026-07-07", open: 90, low: 88, high: 92, close: 91, volume: 10_000_000 },
  ];
  const { broker, at } = barsFixture(bars, "2026-07-06");
  await broker.placeOrder({ ...intent, limitPrice: 200 });
  at("2026-07-06", 9, 31);
  await broker.advance();
  assert.equal(broker.fills().length, 1);
  await broker.placeOrder({ ...intent, side: "sell", orderType: "stop_limit", stopPrice: 95, limitPrice: 94.5, timeInForce: "gtc" });
  assert.equal(broker.orders()[1]!.triggered, false);
  at("2026-07-07", 9, 31);
  await broker.advance();
  assert.equal(broker.orders()[1]!.triggered, true);
  assert.equal(broker.orders()[1]!.status, "open");
  at("2026-07-07", 16);
  await broker.advance();
  assert.equal(broker.orders()[1]!.status, "open");
  assert.deepEqual(broker.fills().filter((f) => f.side === "sell"), []);
});
test("marketable fills include slippage and never cross the limit", async () => {
  const prior: Bar[] = Array.from({ length: 21 }, (_, i) => ({ date: `2026-06-${String(i + 1).padStart(2, "0")}`,
    open: 100, high: 112, low: 98, close: i % 2 === 0 ? 100 : 110, volume: 10_000_000 }));
  const bars: Bar[] = prior.concat([{ date: "2026-07-01", open: 100, low: 100, high: 100, close: 100, volume: 10_000_000 }]);
  const { broker, at } = barsFixture(bars, "2026-07-01");
  const q = await broker.quote("SPY");
  await broker.placeOrder({ ...intent, limitPrice: q.ask });
  assert.deepEqual(broker.fills(), []);
  assert.equal(broker.orders()[0]!.status, "open");
  at("2026-07-01", 9, 31);
  await broker.advance();
  // The latency attempt prices above the quoted ask, so the order still rests.
  assert.deepEqual(broker.fills(), []);
  assert.equal(broker.orders()[0]!.status, "open");
  const fractional = await broker.placeOrder({ ...intent, quantity: 0.5, limitPrice: 101 });
  assert.deepEqual(broker.fills(), []);
  at("2026-07-01", 9, 32);
  await broker.advance();
  const fill = broker.fills().find((f) => f.orderId === fractional.brokerOrderId)!;
  assert.ok(fill.price <= 101);
  assert.ok(fill.price > fill.mid!);
  assert.equal(fill.mid, 100);
  assert.ok(fill.cost! > 0);
});
