---
name: position-sizing-and-exits
description: Sizes positions from dollar risk and ATR stops and manages exits by R-multiples, trailing, and time stops; load for every order and every open position review.
---

Use when: computing size for any `submit_order` intent, or reviewing how and when to exit an open position.

## Rules

1. Size formula: shares equal risk dollars divided by per-share risk. Risk dollars are 1 percent of equity at risk to invalidation. Per-share risk is entry minus invalidation price, floored at 1.5 times ATR so stops are never tighter than noise.
2. Stops are 1.5 to 2 times ATR from entry for trend trades, under the swing low for pullbacks. The stop distance sets the size, never the reverse. If the computed size breaches the 5-percent-per-name or 20-percent-per-sector cap, shrink the position; do not widen the stop to fit.
3. Every intent needs invalidationPrice, timeStopDate, probabilityWin, expectedGainPct, expectedLossPct, and estimatedCostPct. Expected value after costs must exceed twice the costs or there is no trade, however good the chart.
4. Scale out: sell half at 2R (gain equal to twice the initial per-share risk). Move the stop to breakeven at the same time. Trail the remainder with a 2x ATR stop or the 20-day low, whichever is higher.
5. Time stops: trend trades that make no new 10-day high in 10 sessions exit. Mean-reversion trades exit after 5 sessions (see `etf-mean-reversion`). Minimum hold is 1 trading day except stop-driven exits; the risk engine enforces this.
6. Never widen a stop, never move a time stop outward, never average down. Changes to exits go one direction only: tighter or earlier.
7. Costs: limit orders within 10 bps of mid, spread under 20 bps at entry. If the spread is wider, skip the name; illiquidity is a veto, not a cost to absorb.

## Tool workflow

```js
const risk = await tools.get_risk_state(); // equity, openRisk, halts
const ind = await tools.market_indicators({ symbol: SYM });
const atrStop = 1.5 * ind.atr14;
const perShareRisk = Math.max(entry - invalidation, atrStop);
const riskDollars = 0.01 * risk.equity;
const shares = Math.floor(riskDollars / perShareRisk);
// then check 5%-per-name and 20%-per-sector caps before submit_order
const ev = pWin * expGain - (1 - pWin) * expLoss - cost;
const tradable = ev > 2 * cost;
```

## Failure modes

- Sizing to a round share count or a notional target and letting risk be whatever results. Risk is the input; shares are the output.
- Taking partial profits before 2R out of relief. The plan sells half at 2R; emotions sell at the first green scroll.
- Holding a flat trade past its time stop because the thesis "still holds." Stale trades consume one of 5 slots; exit and re-enter only on a fresh trigger.
