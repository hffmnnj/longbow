import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePutHoldout } from "./put-holdout.ts";

const put = {
  id: "spy-put",
  underlying: "SPY",
  strikeCents: 50_000,
  expiresAt: "2026-12-18T20:00:00Z",
  multiplier: 100,
};
const quote = (at: string, bidCents: number, askCents: number, bidSize = 5, askSize = 5) => ({
  at, contractId: put.id, bidCents, askCents, bidSize, askSize,
});
const order = (at: string, side: "buy" | "sell", quantity: number, limitCents: number) => ({
  at, contractId: put.id, side, quantity, limitCents,
});
const fixtureProvenance = {
  source: "hand-written test fixture",
  quoteDate: "2026-06-06",
  kind: "fixture",
};
const baseWindow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "w1",
  startDate: "2026-06-01",
  endDate: "2026-06-05",
  startingEquityCents: 1_000_000,
  optionCashSleeveCents: 100_000,
  stock: { startValueCents: 900_000, endValueCents: 950_000 },
  feePerContractCents: 65,
  put,
  quotes: [
    quote("2026-06-01T14:00:10Z", 100, 200),
    quote("2026-06-01T14:01:10Z", 150, 250),
  ],
  orders: [
    order("2026-06-01T14:00:00Z", "buy", 1, 200),
    order("2026-06-01T14:01:00Z", "sell", 1, 100),
  ],
  quoteProvenance: fixtureProvenance,
  ...overrides,
});
const score = (...windows: unknown[]) => scorePutHoldout({ windows });

test("scores option costs across cash, shares-only, and hedged arms", () => {
  const result = score(baseWindow());
  const window = result.windows[0]!;
  assert.equal(window.status, "scored");
  if (window.status !== "scored") return;

  assert.equal(window.tradeLabel, "option-traded");
  assert.equal(window.noTrade, false);
  assert.deepEqual(window.put, put);
  assert.equal(window.feePerContractCents, 65);
  assert.deepEqual(window.stock, { startValueCents: 900_000, endValueCents: 950_000 });
  assert.deepEqual(window.cashOnly, { endingEquityCents: 1_000_000, netDeltaCents: 0 });
  assert.deepEqual(window.sharesOnly, { endingEquityCents: 1_050_000, netDeltaCents: 50_000 });
  assert.deepEqual(window.hedged, { endingEquityCents: 1_044_870, netDeltaCents: 44_870 });
  assert.equal(window.pairedNetDeltaCents, -5_130);
  assert.equal(window.pairedNetDeltaUsd, -51.3);
  assert.equal(window.optionCash.endingCents, 94_870);
  assert.equal(window.optionCash.settledCents, 79_935);
  assert.equal(window.optionCash.unsettledProceedsCents, 14_935);
  assert.equal(window.optionCash.feesCents, 130);
  assert.equal(window.optionCash.peakPremiumAtRiskCents, 20_065);
  assert.equal(window.optionCash.fillCount, 2);
  assert.equal(window.optionCash.unfilledOrderCount, 0);
  assert.deepEqual(window.optionCash.fills.map((fill) => [fill.side, fill.priceCents, fill.feeCents]), [
    ["buy", 200, 65],
    ["sell", 150, 65],
  ]);
  assert.deepEqual(window.optionCash.orderOutcomes.map((entry) => entry.outcome), ["filled", "filled"]);

  assert.equal(result.fixture, true);
  assert.deepEqual(result.provenance.kinds, ["fixture"]);
  assert.equal(result.provenance.historicalEvidence, "none");
  assert.equal(result.provenance.cryptographicallyVerified, false);
  assert.match(result.provenance.statement, /not historical evidence/i);
  assert.equal(result.totals.denominator, "1/1");
  assert.equal(result.totals.pairedNetDeltaCents, -5_130);
  assert.equal(result.totals.cashOnly.netDeltaCents, 0);
  assert.equal(result.totals.sharesOnly.netDeltaCents, 50_000);
  assert.equal(result.totals.hedged.netDeltaCents, 44_870);
  assert.equal(result.totals.unfilledOrderCount, 0);
});

test("labels an unestablished hedge as no-trade and accepts end stock-only equity", () => {
  const result = score(baseWindow({
    stock: { startValueCents: 900_000, endStockOnlyEquityCents: 1_050_000 },
    orders: [order("2026-06-01T14:00:00Z", "buy", 1, 50)],
    quoteProvenance: { ...fixtureProvenance, source: "unit-test tape labeled observed", kind: "observed" },
  }));
  const window = result.windows[0]!;
  assert.equal(window.status, "scored");
  if (window.status !== "scored") return;

  assert.equal(window.stock.endValueCents, 950_000);
  assert.equal(window.tradeLabel, "no-trade");
  assert.equal(window.noTrade, true);
  assert.deepEqual(window.sharesOnly, { endingEquityCents: 1_050_000, netDeltaCents: 50_000 });
  assert.deepEqual(window.hedged, { endingEquityCents: 1_050_000, netDeltaCents: 50_000 });
  assert.equal(window.pairedNetDeltaCents, 0);
  assert.equal(window.optionCash.endingCents, 100_000);
  assert.equal(window.optionCash.fillCount, 0);
  assert.equal(window.optionCash.feesCents, 0);
  assert.equal(window.optionCash.unfilledOrderCount, 1);
  assert.deepEqual(window.optionCash.orderOutcomes.map((entry) => entry.outcome), ["unfilled"]);

  assert.equal(result.fixture, false);
  assert.deepEqual(result.provenance.kinds, ["observed"]);
  assert.equal(result.provenance.historicalEvidence, "self-declared");
  assert.equal(result.totals.noTradeWindows, 1);
  assert.equal(result.totals.unfilledOrderCount, 1);
  assert.equal(result.totals.denominator, "1/1");
});

test("refuses non-chronological, overlapping, duplicate, and incomplete windows", () => {
  const first = baseWindow();
  const later = baseWindow({
    id: "w2",
    startDate: "2026-06-08",
    endDate: "2026-06-12",
    quotes: [quote("2026-06-08T14:00:10Z", 100, 200), quote("2026-06-08T14:01:10Z", 150, 250)],
    orders: [order("2026-06-08T14:00:00Z", "buy", 1, 200), order("2026-06-08T14:01:00Z", "sell", 1, 100)],
  });
  assert.throws(() => score(later, first), /strictly increasing chronological order/);

  const overlapping = baseWindow({
    id: "w2",
    startDate: "2026-06-05",
    endDate: "2026-06-10",
    quotes: [quote("2026-06-05T14:00:10Z", 100, 200), quote("2026-06-05T14:01:10Z", 150, 250)],
    orders: [order("2026-06-05T14:00:00Z", "buy", 1, 200), order("2026-06-05T14:01:00Z", "sell", 1, 100)],
  });
  assert.throws(() => score(first, overlapping), /overlap/);

  assert.throws(() => score(first, baseWindow({
    id: "w1",
    startDate: "2026-06-08",
    endDate: "2026-06-12",
    quotes: [quote("2026-06-08T14:00:10Z", 100, 200)],
    orders: [order("2026-06-08T14:00:00Z", "buy", 1, 50)],
  })), /Duplicate put holdout window id/);

  const missingProvenance = { ...first } as Record<string, unknown>;
  delete missingProvenance.quoteProvenance;
  assert.throws(() => score(missingProvenance), /quoteProvenance/);
  assert.throws(() => score(baseWindow({ startingEquityCents: 999_999 })), /startingEquityCents/);
  assert.throws(() => score(baseWindow({
    stock: { startValueCents: 900_000, endValueCents: 950_000, endStockOnlyEquityCents: 1_050_000 },
  })), /exactly one/);
  assert.throws(() => score(baseWindow({
    quotes: [quote("2026-06-01T14:00:10Z", 300, 200)],
  })), /crossed option quote/);
});

test("marks an unclosed option position unscorable and excludes it from totals", () => {
  const open = baseWindow({
    id: "w-open",
    quotes: [quote("2026-06-01T14:00:10Z", 100, 200)],
    orders: [order("2026-06-01T14:00:00Z", "buy", 1, 200)],
  });
  const closed = baseWindow({
    id: "w-closed",
    startDate: "2026-06-08",
    endDate: "2026-06-12",
    quotes: [quote("2026-06-08T14:00:10Z", 100, 200), quote("2026-06-08T14:01:10Z", 150, 250)],
    orders: [order("2026-06-08T14:00:00Z", "buy", 1, 200), order("2026-06-08T14:01:00Z", "sell", 1, 100)],
  });
  const result = score(open, closed);
  const incomplete = result.windows[0]!;
  assert.equal(incomplete.status, "unscorable");
  if (incomplete.status !== "unscorable") return;
  assert.equal(incomplete.reason, "incomplete-options-closeout");
  assert.match(incomplete.detail, /Unscorable replay/);
  assert.equal("pairedNetDeltaCents" in incomplete, false);

  assert.equal(result.totals.attemptedWindows, 2);
  assert.equal(result.totals.scoredWindows, 1);
  assert.equal(result.totals.unscorableWindows, 1);
  assert.equal(result.totals.incompleteOptionsWindows, 1);
  assert.equal(result.totals.denominator, "1/2");
  assert.equal(result.totals.pairedNetDeltaCents, -5_130);
  assert.equal(result.totals.optionFeesCents, 130);
  assert.equal(result.totals.fillCount, 2);

  const onlyOpen = score(open);
  assert.equal(onlyOpen.totals.denominator, "0/1");
  assert.equal(onlyOpen.totals.incompleteOptionsWindows, 1);
  assert.equal(onlyOpen.totals.pairedNetDeltaCents, null);
  assert.equal(onlyOpen.totals.optionFeesCents, null);
  assert.equal(onlyOpen.totals.fillCount, null);
  assert.equal(onlyOpen.totals.cashOnly.endingEquityCents, null);
  assert.equal(onlyOpen.totals.sharesOnly.endingEquityCents, null);
  assert.equal(onlyOpen.totals.hedged.netDeltaCents, null);
});
