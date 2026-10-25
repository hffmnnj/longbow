import type { OrderRecord, SimEquityPoint, SimFill, SimMetrics } from "@rh/shared";

const TRADING_DAYS = 252;
const MIN_CALMAR_DAYS = 20;

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Sample standard deviation (n-1 denominator); 0 when fewer than 2 values. */
function sampleStd(values: number[], about?: number): number {
  if (values.length < 2) return 0;
  const center = about ?? mean(values);
  const variance = values.reduce((sum, v) => sum + (v - center) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function dayDiff(from: string, to: string): number {
  const ms = Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function calculateMetrics(startingCash: number, equity: SimEquityPoint[], fills: SimFill[], orders: OrderRecord[]): SimMetrics {
  let peak = startingCash;
  let drawdown = 0;
  let previous = startingCash;
  let benchmarkPrevious = startingCash;
  const returns: number[] = [];
  const benchmarkReturns: number[] = [];
  for (const point of equity) {
    peak = Math.max(peak, point.equity);
    drawdown = Math.max(drawdown, (peak - point.equity) / peak);
    returns.push(point.equity / previous - 1);
    previous = point.equity;
    const benchmark = point.benchmark ?? benchmarkPrevious;
    benchmarkReturns.push(benchmark / benchmarkPrevious - 1);
    benchmarkPrevious = benchmark;
  }
  interface Lot { fill: SimFill; remaining: number; pnl: number; holdingWeighted: number; intent: OrderRecord["intent"] | undefined }
  const lots = new Map<string, Lot[]>();
  const outcomes: { pnl: number; risk: number; probability: number | undefined; holdingDays: number }[] = [];
  for (const fill of fills) {
    const queue = lots.get(fill.symbol) ?? [];
    if (fill.side === "buy") {
      queue.push({ fill, remaining: fill.quantity, pnl: 0, holdingWeighted: 0, intent: orders.find((o) => o.brokerOrderId === fill.orderId || o.id === fill.orderId)?.intent });
      lots.set(fill.symbol, queue);
    } else {
      let quantity = fill.quantity;
      while (quantity > 1e-8 && queue.length > 0) {
        const lot = queue[0]!;
        const matched = Math.min(quantity, lot.remaining);
        lot.pnl += (fill.price - lot.fill.price) * matched;
        lot.holdingWeighted += matched * dayDiff(lot.fill.date, fill.date);
        quantity -= matched;
        lot.remaining -= matched;
        if (lot.remaining < 1e-8) {
          outcomes.push({ pnl: lot.pnl, risk: lot.intent === undefined ? 0 : Math.abs(lot.intent.limitPrice - lot.intent.invalidationPrice) * lot.fill.quantity,
            probability: lot.intent?.probabilityWin, holdingDays: lot.holdingWeighted / lot.fill.quantity });
          queue.shift();
        }
      }
    }
  }
  const last = equity.at(-1);
  const averageEquity = equity.length === 0 ? startingCash : mean(equity.map((p) => p.equity));
  const notional = fills.reduce((sum, f) => sum + f.price * f.quantity, 0);
  const feesPaid = fills.reduce((sum, f) => sum + (f.fees ?? 0), 0);
  const costsPaid = fills.reduce((sum, f) => sum + (f.cost ?? 0), 0) + feesPaid;
  const riskBlocks: Record<string, number> = {};
  for (const order of orders) {
    if (order.status !== "rejected_risk") continue;
    for (const check of order.verdict.checks) {
      if (!check.ok) riskBlocks[check.rule] = (riskBlocks[check.rule] ?? 0) + 1;
    }
  }
  const metrics: SimMetrics = {
    returnPct: ((last?.equity ?? startingCash) / startingCash - 1) * 100,
    benchmarkReturnPct: ((last?.benchmark ?? startingCash) / startingCash - 1) * 100,
    maxDrawdownPct: drawdown * 100,
    trades: fills.length,
    exposurePct: equity.length === 0 ? 0 : equity.reduce((sum, p) => sum + (p.equity - p.cash) / p.equity, 0) / equity.length * 100,
    ordersSubmitted: orders.filter((o) => o.status === "submitted").length,
    ordersRejected: orders.filter((o) => o.status === "rejected_risk" || o.status === "rejected_user" || o.status === "failed").length,
    roundTrips: outcomes.length,
    turnoverPct: averageEquity === 0 ? 0 : notional / averageEquity * 100,
    costsPaid,
    costsPct: costsPaid / startingCash * 100,
    ...(feesPaid > 0 ? { feesPaid } : {}),
    riskBlocks,
  };
  if (returns.length >= 5) {
    const avg = mean(returns);
    const std = sampleStd(returns, avg);
    metrics.sharpe = std === 0 ? 0 : avg / std * Math.sqrt(TRADING_DAYS);
    metrics.volatilityPct = std * Math.sqrt(TRADING_DAYS) * 100;
    // Downside deviation against a zero target, annualized: positive days count as zero.
    const downside = Math.sqrt(returns.reduce((sum, r) => sum + Math.min(0, r) ** 2, 0) / returns.length) * Math.sqrt(TRADING_DAYS);
    metrics.sortino = downside === 0 ? undefined : avg / downside * TRADING_DAYS;
  }
  // Annualizing a few days over a tiny drawdown gives absurd numbers (1,000+), so Calmar waits for about a month.
  if (equity.length >= MIN_CALMAR_DAYS && drawdown > 0) {
    // Geometric annualization of the run's total return over its daily marks.
    const annualized = (last!.equity / startingCash) ** (TRADING_DAYS / equity.length) - 1;
    metrics.calmar = annualized / drawdown;
  }
  if (returns.length >= 2 && benchmarkReturns.length === returns.length) {
    const avgB = mean(benchmarkReturns);
    const varB = benchmarkReturns.reduce((sum, b) => sum + (b - avgB) ** 2, 0) / (benchmarkReturns.length - 1);
    if (varB > 0) {
      const avgR = mean(returns);
      const cov = returns.reduce((sum, r, i) => sum + (r - avgR) * (benchmarkReturns[i]! - avgB), 0) / (returns.length - 1);
      metrics.beta = cov / varB;
      metrics.alphaPct = metrics.returnPct - metrics.beta * metrics.benchmarkReturnPct;
    }
  }
  if (outcomes.length > 0) {
    metrics.winRatePct = outcomes.filter((o) => o.pnl > 0).length / outcomes.length * 100;
    const withRisk = outcomes.filter((o) => o.risk > 0);
    if (withRisk.length > 0) metrics.avgR = withRisk.reduce((sum, o) => sum + o.pnl / o.risk, 0) / withRisk.length;
    const predicted = outcomes.filter((o) => o.probability !== undefined);
    if (predicted.length > 0) metrics.brier = predicted.reduce((sum, o) => sum + (o.probability! - (o.pnl > 0 ? 1 : 0)) ** 2, 0) / predicted.length;
    const grossProfit = outcomes.filter((o) => o.pnl > 0).reduce((sum, o) => sum + o.pnl, 0);
    const grossLoss = -outcomes.filter((o) => o.pnl < 0).reduce((sum, o) => sum + o.pnl, 0);
    if (grossLoss > 0) metrics.profitFactor = grossProfit / grossLoss;
    metrics.expectancy = mean(outcomes.map((o) => o.pnl));
    metrics.avgHoldingDays = mean(outcomes.map((o) => o.holdingDays));
    let streak = 0;
    let worst = 0;
    for (const outcome of outcomes) {
      streak = outcome.pnl <= 0 ? streak + 1 : 0;
      worst = Math.max(worst, streak);
    }
    metrics.maxConsecutiveLosses = worst;
  }
  return metrics;
}
