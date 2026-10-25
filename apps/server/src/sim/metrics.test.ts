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

test("annualized volatility and sortino pin a hand-computed whipsaw", () => {
  const equity = [110, 100, 110, 100, 110].map((value, i) => ({ date: `2026-07-0${i + 1}`, equity: value, cash: value, benchmark: 100 }));
  const metrics = calculateMetrics(100, equity, [], []);
  assert.ok(Math.abs(metrics.volatilityPct! - 165.992) < 0.001);
  assert.ok(Math.abs(metrics.sortino! - 6.5259) < 0.001);
  assert.ok(Math.abs(metrics.sharpe! - 3.5883) < 0.001);
});

test("sortino is undefined without downside and calmar needs a drawdown", () => {
  const steady = [101, 102, 103, 104, 105].map((value, i) => ({ date: String(i), equity: value, cash: value, benchmark: 100 }));
  const up = calculateMetrics(100, steady, [], []);
  assert.equal(up.sortino, undefined);
  assert.equal(up.calmar, undefined);
  const short = [110, 88, 105].map((value, i) => ({ date: String(i), equity: value, cash: value, benchmark: 100 }));
  assert.equal(calculateMetrics(100, short, [], []).calmar, undefined, "too short to annualize");
  // 20 marks: up to 110, down to 99 (a 10% drawdown), ending at 105.
  const month = [...Array.from({ length: 10 }, (_, i) => 101 + i), 99, ...Array.from({ length: 9 }, () => 105)]
    .map((value, i) => ({ date: String(i), equity: value, cash: value, benchmark: 100 }));
  const expected = ((105 / 100) ** (252 / 20) - 1) / 0.1;
  assert.ok(Math.abs(calculateMetrics(100, month, [], []).calmar! - expected) < 1e-9);
});

test("beta is -1 on a perfectly inverted benchmark and absent on a flat one", () => {
  // The first mark equals the starting capital, so both series start with a zero return.
  const equity = [100, 110, 99].map((value, i) => ({ date: String(i), equity: value, cash: value, benchmark: [100, 90, 99][i]! }));
  const metrics = calculateMetrics(100, equity, [], []);
  assert.ok(Math.abs(metrics.beta! + 1) < 1e-9);
  assert.ok(Math.abs(metrics.alphaPct! + 2) < 1e-9);
  const flat = [100, 110, 99].map((value, i) => ({ date: String(i), equity: value, cash: value, benchmark: 100 }));
  assert.equal(calculateMetrics(100, flat, [], []).beta, undefined);
  assert.equal(calculateMetrics(100, flat, [], []).alphaPct, undefined);
});

test("closed round trips report profit factor, expectancy, holding days and loss streaks", () => {
  const fills: SimFill[] = [
    { at: 1, date: "2026-07-01", symbol: "SPY", side: "buy", quantity: 2, price: 100, orderId: "entry" },
    { at: 2, date: "2026-07-02", symbol: "SPY", side: "sell", quantity: 1, price: 120, orderId: "exit1" },
    { at: 3, date: "2026-07-06", symbol: "SPY", side: "sell", quantity: 1, price: 90, orderId: "exit2" },
  ];
  // One lot nets its partial exits: +20 then -10 close into a single +10 round trip.
  const metrics = calculateMetrics(1200, [], fills, []);
  assert.equal(metrics.roundTrips, 1);
  assert.equal(metrics.profitFactor, undefined);
  assert.equal(metrics.expectancy, 10);
  assert.equal(metrics.avgHoldingDays, 3);
  assert.equal(metrics.maxConsecutiveLosses, 0);
  const streak: SimFill[] = [
    { at: 1, date: "2026-07-01", symbol: "SPY", side: "buy", quantity: 1, price: 100, orderId: "b1" },
    { at: 2, date: "2026-07-02", symbol: "SPY", side: "sell", quantity: 1, price: 90, orderId: "s1" },
    { at: 3, date: "2026-07-03", symbol: "SPY", side: "buy", quantity: 1, price: 100, orderId: "b2" },
    { at: 4, date: "2026-07-04", symbol: "SPY", side: "sell", quantity: 1, price: 95, orderId: "s2" },
    { at: 5, date: "2026-07-07", symbol: "SPY", side: "buy", quantity: 1, price: 100, orderId: "b3" },
    { at: 6, date: "2026-07-08", symbol: "SPY", side: "sell", quantity: 1, price: 130, orderId: "s3" },
  ];
  const losing = calculateMetrics(1200, [], streak, []);
  assert.equal(losing.roundTrips, 3);
  assert.equal(losing.profitFactor, 2);
  assert.equal(losing.expectancy, 5);
  assert.equal(losing.maxConsecutiveLosses, 2);
  assert.equal(losing.avgHoldingDays, 1);
});

test("turnover, costs and risk blocks come from fills and rejected orders", () => {
  const fills: SimFill[] = [
    { at: 1, date: "2026-07-01", symbol: "SPY", side: "buy", quantity: 10, price: 100, orderId: "b", mid: 100.05, cost: 0.5 },
    { at: 2, date: "2026-07-02", symbol: "SPY", side: "sell", quantity: 10, price: 110, orderId: "s", mid: 109.95, cost: 0.5, fees: 0.03 },
  ];
  const equity = [{ date: "2026-07-01", equity: 1000, cash: 0, benchmark: 1000 }, { date: "2026-07-02", equity: 1200, cash: 100, benchmark: 1010 }];
  const orders: OrderRecord[] = [
    { id: "r1", createdAt: 1, updatedAt: 1, status: "rejected_risk", verdict: { approved: false, isExit: false,
      checks: [{ rule: "sector", ok: false, detail: "too much" }, { rule: "size", ok: true, detail: "fine" }, { rule: "sector", ok: false, detail: "again" }] },
      intent: { symbol: "SPY", side: "buy", quantity: 1, orderType: "limit", limitPrice: 100, invalidationPrice: 90, timeInForce: "day",
        timeStopDate: "2026-07-10", thesis: "A rejected entry that still counts its failing rules.", probabilityWin: 0.5,
        expectedGainPct: 5, expectedLossPct: 5, estimatedCostPct: 0.1, evidence: ["test"] } },
    { id: "r2", createdAt: 2, updatedAt: 2, status: "rejected_user", verdict: { approved: false, isExit: false,
      checks: [{ rule: "sector", ok: false, detail: "user rejection is not a risk block" }] },
      intent: { symbol: "SPY", side: "buy", quantity: 1, orderType: "limit", limitPrice: 100, invalidationPrice: 90, timeInForce: "day",
        timeStopDate: "2026-07-10", thesis: "A user rejection that must not count as a risk block.", probabilityWin: 0.5,
        expectedGainPct: 5, expectedLossPct: 5, estimatedCostPct: 0.1, evidence: ["test"] } },
  ];
  const metrics = calculateMetrics(1000, equity, fills, orders);
  assert.ok(Math.abs(metrics.turnoverPct - 190.909) < 0.001);
  assert.equal(metrics.costsPaid, 1.03, "spread, slippage and fees");
  assert.equal(metrics.feesPaid, 0.03);
  assert.ok(Math.abs(metrics.costsPct - 0.103) < 1e-10);
  assert.deepEqual(metrics.riskBlocks, { sector: 2 });
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
