import type { OrderRecord, SimEquityPoint, SimFill, SimMetrics } from "@rh/shared";

export function calculateMetrics(startingCash: number, equity: SimEquityPoint[], fills: SimFill[], orders: OrderRecord[]): SimMetrics {
  let peak = startingCash;
  let drawdown = 0;
  let previous = startingCash;
  const returns = equity.map((point) => {
    peak = Math.max(peak, point.equity);
    drawdown = Math.max(drawdown, (peak - point.equity) / peak);
    const result = point.equity / previous - 1;
    previous = point.equity;
    return result;
  });
  const lots = new Map<string, { fill: SimFill; remaining: number; pnl: number; intent: OrderRecord["intent"] | undefined }[]>();
  const outcomes: { pnl: number; risk: number; probability: number | undefined }[] = [];
  for (const fill of fills) {
    const queue = lots.get(fill.symbol) ?? [];
    if (fill.side === "buy") {
      queue.push({ fill, remaining: fill.quantity, pnl: 0, intent: orders.find((o) => o.brokerOrderId === fill.orderId || o.id === fill.orderId)?.intent });
      lots.set(fill.symbol, queue);
    } else {
      let quantity = fill.quantity;
      while (quantity > 1e-8 && queue.length > 0) {
        const lot = queue[0]!;
        const matched = Math.min(quantity, lot.remaining);
        lot.pnl += (fill.price - lot.fill.price) * matched;
        quantity -= matched;
        lot.remaining -= matched;
        if (lot.remaining < 1e-8) {
          outcomes.push({ pnl: lot.pnl, risk: lot.intent === undefined ? 0 : Math.abs(lot.intent.limitPrice - lot.intent.invalidationPrice) * lot.fill.quantity,
            probability: lot.intent?.probabilityWin });
          queue.shift();
        }
      }
    }
  }
  const last = equity.at(-1);
  const metrics: SimMetrics = {
    returnPct: ((last?.equity ?? startingCash) / startingCash - 1) * 100,
    benchmarkReturnPct: ((last?.benchmark ?? startingCash) / startingCash - 1) * 100,
    maxDrawdownPct: drawdown * 100,
    trades: fills.length,
    exposurePct: equity.length === 0 ? 0 : equity.reduce((sum, p) => sum + (p.equity - p.cash) / p.equity, 0) / equity.length * 100,
    ordersSubmitted: orders.filter((o) => o.status === "submitted").length,
    ordersRejected: orders.filter((o) => o.status === "rejected_risk" || o.status === "rejected_user" || o.status === "failed").length,
    roundTrips: outcomes.length,
    turnoverPct: 0,
    costsPaid: 0,
    costsPct: 0,
    riskBlocks: {},
  };
  if (returns.length >= 5) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
    metrics.sharpe = variance === 0 ? 0 : mean / Math.sqrt(variance) * Math.sqrt(252);
  }
  if (outcomes.length > 0) {
    metrics.winRatePct = outcomes.filter((o) => o.pnl > 0).length / outcomes.length * 100;
    const withRisk = outcomes.filter((o) => o.risk > 0);
    if (withRisk.length > 0) metrics.avgR = withRisk.reduce((sum, o) => sum + o.pnl / o.risk, 0) / withRisk.length;
    const predicted = outcomes.filter((o) => o.probability !== undefined);
    if (predicted.length > 0) metrics.brier = predicted.reduce((sum, o) => sum + (o.probability! - (o.pnl > 0 ? 1 : 0)) ** 2, 0) / predicted.length;
  }
  return metrics;
}
