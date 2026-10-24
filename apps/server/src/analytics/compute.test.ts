import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OrderRecord } from "@rh/shared";
import {
  brierScore,
  calibrationBuckets,
  classifyRegime,
  holdingsReplayValues,
  maxDrawdownPct,
  pairHarnessTrades,
  parseThesisStop,
  returnPct,
  summarizeTrades,
  economicCalendar,
  etTime,
} from "./compute.ts";

function order(overrides: Partial<OrderRecord> & { intent: OrderRecord["intent"] }): OrderRecord {
  return {
    id: `o-${Math.random().toString(36).slice(2)}`,
    createdAt: 1_000,
    updatedAt: 1_000,
    verdict: { approved: true, isExit: false, checks: [] },
    status: "filled",
    ...overrides,
  };
}

function intent(symbol: string, side: "buy" | "sell", quantity: number): OrderRecord["intent"] {
  return {
    symbol,
    side,
    quantity,
    orderType: "limit",
    limitPrice: 100,
    timeInForce: "day",
    invalidationPrice: 90,
    timeStopDate: "2026-12-31",
    thesis: "A sufficiently long thesis statement for the intent schema.",
    probabilityWin: 0.6,
    expectedGainPct: 5,
    expectedLossPct: 2,
    estimatedCostPct: 0.05,
    evidence: ["price above average"],
  };
}

describe("pairHarnessTrades", () => {
  it("pairs sells against earlier buys FIFO with partial fills", () => {
    const orders = [
      order({ intent: intent("AAPL", "buy", 10), filledQuantity: 10, averageFillPrice: 100, createdAt: 1000, updatedAt: 1000 }),
      order({ intent: intent("AAPL", "buy", 10), filledQuantity: 10, averageFillPrice: 110, createdAt: 2000, updatedAt: 2000 }),
      order({ intent: intent("AAPL", "sell", 15), filledQuantity: 15, averageFillPrice: 120, createdAt: 3000, updatedAt: 3000 }),
    ];
    const trades = pairHarnessTrades(orders);
    assert.equal(trades.length, 1);
    const trade = trades[0]!;
    assert.equal(trade.symbol, "AAPL");
    assert.equal(trade.quantity, 15);
    // 10 @ 100 + 5 @ 110 -> entry 103.333...
    assert.ok(Math.abs((trade.entryPrice ?? 0) - (1550 / 15)) < 1e-9);
    assert.ok(Math.abs(trade.pnl - (15 * 120 - 1550)) < 1e-9);
    assert.equal(trade.source, "harness");
    assert.equal(trade.openedAt, 1000);
    assert.equal(trade.closedAt, 3000);
  });

  it("computes the R multiple from the entry invalidation price", () => {
    const orders = [
      order({ intent: { ...intent("MSFT", "buy", 10), limitPrice: 100, invalidationPrice: 90 }, filledQuantity: 10, averageFillPrice: 100, createdAt: 1000, updatedAt: 1000 }),
      order({ intent: intent("MSFT", "sell", 10), filledQuantity: 10, averageFillPrice: 115, createdAt: 2000, updatedAt: 2000 }),
    ];
    const trades = pairHarnessTrades(orders);
    assert.equal(trades.length, 1);
    // pnl 150, risk (100-90)*10=100 -> 1.5R
    assert.ok(Math.abs((trades[0]!.rMultiple ?? 0) - 1.5) < 1e-9);
  });

  it("skips sells with no earlier buy and ignores unfilled orders", () => {
    const orders = [
      order({ intent: intent("NVDA", "sell", 5), filledQuantity: 5, averageFillPrice: 200, createdAt: 1000, updatedAt: 1000 }),
      order({ intent: intent("NVDA", "buy", 5), status: "submitted", createdAt: 2000, updatedAt: 2000 }),
    ];
    assert.deepEqual(pairHarnessTrades(orders), []);
  });
});

describe("summarizeTrades", () => {
  it("aggregates win rate, expectancy, profit factor and holding days", () => {
    const summary = summarizeTrades([
      { symbol: "A", closedAt: 2, quantity: 1, exitPrice: 110, pnl: 10, rMultiple: 1, holdingDays: 2, source: "harness" },
      { symbol: "A", closedAt: 3, quantity: 1, exitPrice: 95, pnl: -5, rMultiple: -0.5, holdingDays: 4, source: "harness" },
    ]);
    assert.equal(summary.realizedPnl, 5);
    assert.equal(summary.winRatePct, 50);
    assert.equal(summary.avgR, 0.25);
    assert.equal(summary.expectancy, 2.5);
    assert.equal(summary.profitFactor, 2);
    assert.equal(summary.avgHoldingDays, 3);
  });

  it("leaves metrics undefined when nothing is defined", () => {
    const summary = summarizeTrades([]);
    assert.equal(summary.realizedPnl, 0);
    assert.equal(summary.winRatePct, undefined);
    assert.equal(summary.profitFactor, undefined);
  });
});

describe("calibration and Brier", () => {
  it("buckets harness trades by predicted probability", () => {
    const buckets = calibrationBuckets([
      { symbol: "A", closedAt: 1, quantity: 1, exitPrice: 1, pnl: 5, probabilityWin: 0.55, source: "harness" },
      { symbol: "A", closedAt: 2, quantity: 1, exitPrice: 1, pnl: -5, probabilityWin: 0.59, source: "harness" },
      { symbol: "A", closedAt: 3, quantity: 1, exitPrice: 1, pnl: 5, probabilityWin: 0.95, source: "harness" },
    ]);
    assert.equal(buckets.length, 2);
    assert.deepEqual(buckets[0], { from: 0.5, to: 0.6, predicted: 0.55, realized: 0.5, count: 2 });
    assert.deepEqual(buckets[1], { from: 0.9, to: 1, predicted: 0.95, realized: 1, count: 1 });
  });

  it("scores the Brier mean squared error", () => {
    // (0.5-1)^2 + (0.5-0)^2 over 2 = 0.25
    const brier = brierScore([
      { symbol: "A", closedAt: 1, quantity: 1, exitPrice: 1, pnl: 5, probabilityWin: 0.5, source: "harness" },
      { symbol: "A", closedAt: 2, quantity: 1, exitPrice: 1, pnl: -5, probabilityWin: 0.5, source: "harness" },
    ]);
    assert.equal(brier, 0.25);
    assert.equal(brierScore([{ symbol: "A", closedAt: 1, quantity: 1, exitPrice: 1, pnl: 5, source: "robinhood" }]), undefined);
  });
});

describe("drawdown and returns", () => {
  it("measures the worst peak-to-trough fall as a positive percent", () => {
    assert.ok(Math.abs((maxDrawdownPct([100, 120, 96, 110]) ?? 0) - 20) < 1e-9);
    assert.equal(maxDrawdownPct([100, 110]), 0);
    assert.equal(maxDrawdownPct([100]), undefined);
  });

  it("computes period returns", () => {
    assert.ok(Math.abs((returnPct([100, 110]) ?? 0) - 10) < 1e-9);
    assert.equal(returnPct([100]), undefined);
  });
});

describe("holdings replay", () => {
  it("values today's holdings at past closes plus today's cash", () => {
    const replay = holdingsReplayValues(
      ["2026-10-22", "2026-10-23"],
      { AAPL: { "2026-10-22": 100, "2026-10-23": 110 } },
      [{ symbol: "AAPL", quantity: 2 }],
      50,
    );
    assert.deepEqual(replay, [
      { date: "2026-10-22", value: 250 },
      { date: "2026-10-23", value: 270 },
    ]);
  });
});

describe("classifyRegime", () => {
  it("maps trend and volatility to the skill's regimes", () => {
    assert.equal(classifyRegime({ trend: "up", vix: 12, vixSma20: 14 }), "Bull, low volatility");
    assert.equal(classifyRegime({ trend: "up", vix: 18 }), "Bull, normal volatility");
    assert.equal(classifyRegime({ trend: "sideways", vix: 18 }), "Sideways");
    assert.equal(classifyRegime({ trend: "sideways", vix: 30 }), "Sideways, elevated volatility");
    assert.equal(classifyRegime({ trend: "up", vix: 14, drawdownFromHigh52w: 0.07 }), "Correction");
    assert.equal(classifyRegime({ trend: "down", vix: 30 }), "Bear, high volatility");
    assert.equal(classifyRegime({ trend: "down", vix: 16 }), "Sideways");
  });
});

describe("parseThesisStop", () => {
  it("reads a clearly stated invalidation or stop", () => {
    assert.equal(parseThesisStop("Thesis holds while price stays up. Invalidation $142.50 if momentum fades."), 142.5);
    assert.equal(parseThesisStop("Stop at 95 on a daily close."), 95);
    assert.equal(parseThesisStop("no stops mentioned here"), undefined);
  });
});

describe("economicCalendar", () => {
  it("keeps rated US events once, in ET, and drops noise", () => {
    const events = [
      { time: "8:30", country: "United States", event: "Core PCE Price Index" },
      { time: "8:30", country: "United States", event: "Core PCE Price Index" },
      { time: "11:30", country: "United States", event: "4-Week Bill Auction" },
      { time: "02:00", country: "Germany", event: "GDP" },
      { time: "8:30", country: "United States", event: "Initial Jobless Claims" },
    ];
    assert.deepEqual(economicCalendar([{ date: "2026-10-30", events }]), [
      { date: "2026-10-30", time: "08:30", event: "Core PCE Price Index", importance: "high" },
      { date: "2026-10-30", time: "08:30", event: "Initial Jobless Claims", importance: "medium" },
    ]);
  });

  it("treats Nasdaq's published times as Eastern and pads the hour", () => {
    assert.equal(etTime("8:30"), "08:30");
    assert.equal(etTime("14:00"), "14:00");
    assert.equal(etTime("Tentative"), undefined);
  });
});
