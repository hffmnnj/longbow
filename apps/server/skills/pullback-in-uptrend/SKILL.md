---
name: pullback-in-uptrend
description: Buys pullbacks to the 20-day EMA or 50-day SMA in confirmed uptrends with RSI and depth filters; load when a leader has sold off toward support.
---

Use when: a stock in a confirmed uptrend has pulled back to a rising moving average and you need entry, depth, and stop criteria.

## Rules

1. Uptrend definition, all required: price above the 50-day SMA, 50-day above the 200-day, 50-day SMA itself rising over the last 10 sessions, and positive 3-month relative strength vs SPY. Missing any one means this is not a pullback, it is a topping or broken name.
2. Buy zone: touches or undercuts the 20-day EMA by no more than 1 ATR, or touches the 50-day SMA. The first touch after at least 10 sessions away from the average is the highest quality; third and later touches weaken.
3. RSI filter: 14-day RSI between 30 and 55 on the pullback day. Above 55 means it has not pulled back enough. Below 30 means momentum has broken and this belongs to mean-reversion or no-trade, not to this skill.
4. Depth limit: the pullback from the swing high must be less than 12 percent and less than 3 times ATR. Deeper selloffs break the structure this setup assumes.
5. Stop: below the pullback-day low minus 0.5 ATR. This is a tight stop by design; the size comes from `position-sizing-and-exits` so the dollar risk stays at 1 percent of equity.
6. Entry timing: buy the first daily close that holds above the average after the touch, not the touch itself. Falling knives have no confirmation; one stable close is the confirmation.
7. Time stop: if the name does not make a new 10-day high within 10 sessions of entry, exit. Pullbacks that sit are distribution.

## Tool workflow

```js
const ind = await tools.market_indicators({ symbol: SYM });
const h = await tools.market_price_history({ symbol: SYM, range: "6m" });
const bars = h.bars, prev = bars[bars.length - 2];
const uptrend = ind.close > ind.sma50 && ind.sma50 > ind.sma200
  && ind.ret3m > 0; // plus: sma50 rising, checked from bars
const nearEMA20 = Math.abs(prev.close - ind.ema20) / ind.atr14 <= 1.0;
const nearSMA50 = prev.low <= ind.sma50 && prev.close >= ind.sma50 * 0.99;
const rsiOk = ind.rsi14 >= 30 && ind.rsi14 <= 55;
const swingHigh = Math.max(...bars.slice(-20).map(b => b.high));
const depthOk = (swingHigh - prev.close) / swingHigh < 0.12;
const setup = uptrend && (nearEMA20 || nearSMA50) && rsiOk && depthOk;
const stop = Math.min(...bars.slice(-3).map(b => b.low)) - 0.5 * ind.atr14;
```

## Failure modes

- Averaging down when the pullback keeps falling through the average. One entry, one stop; a second leg down is a different setup or a failed one.
- Confusing a pullback with a breakdown: price under a falling 50-day is never this setup, however oversold it looks.
- Skipping the RSI check and buying strength at the average. Pullback entries need the washout; without it the edge is gone.
