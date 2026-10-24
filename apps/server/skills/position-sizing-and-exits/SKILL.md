---
name: position-sizing-and-exits
description: Sizes positions from dollar risk and ATR stops and manages exits by R-multiples, trailing, and time stops; load for every order and every open position review.
---

Use when: computing size for any `submit_order` intent, or reviewing how and when to exit an open position.

## Rules

1. Size formula: shares equal risk dollars divided by per-share risk. Risk dollars are the live per-trade risk percent from `get_risk_state` times equity, at risk to invalidation. Per-share risk is entry minus invalidation price, floored at 1.5 times ATR so stops are never tighter than noise.
2. Stops are 1.5 to 2 times ATR from entry for trend trades, under the swing low for pullbacks. The stop distance sets the size, never the reverse. If the computed size breaches the live per-name or per-sector cap from `get_risk_state`, shrink the position; do not widen the stop to fit.
3. Every intent needs invalidationPrice, timeStopDate, probabilityWin, expectedGainPct, expectedLossPct, and estimatedCostPct. Expected value after costs must clear the live multiple of costs from `get_risk_state` or there is no trade, however good the chart.
4. Scale out: sell half at 2R (gain equal to twice the initial per-share risk). Move the stop to breakeven at the same time. Trail the remainder with a 2x ATR stop or the 20-day low, whichever is higher.
5. Time stops: trend trades that make no new 10-day high in 10 sessions exit. Mean-reversion trades exit after 5 sessions (see `etf-mean-reversion`). A minimum hold applies except for stop-driven exits; the risk engine enforces the live value.
6. Never widen a stop, never move a time stop outward, never average down. Changes to exits go one direction only: tighter or earlier.
7. Costs: limit orders near mid and spread tight at entry, within the live gates from `get_risk_state`. If the spread is wider, skip the name; illiquidity is a veto, not a cost to absorb.

## Tool workflow

Whole-share limits and GTC stop-limit exits rest at Robinhood. Fractional limit intents execute as market orders only during regular hours when the fresh quote is inside the limit (ask <= limit for buys, bid >= limit for sells); otherwise they fail rather than rest. Fractional protective sell stops are held by the harness, checked every minute during regular NYSE hours, and sold at market on the trigger. The limit is not a guaranteed fill price; harness downtime, overnight gaps and slippage remain risks. Use `cancel_order` with our order id to cancel protection before another exit or to replace a trailing stop. Loss halts allow protective exits; kill switch and mode off block them.

```js
const risk = await tools.get_risk_state(); // equity, per-trade risk pct, caps, halts
const ind = await tools.market_indicators({ symbol: SYM });
const atrStop = 1.5 * ind.atr14;
const perShareRisk = Math.max(entry - invalidation, atrStop);
const riskDollars = (risk.maxRiskPerTradePct / 100) * risk.equity;
const shares = riskDollars / perShareRisk; // fractional shares allowed: do not round to whole shares
// then check the live per-name and per-sector caps before submit_order
const ev = pWin * expGain - (1 - pWin) * expLoss - cost;
const tradable = ev > 2 * cost;
```

Worked example on a $1,000 account: the live per-trade risk is 1.5% of equity, so $15 at risk. Entry $95 with a $4.50 per-share stop gives $15 / $4.50 = 3.33 shares. But the 30% per-name cap is $300 at current equity, and 3.33 shares cost $316, so the cap binds: 3.16 fractional shares ($300 / $95), risking about $14. Size to the tighter of the two constraints every time.

## Failure modes

- Sizing to a round share count or a notional target and letting risk be whatever results. Risk is the input; shares are the output.
- Taking partial profits before 2R out of relief. The plan sells half at 2R; emotions sell at the first green scroll.
- Holding a flat trade past its time stop because the thesis "still holds." Stale trades consume one of the limited position slots; exit and re-enter only on a fresh trigger.
