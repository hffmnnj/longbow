import assert from "node:assert/strict";
import { test } from "node:test";
import { equityFees, roundTripFeePct } from "./fees.ts";

test("small sells on Robinhood carry no regulatory fees", () => {
  assert.deepEqual(equityFees({ side: "sell", quantity: 2, price: 200, date: "2026-10-26" }), { sec: 0, taf: 0, cat: 0, total: 0 });
});

test("the SEC fee applies to sells over $500, rounded up to the cent", () => {
  // $1,000 x 20.6 per million = $0.0206 -> $0.03.
  assert.equal(equityFees({ side: "sell", quantity: 5, price: 200, date: "2026-10-26" }).sec, 0.03);
  assert.equal(equityFees({ side: "buy", quantity: 5, price: 200, date: "2026-10-26" }).sec, 0);
  assert.equal(equityFees({ side: "sell", quantity: 5, price: 200, date: "2026-03-01" }).sec, 0, "before the 2026 rate");
});

test("the TAF applies to sells over 50 shares except during FINRA's pause, capped per trade", () => {
  assert.equal(equityFees({ side: "sell", quantity: 100, price: 10, date: "2026-11-02" }).taf, 0, "paused Oct-Dec 2026");
  assert.equal(equityFees({ side: "sell", quantity: 100, price: 10, date: "2027-01-04" }).taf, 0.02);
  assert.equal(equityFees({ side: "sell", quantity: 50, price: 10, date: "2027-01-04" }).taf, 0);
  assert.equal(equityFees({ side: "sell", quantity: 1_000_000, price: 1, date: "2027-01-04" }).taf, 9.79);
});

test("the CAT fee rounds to zero under a cent and applies to both sides", () => {
  assert.equal(equityFees({ side: "buy", quantity: 3000, price: 1, date: "2026-10-26" }).cat, 0);
  assert.equal(equityFees({ side: "buy", quantity: 5000, price: 1, date: "2026-10-26" }).cat, 0.02);
});

test("round-trip fee percent is relative to the entry notional", () => {
  assert.equal(roundTripFeePct(2, 200, 210, "2026-10-26"), 0);
  // Sell of 5 x 220 = $1,100: SEC $0.0227 -> $0.03 on a $1,000 entry = 0.003%.
  assert.ok(Math.abs(roundTripFeePct(5, 200, 220, "2026-10-26") - 0.003) < 1e-12);
});
