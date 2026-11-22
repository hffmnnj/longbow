import { test } from "node:test";
import assert from "node:assert/strict";
import { replayLongPuts } from "./put-replay.ts";

type OrderInput = { at: string; contractId: string; side: "buy" | "sell"; quantity: number; limitCents: number };
type QuoteInput = { at: string; contractId: string; bidCents: number; askCents: number; bidSize: number; askSize: number };

const contractId = "SPY-P500";
const contract = { id: contractId, underlying: "SPY", strikeCents: 50_000, expiresAt: "2026-12-18T20:00:00Z", multiplier: 100 };
const order = (at: string, side: "buy" | "sell", quantity: number, limitCents: number): OrderInput =>
  ({ at, contractId, side, quantity, limitCents });
const quote = (at: string, bidCents: number, askCents: number, bidSize = 5, askSize = 5): QuoteInput =>
  ({ at, contractId, bidCents, askCents, bidSize, askSize });
const replay = (
  orders: OrderInput[],
  quotes: QuoteInput[],
  overrides: Partial<{ startingCashCents: number; maxPremiumAtRiskCents: number; feePerContractCents: number }> = {},
) => replayLongPuts({
  startingCashCents: 1_000_000, maxPremiumAtRiskCents: 500_000, feePerContractCents: 65,
  contracts: [contract], orders, quotes, ...overrides,
});

test("a buy ignores its own timestamp and pays the next ask with multiplier and fees", () => {
  const result = replay(
    [order("2026-06-01T14:00:00Z", "buy", 1, 500), order("2026-06-01T14:01:00Z", "sell", 1, 100)],
    [
      quote("2026-06-01T14:00:00Z", 100, 200),
      quote("2026-06-01T14:00:30Z", 150, 250),
      quote("2026-06-01T14:01:30Z", 300, 350),
    ],
  );
  assert.equal(result.mode, "paper-long-puts");
  assert.deepEqual(result.fills.map((fill) => [fill.side, fill.at, fill.priceCents, fill.feeCents]), [
    ["buy", "2026-06-01T14:00:30.000Z", 250, 65],
    ["sell", "2026-06-01T14:01:30.000Z", 300, 65],
  ]);
  assert.deepEqual(result.orders.map((entry) => entry.outcome), ["filled", "filled"]);
  assert.equal(result.endingCashCents, 1_004_870);
  assert.equal(result.netPnlCents, 4_870);
  assert.equal(result.feesCents, 130);
  assert.equal(result.peakPremiumAtRiskCents, 25_065);
});

test("two simultaneous orders cannot both consume a displayed size of one", () => {
  const result = replay(
    [
      order("2026-06-01T14:00:00Z", "buy", 1, 500),
      order("2026-06-01T14:00:00Z", "buy", 1, 500),
      order("2026-06-01T14:01:00Z", "sell", 1, 100),
    ],
    [
      quote("2026-06-01T14:00:20Z", 100, 200, 5, 1),
      quote("2026-06-01T14:01:20Z", 120, 200, 5, 0),
    ],
  );
  assert.deepEqual(result.orders.map((entry) => entry.outcome), ["filled", "unfilled", "filled"]);
  assert.deepEqual(result.fills.map((fill) => [fill.orderIndex, fill.side, fill.priceCents]), [
    [0, "buy", 200],
    [2, "sell", 120],
  ]);
  assert.equal(result.endingCashCents, 991_870);
  assert.equal(result.netPnlCents, -8_130);
  assert.equal(result.feesCents, 130);
  assert.equal(result.peakPremiumAtRiskCents, 20_065);
});

test("premium cap and insufficient cash refuse buys without opening a position", () => {
  const capped = replay(
    [order("2026-06-01T14:00:00Z", "buy", 1, 500)],
    [quote("2026-06-01T14:00:10Z", 90, 150)],
    { maxPremiumAtRiskCents: 10_000, feePerContractCents: 0 },
  );
  assert.deepEqual(capped.orders.map((entry) => entry.outcome), ["premium-cap"]);
  assert.equal(capped.fills.length, 0);
  assert.equal(capped.endingCashCents, 1_000_000);
  assert.equal(capped.peakPremiumAtRiskCents, 0);
  assert.equal(capped.feesCents, 0);

  const broke = replay(
    [order("2026-06-01T14:00:00Z", "buy", 1, 500)],
    [quote("2026-06-01T14:00:10Z", 90, 150)],
    { startingCashCents: 10_000, maxPremiumAtRiskCents: 10_000, feePerContractCents: 0 },
  );
  assert.deepEqual(broke.orders.map((entry) => entry.outcome), ["insufficient-cash"]);
  assert.equal(broke.fills.length, 0);
  assert.equal(broke.endingCashCents, 10_000);
});

test("a sell with no position is refused instead of going short", () => {
  const result = replay(
    [order("2026-06-01T14:00:00Z", "sell", 1, 50)],
    [quote("2026-06-01T14:00:10Z", 150, 200)],
  );
  assert.deepEqual(result.orders.map((entry) => entry.outcome), ["insufficient-contracts"]);
  assert.equal(result.fills.length, 0);
  assert.equal(result.endingCashCents, 1_000_000);
  assert.equal(result.netPnlCents, 0);
});

test("sale proceeds cannot be recycled until the next clearing session", () => {
  const friday = "2026-06-05", monday = "2026-06-08";
  const result = replay([
    order(`${friday}T14:00:00Z`, "buy", 1, 100),
    order(`${friday}T14:01:00Z`, "sell", 1, 100),
    order(`${friday}T14:02:00Z`, "buy", 1, 100),
    order(`${monday}T14:00:00Z`, "buy", 1, 100),
    order(`${monday}T14:01:00Z`, "sell", 1, 100),
  ], [
    quote(`${friday}T14:00:10Z`, 90, 100),
    quote(`${friday}T14:01:10Z`, 100, 110),
    quote(`${friday}T14:02:10Z`, 90, 100),
    quote(`${monday}T14:00:10Z`, 90, 100),
    quote(`${monday}T14:01:10Z`, 100, 110),
  ], { startingCashCents: 10_000, maxPremiumAtRiskCents: 10_000, feePerContractCents: 0 });
  assert.deepEqual(result.orders.map(({ outcome }) => outcome),
    ["filled", "filled", "insufficient-cash", "filled", "filled"]);
  assert.equal(result.endingSettledCashCents, 0);
  assert.equal(result.endingUnsettledProceedsCents, 10_000);
  assert.equal(result.endingCashCents, 10_000);
});

test("positions still open at the end of the tape are unscorable", () => {
  const quotes = [quote("2026-06-01T14:00:10Z", 100, 200), quote("2026-06-01T14:01:10Z", 110, 210)];
  assert.throws(() => replay([order("2026-06-01T14:00:00Z", "buy", 1, 500)], quotes), /Unscorable replay/);
  assert.throws(() => replay([
    order("2026-06-01T14:00:00Z", "buy", 2, 500),
    order("2026-06-01T14:01:00Z", "sell", 1, 100),
  ], quotes), /Unscorable replay/);
});

test("crossed quotes are rejected and the early close bounds the session", () => {
  assert.throws(
    () => replay([order("2026-06-01T14:00:00Z", "buy", 1, 500)], [quote("2026-06-01T14:00:10Z", 300, 200)]),
    /Duplicate or crossed option quote/,
  );

  const early = replay(
    [order("2026-11-27T17:00:00Z", "buy", 1, 500), order("2026-11-27T17:30:00Z", "sell", 1, 100)],
    [quote("2026-11-27T17:00:30Z", 100, 200), quote("2026-11-27T17:30:30Z", 120, 200)],
    { feePerContractCents: 0 },
  );
  assert.deepEqual(early.fills.map((fill) => fill.priceCents), [200, 120]);
  assert.equal(early.netPnlCents, -8_000);

  assert.throws(
    () => replay([order("2026-11-27T17:59:00Z", "buy", 1, 500)], [quote("2026-11-27T18:00:00Z", 100, 200)]),
    /inside NYSE regular hours/,
  );
});
