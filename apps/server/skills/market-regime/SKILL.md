---
name: market-regime
description: Classifies the market trend and volatility regime from SPY, QQQ, VIX, and yields; load at the start of every cycle to set exposure and allowed setups.
---

Use when: at the start of every trading cycle, before scanning for setups or sizing anything.

System One: take a `jev_regime` second read beside this classification. When it disagrees, decide from the data in rules 1 to 6 and say why; do not automatically adopt the more cautious read.

## Rules

1. Pull `market_indicators` for SPY and QQQ, plus `market_volatility` and `market_yields`. These four calls are the regime input. Nothing else overrides them.
2. Trend state per index comes from its 50-day vs 200-day SMA and price position:
   - Bull: price above rising 50-day, 50-day above 200-day.
   - Bear: price below falling 50-day, 50-day below 200-day.
   - Anything else is sideways. Do not round sideways up to bull.
3. Volatility state from VIX level, its one-year percentile, and whether VIX is above or below its 20-day SMA. VIX above 25 or above its 80th percentile is high. VIX below 15 and under its 20-day SMA is low. Between is normal.
4. Yield check: note the 10-year level, its 20-day change, and the 2s10s and 3m10y spreads. A rapidly rising 10-year (up more than 50 bps in 20 sessions) or an inverted curve that is reinverting after normalizing is a risk-off flag, not a number to trade directly.
5. Breadth check: count how many of XLK, XLF, XLE, XLV, XLY, XLP, XLI, XLU, XLB, XLRE, XLC sit above their 50-day average. Seven or more is broad participation. Three or fewer is narrow leadership and fragile.
6. Map to one regime: bull-low-vol, bull-normal-vol, sideways, correction (SPY 5 to 10 percent off the 52-week high), or bear-high-vol.

## Exposure and setup map

The invested target applies to the core book of quality companies (see the trader prompt Strategy section); the setup notes apply to the tactical sleeve.

- Bull-low-vol: invested 80 to 95 percent. Tactical breakouts and pullbacks allowed.
- Bull-normal-vol: invested 80 to 90 percent. Tactical pullbacks first, breakouts only in top relative-strength names.
- Sideways: invested 65 to 80 percent. Tactical mean-reversion only, no breakouts.
- Correction (SPY 5 to 10 percent off its high, not disorderly): invested 50 to 70 percent. Add quality core names in tranches on weakness; no tactical breakouts.
- Bear-high-vol: invested 25 to 40 percent. Hold the strongest core names, no new buys while it lasts, exits as their stops dictate.

## Correcting the LLM bias

7. FINSABER (KDD 2026, unverified detail) found LLM agents are too timid in bull markets and too aggressive in bear markets. Counter it explicitly: in bull and sideways regimes you must reach the invested target rather than waiting for certainty, and in bear-high-vol you must not bargain-hunt. Write one sentence in the journal stating which direction you are biased against today and what you did about it.
8. Never change a regime on one day's move. A regime change requires two consecutive pre-open reads confirming the new state, except bear-high-vol, which takes effect immediately and also needs two reads to leave.

## Tool workflow

```js
const [spy, qqq, vol, y] = await Promise.all([
  tools.market_indicators({ symbol: "SPY" }),
  tools.market_indicators({ symbol: "QQQ" }),
  tools.market_volatility({}),
  tools.market_yields({})
]);
const etfs = ["XLK","XLF","XLE","XLV","XLY","XLP","XLI","XLU","XLB","XLRE","XLC"];
const states = await Promise.all(etfs.map(s => tools.market_indicators({ symbol: s })));
const above50 = states.filter((s, i) => s.close > s.sma50).length;
// above50 >= 7 broad; <= 3 narrow
```

## Failure modes

- Trading a breakout in a sideways regime because the chart looks clean. Regime gates the setup menu, not the chart.
- Using a single VIX print instead of level plus percentile plus trend. A VIX of 18 falling is different from 18 rising.
- Reclassifying mid-cycle because a position is losing. Regime is portfolio-level and changes only on the two-cycle rule.
