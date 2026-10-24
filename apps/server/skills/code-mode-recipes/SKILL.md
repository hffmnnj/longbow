---
name: code-mode-recipes
description: Provides tested JavaScript patterns for the sandbox: parallel fetches, custom indicators, backtests, watchlist scans, and compact summaries; load before writing any trading script.
---

Use when: writing any Code Mode script that calls market tools, computes indicators, backtests a rule, or scans names.

## Rules

1. Fetch in parallel with `Promise.all`. Sequential symbol loops waste the model's waiting budget; batch independent calls and compute after.
2. Indicators the tools do not provide (RSI(2), true range series, swing highs, SMA slopes) are computed in-script from `market_price_history` bars. Never approximate them from the snapshot fields; download the bars.
3. Backtests are vectorized loops over bars with explicit costs: subtract 20 bps per round trip unless the spread check says otherwise. Report trade count, win rate, average return, and max drawdown of the equity curve. Fewer than 30 trades means the result is suggestive, not conclusive.
4. Summarize compactly. Return arrays of `{ symbol, setup, entry, stop, score }` and one-line reasons, not bar dumps. The model's context is the scarcest resource; spend it on decisions.
5. Discover exact Robinhood tool names at runtime with Code Mode's `searchTools()` before calling them; only the `market_*`, `get_risk_state`, `submit_order`, notes, and `delegate` names in the environment brief are stable.

## Recipes

Parallel fetch plus RSI(2) scan:

```js
const syms = ["AAPL", "MSFT", "NVDA", "AVGO", "META"];
const data = await Promise.all(syms.map(s => tools.market_price_history({ symbol: s, range: "1y" })));
function rsi2(closes) {
  let g = 0, l = 0;
  for (let i = closes.length - 2; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  if (l === 0) return 100;
  return 100 - 100 / (1 + (g / 2) / (l / 2));
}
const scanned = data.map(h => {
  const c = h.bars.map(b => b.close);
  return { symbol: h.symbol, last: c[c.length - 1], rsi2: rsi2(c) };
});
```

Vectorized backtest loop with costs:

```js
const h = await tools.market_price_history({ symbol: SYM, range: "2y" });
const bars = h.bars, COST = 0.002;
let eq = 1, peak = 1, maxDD = 0, wins = 0, n = 0, tot = 0;
for (let i = 50; i < bars.length - 5; i++) {
  if (!entrySignal(bars.slice(0, i + 1))) continue;
  const ret = (bars[i + 5].close - bars[i].close) / bars[i].close - COST;
  n++; tot += ret; if (ret > 0) wins++;
  eq *= (1 + ret); peak = Math.max(peak, eq);
  maxDD = Math.min(maxDD, eq / peak - 1);
}
return { trades: n, winRate: n ? wins / n : 0, avgRet: n ? tot / n : 0, maxDD };
```

Breakout check plus compact watchlist summary:

```js
const inds = await Promise.all(syms.map(s => tools.market_indicators({ symbol: s })));
const setups = inds
  .filter(x => x.close > x.donchian20.high * 0.995 && x.avgDollarVolume20 > 1e7)
  .map(x => ({ symbol: x.symbol, setup: "breakout", entry: x.close,
    stop: x.close - 2 * x.atr14, score: x.ret3m + x.ret6m }));
return setups.slice(0, 5);
```

## Failure modes

- Awaiting inside a for-loop over symbols. Parallelize or the cycle times out before deciding.
- Backtesting without costs. A 55-percent win rate at thin margins is a loss after spreads; costs are part of the signal.
- Returning full bar arrays to the model. Aggregate in-script; report the table, not the tape.
