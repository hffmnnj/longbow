import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateMetrics } from "./metrics.ts";
import type { OrderRecord, SimFill } from "@rh/shared";

test("metrics include starting capital in return and peak drawdown", () => {
  const equity = [110, 88, 105].map((value, i) => ({ date: `2026-07-0${i + 1}`, equity: value, cash: value / 2, benchmark: 100 + i * 2 }));
  const metrics = calculateMetrics(100, equity, [], []);
  assert.ok(Math.abs(metrics.returnPct - 5) < 1e-10);
  assert.equal(metrics.maxDrawdownPct, 20);
  assert.ok(Math.abs(metrics.benchmarkReturnPct - 4) < 1e-10);
  assert.equal(metrics.exposurePct, 50);
  assert.equal(metrics.sharpe, undefined);
});
test("annualized Sharpe appears after five daily observations", () => {
  const equity = [102, 101, 104, 103, 108].map((value, i) => ({ date: String(i), equity: value, cash: value, benchmark: 100 }));
  const metrics = calculateMetrics(100, equity, [], []);
  assert.ok(Number.isFinite(metrics.sharpe));
  // Independently worked daily-return/sample-standard-deviation result.
  assert.ok(metrics.sharpe! > 9 && metrics.sharpe! < 10);
});

test("round-trip metrics wait for a fully closed entry and use original intent risk", () => {
  const fills: SimFill[] = [
    { at: 1, date: "2026-07-01", symbol: "SPY", side: "buy", quantity: 2, price: 100, orderId: "entry" },
    { at: 2, date: "2026-07-02", symbol: "SPY", side: "sell", quantity: 1, price: 120, orderId: "exit1" },
    { at: 3, date: "2026-07-06", symbol: "SPY", side: "sell", quantity: 1, price: 90, orderId: "exit2" },
  ];
  const orders: OrderRecord[] = [{ id: "gate-entry", brokerOrderId: "entry", createdAt: 1, updatedAt: 1, status: "submitted", verdict: { approved: true, isExit: false, checks: [] },
    intent: { symbol: "SPY", side: "buy", quantity: 2, orderType: "limit", limitPrice: 101, invalidationPrice: 96, timeInForce: "day", timeStopDate: "2026-07-10",
      thesis: "Test a round trip with partial exits.", probabilityWin: 0.7, expectedGainPct: 10, expectedLossPct: 5, estimatedCostPct: 0.1, evidence: ["test"] } }];
  assert.equal(calculateMetrics(1200, [], fills.slice(0, 2), orders).winRatePct, undefined);
  const metrics = calculateMetrics(1200, [], fills, orders);
  assert.equal(metrics.winRatePct, 100);
  assert.equal(metrics.avgR, 1);
  assert.ok(Math.abs(metrics.brier! - 0.09) < 1e-10);
  assert.equal(metrics.ordersSubmitted, 1);
});
