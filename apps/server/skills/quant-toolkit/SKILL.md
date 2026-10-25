---
name: quant-toolkit
description: Evidence-first trading loop with the quant tools (screen, backtest, risk, size); load before picking entries, adding risk, or sizing orders.
---

Use when: choosing what to buy, checking whether a setup has a base rate, adding to portfolio risk, or sizing any entry. The loop is screen for candidates, backtest the setup's base rate before trusting it, check portfolio risk before adding, size every entry with size_position.

## Rules

1. Screen first, decide second. Run `market_screen` for the setup you actually want (trend_template, breakout_52w, pullback_20d, rsi_oversold_uptrend, relative_strength, volatility_contraction) instead of hand-picking tickers. The text is a summary; do the math on the structured rows.
2. No setup without a base rate. Before trading a screened name, run `quant_backtest` on the same entry over 3 years and read the pooled stats: win rate, average R, expectancy, profit factor, and max drawdown in R. Fewer than 30 pooled trades is suggestive, not conclusive; say so in the thesis.
3. No add without portfolio risk. Call `portfolio_risk` with the candidate and its notional; report beta, VaR, the top correlation, and any sector over its cap. A candidate that pushes a sector over the cap or doubles the top correlation needs a better reason.
4. Size every entry. Call `size_position` with the entry and stop (or let it derive the stop from 2x ATR) and use a quantity at or under what it returns. Name the binding cap in the order evidence.
5. Costs are part of the signal. Backtests already subtract costBps per side; when you write your own script math, subtract 5 bps per side unless the spread check says otherwise.

## Recipes

Screen, backtest the winners, size one:

```js
// 1. Candidates: trend-template names near their highs.
const screen = await tools.market_screen({ preset: "trend_template", limit: 10 });
const names = screen.rows.map(r => r.symbol);

// 2. Base rate: 3-year breakout backtest on the top names.
const bt = await tools.quant_backtest({ symbols: names.slice(0, 5), entry: "breakout_20d", years: 3 });
if (bt.pooled.warning) notes = bt.pooled.warning; // under 30 trades: suggestive only

// 3. Risk before adding: what does $200 of the best name do?
const top = screen.rows[0];
const risk = await tools.portfolio_risk({ candidate: { symbol: top.symbol, notional: 200 } });

// 4. Size the entry with a 2x ATR stop.
const sized = await tools.size_position({ symbol: top.symbol, entry: top.last });
return { pick: top.symbol, trades: bt.pooled.trades, avgR: bt.pooled.avgR,
  beta: risk.beta, varDollars: risk.var95.dollars, qty: sized.quantity, boundBy: sized.boundBy };
```

Relative-strength rotation check:

```js
const rs = await tools.market_screen({ preset: "relative_strength", limit: 15 });
const laggards = rs.rows.filter(r => (r.relStrength ?? 0) < -0.1);
return laggards.map(r => ({ symbol: r.symbol, relStrength3m: r.relStrength, below50: !r.above50 }));
```

## Failure modes

- Trading a screen row without a backtest. The screen is a filter, not an edge; the pooled expectancy is the edge.
- Trusting a 12-trade backtest. Small samples lie; combine symbols or widen years until the pool clears 30, or label the idea experimental.
- Sizing from equity while ignoring the binding cap. When `boundBy` is notional_cap or buying_power, the account is the constraint; adding more names will not fix it.
- Citing prices from memory in blind runs. Symbols may be aliases and prices rescaled; every number in the thesis comes from a tool output, never from training data.
