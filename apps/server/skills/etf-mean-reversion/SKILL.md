---
name: etf-mean-reversion
description: Buys short-term washed-out dips in broad index ETFs trading above their 200-day with strict time stops; load only for oversold index ETFs, never single stocks.
---

Use when: a broad index ETF (SPY, QQQ, DIA, IWM only) has sold off sharply but remains above its 200-day average.

## Rules

1. Universe is fixed: SPY, QQQ, DIA, IWM. Never run this setup on single names, leveraged ETFs, or sector ETFs. Single names have gap risk that breaks the statistics.
2. Long-term filter: close above the 200-day SMA. Below it, oversold gets more oversold; the setup is off.
3. Entry trigger (either): 2-day RSI below 15, or a close at a 5-day low while the 200-day filter holds. Compute RSI(2) from `market_price_history` bars with the recipe below.
4. Time stop, no exceptions: exit after 5 sessions whether or not the stop or target hit. Mean reversion either works fast or it was not mean reversion.
5. Stop: 2 times ATR below entry. Expected gain on the backtest must still clear the risk-engine bar (expected value after costs above twice the costs) at this stop distance.
6. Position size is half a normal trend position even when the backtest looks good. Reversion tails are fat; size for the tail, not the average.
7. Before first use on any ETF, and once a quarter after, run the historical recipe below over 2 to 5 years of daily bars. If the win rate is under 55 percent or the average return per trade is negative after costs, the setup is suspended for that ETF until next quarter.

## Backtest recipe (run before using)

```js
function rsi(closes, n) {
  let g = 0, l = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  if (l === 0) return 100;
  const rs = (g / n) / (l / n);
  return 100 - 100 / (1 + rs);
}
const h = await tools.market_price_history({ symbol: "SPY", range: "5y" });
const bars = h.bars;
let wins = 0, n = 0, totalRet = 0;
const sma = (arr, k) => arr.slice(-k).reduce((a, b) => a + b, 0) / k;
for (let i = 210; i < bars.length - 5; i++) {
  const closes = bars.slice(0, i + 1).map(b => b.close);
  const lows = bars.slice(i - 4, i + 1).map(b => b.close);
  const above200 = closes[i] > sma(closes.slice(0, i + 1), 200);
  const r2 = rsi(closes.slice(-30), 2);
  const fiveDayLow = closes[i] === Math.min(...lows);
  if (above200 && (r2 < 15 || fiveDayLow)) {
    const ret = (bars[i + 5].close - bars[i].close) / bars[i].close;
    n++; totalRet += ret; if (ret > 0.002) wins++; // 20 bps cost hurdle
  }
}
const winRate = n ? wins / n : 0, avgRet = n ? totalRet / n : 0;
// Require winRate >= 0.55 and avgRet > 0 before trading this ETF.
```

## Failure modes

- Running it below the 200-day because the RSI is extreme. That is catching a falling market, not reversion.
- Holding past the time stop hoping for the bounce. Hope is not in the backtest.
- Porting a good SPY backtest to a single stock. The statistics do not transfer; run each ETF separately.
