---
name: trend-breakout
description: Trades 20-day and 52-week high breakouts in leading stocks with volume confirmation and ATR stops; load when the regime allows breakouts.
---

Use when: regime is bull-low-vol or bull-normal-vol, and a watchlist name is at or near its 20-day high or 52-week high.

## Rules

1. Only trade breakouts in leaders: the name must have positive 3-month and 6-month relative strength against SPY (see `relative-strength-rotation`) and average dollar volume above $10M a day. No thin breakouts.
2. Entry trigger: a daily close above the 20-day high (donchian20.high from `market_indicators`) or above the 52-week high. Intraday pokes that close back inside the range do not count.
3. Volume confirmation: breakout-day volume at least 1.5 times the 20-session average. Compute the average from `market_price_history` bars. A high close on weak volume is a pass.
4. Base-tightness filter: the 20 daily closes before the breakout must span a range of less than 12 percent from low to high. Wide, sloppy bases fail twice as often; skip them.
5. Stop: the greater of 2 times ATR below the breakout level and just under the most recent swing low. Never widen it. Invalidation price for `submit_order` is this stop.
6. Failed-breakout exit: if price closes back below the breakout level within 3 sessions, exit the next session open regardless of the stop. A breakout that cannot hold its level is information.
7. Target: scale out half at 2R (see `position-sizing-and-exits`) and trail the rest with a 2x ATR stop. One breakout, one entry; no adding on the same breakout.

## Tool workflow

```js
const ind = await tools.market_indicators({ symbol: SYM });
const h = await tools.market_price_history({ symbol: SYM, range: "3m" });
const bars = h.bars;
const vols = bars.slice(-21, -1).map(b => b.volume);
const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
const last20 = bars.slice(-21, -1).map(b => b.close);
const baseRange = (Math.max(...last20) - Math.min(...last20)) / Math.min(...last20);
const breakout = ind.close > ind.donchian20.high * 0.999
  && bars[bars.length-1].volume > 1.5 * avgVol
  && baseRange < 0.12;
const stop = Math.min(ind.close - 2 * ind.atr14, Math.min(...bars.slice(-10).map(b => b.low)));
```

## Failure modes

- Buying the first touch of the high without waiting for the close. Most false breakouts reverse intraday.
- Accepting weak volume because the story is good. Volume is the confirmation, not the narrative.
- Moving the stop to the 50-day "to give it room." The room was priced into the position size; widening converts a planned loss into an unplanned one.
- Chasing more than 3 percent above the breakout level. Extended breakouts get bought late; wait for the first pullback instead.
