import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bar, OrderIntent } from "@rh/shared";
import { createPaperBroker } from "./broker.ts";
import { createNyseCalendar } from "../risk/calendar.ts";
import { etInstant, realisticPrice } from "./path.ts";

const DAY = "2026-07-01";
const PRIOR = "2026-06-30";
const REGULAR_MINUTES = 390;
const intent: OrderIntent = { symbol: "SPY", side: "buy", quantity: 1, orderType: "limit", limitPrice: 101, timeInForce: "day",
  invalidationPrice: 90, timeStopDate: "2026-07-10", thesis: "A valid test thesis with enough detail.", probabilityWin: 0.6,
  expectedGainPct: 10, expectedLossPct: 5, estimatedCostPct: 0.1, evidence: ["test historical quote"] };
type MinuteTape = { open: number; closes: readonly number[] };

/**
 * The daily bar still seeds costs and the uninstrumented fallback; a selected
 * tape replaces only the synthesized intraday price. Its open deliberately
 * differs from the daily bar's open.
 */
function dailyBars(day = DAY, prior = PRIOR): Bar[] {
  return [
    { date: prior, open: 99, low: 98, high: 100, close: 99, volume: 10_000_000 },
    { date: day, open: 96, low: 80, high: 500, close: 95, volume: 10_000_000 },
  ];
}
function fixture(observedMinutes: (symbol: string, day: string) => MinuteTape | undefined,
  options: { day?: string; cash?: number; bars?: Bar[] } = {}) {
  const day = options.day ?? DAY;
  const bars = options.bars ?? dailyBars(day);
  let now = etInstant(day, 9, 30);
  const broker = createPaperBroker({ startingCash: options.cash ?? 1200, clock: { now: () => now },
    calendar: createNyseCalendar(), bars: async () => bars, execution: "realistic", observedMinutes });
  return { broker, at: (date: string, hour: number, minute = 0, second = 0, millisecond = 0) => {
    now = etInstant(date, hour, minute) + second * 1_000 + millisecond; } };
}
/** A strictly rising tape makes an off-by-one minute unmistakable. */
function ramp(open = 100, firstClose = 101, count = REGULAR_MINUTES): MinuteTape {
  return { open, closes: Array.from({ length: count }, (_, minute) => firstClose + minute) };
}

test("a recorded tape drives realistic quotes at the open, each completed minute and the exact close", async () => {
  const { broker, at } = fixture((symbol, day) => symbol === "SPY" && day === DAY ? ramp() : undefined);
  at(DAY, 9, 29, 59, 999);
  assert.equal((await broker.quote("SPY")).last, 99, "before the open the previous daily close still applies");
  at(DAY, 9, 30);
  assert.equal((await broker.quote("SPY")).last, 100, "09:30 observes the tape's open, not the daily bar's open");
  at(DAY, 9, 30, 59, 999);
  assert.equal((await broker.quote("SPY")).last, 100, "the open holds until the first minute completes");
  at(DAY, 9, 31);
  assert.equal((await broker.quote("SPY")).last, 101);
  at(DAY, 9, 31, 59, 999);
  assert.equal((await broker.quote("SPY")).last, 101, "a quote inside a minute uses the prior completed close");
  at(DAY, 10, 15);
  assert.equal((await broker.quote("SPY")).last, 145);
  at(DAY, 15, 59, 59, 999);
  assert.equal((await broker.quote("SPY")).last, 489);
  at(DAY, 16);
  assert.equal((await broker.quote("SPY")).last, 490, "the exact session close is the tape's last close");
});
test("an early-close tape has 210 minutes and reports its last close at 13:00", async () => {
  const day = "2026-12-24";
  const bars: Bar[] = [
    { date: "2026-12-23", open: 199, low: 198, high: 200, close: 199, volume: 10_000_000 },
    { date: day, open: 195, low: 190, high: 500, close: 195, volume: 10_000_000 },
  ];
  const { broker, at } = fixture((symbol, date) => symbol === "SPY" && date === day ? ramp(200, 201, 210) : undefined,
    { day, bars });
  at(day, 9, 30);
  assert.equal((await broker.quote("SPY")).last, 200);
  at(day, 12, 59, 59, 999);
  assert.equal((await broker.quote("SPY")).last, 409);
  at(day, 13);
  assert.equal((await broker.quote("SPY")).last, 410, "the early close uses the last of 210 closes");
});
test("a delayed realistic fractional fill prices from the observed minute at its latency due", async () => {
  const { broker, at } = fixture((symbol, day) => symbol === "SPY" && day === DAY ? ramp() : undefined);
  at(DAY, 10, 14, 30);
  assert.equal((await broker.quote("SPY")).last, 144);
  const placed = await broker.placeOrder({ ...intent, quantity: 0.5, limitPrice: 500 });
  assert.deepEqual(broker.fills(), [], "marketable fractionals commit only at their latency due");
  at(DAY, 10, 15, 29, 999);
  await broker.advance();
  assert.deepEqual(broker.fills(), []);
  at(DAY, 10, 15, 30);
  await broker.advance();
  const fill = broker.fills()[0]!;
  assert.equal(fill.orderId, placed.brokerOrderId);
  assert.equal(fill.at, etInstant(DAY, 10, 15) + 30_000);
  assert.equal(fill.mid, 145, "the fill marks the 10:15 completed minute, not the 10:14 entry quote");
  assert.ok(fill.price > 145 && fill.price <= 500, `unexpected fill ${fill.price}`);
  assert.deepEqual(await broker.orderState(placed.brokerOrderId),
    { status: "filled", filledQuantity: 0.5, averageFillPrice: fill.price });
});
test("a protective market sale executes from the observed minute price", async () => {
  const { broker, at } = fixture((symbol, day) => symbol === "SPY" && day === DAY ? ramp() : undefined);
  await broker.placeOrder({ ...intent, limitPrice: 200 });
  at(DAY, 9, 31);
  await broker.advance();
  assert.equal(broker.fills()[0]?.mid, 101);
  at(DAY, 10, 15);
  await broker.executeStop({ ...intent, side: "sell" }, "held-stop:test:0");
  const fill = broker.fills().at(-1)!;
  assert.equal(fill.side, "sell");
  assert.equal(fill.at, etInstant(DAY, 10, 15));
  assert.equal(fill.mid, 145);
  assert.ok(fill.price < 145 && fill.price > 144.9, `unexpected protective sale ${fill.price}`);
});
test("a passive whole-share limit matches only on observed ticks after submission, not inside a jump", async () => {
  const closes = Array.from({ length: REGULAR_MINUTES }, (_, minute) => minute >= 10 ? 90 : 100);
  closes[5] = 90; // A completed 09:36 close before the order exists must not fill it retroactively.
  const { broker, at } = fixture((symbol, day) => symbol === "SPY" && day === DAY ? { open: 100, closes } : undefined);
  at(DAY, 9, 37);
  const placed = await broker.placeOrder({ ...intent, limitPrice: 95, timeInForce: "gtc" });
  assert.deepEqual(broker.fills(), []);
  at(DAY, 9, 40, 59, 999);
  await broker.advance();
  assert.deepEqual(broker.fills(), [], "the earlier dip and the 100 prints do not trade through 95");
  at(DAY, 9, 41);
  await broker.advance();
  const fill = broker.fills()[0]!;
  assert.equal(fill.orderId, placed.brokerOrderId);
  assert.equal(fill.at, etInstant(DAY, 9, 41), "the fill lands on the observed tick, not an interpolated time in the 100-to-90 jump");
  assert.equal(fill.price, 95);
  assert.equal(fill.mid, 90);
  assert.equal((await broker.orderState(placed.brokerOrderId)).status, "filled");
});
test("a selected tape with a missing minute fails instead of falling back, while an unobserved symbol keeps the daily model", async () => {
  const short = ramp(100, 101, REGULAR_MINUTES - 1);
  const broken = fixture((symbol, day) => symbol === "SPY" && day === DAY ? short : undefined);
  broken.at(DAY, 10);
  await assert.rejects(broken.broker.quote("SPY"));

  const bars = dailyBars();
  const mixed = fixture((symbol, day) => symbol === "SPY" && day === DAY ? ramp() : undefined, { bars });
  mixed.at(DAY, 10);
  const qqq = await mixed.broker.quote("QQQ");
  assert.equal(qqq.last, realisticPrice(bars[1]!, "QQQ", 1, etInstant(DAY, 10), etInstant(DAY, 16)));
});

test("rejects recorded prices on a different split basis from the daily tape", async () => {
  const { broker, at } = fixture(() => ramp(950, 951));
  at(DAY, 9, 29);
  assert.equal((await broker.quote("SPY")).last, 99, "the current session is not yet used");
  at(DAY, 9, 30);
  await assert.rejects(broker.quote("SPY"), /price basis/);
});
