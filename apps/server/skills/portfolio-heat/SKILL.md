---
name: portfolio-heat
description: Measures total open risk, correlation clusters, and sector exposure and forces reductions before limits bind; load when considering entries and during position reviews.
---

Use when: before any new entry, when open risk feels high, or after a regime change toward caution.

## Rules

1. Total open risk is the sum over positions of (current price minus stop) times shares, divided by equity. Hard ceiling: 3 percent of equity (about $36 on a $1,200 account). If a new entry would push heat above the ceiling, the entry waits for an exit or a tighter stop, in that order.
2. Correlation clusters: run `market_compare` on all open symbols plus SPY. Any pair with correlation above 0.8 counts as one position for heat purposes: sum their risks and apply the live per-name cap from `get_risk_state` to the cluster. Two semicon shorts are one bet wearing two tickers.
3. Sector exposure: sum position notionals by sector against the live sector cap from `get_risk_state` before every entry. A new entry that breaches the sector cap is rejected even if heat and name caps pass.
4. Reduction order when heat or a halt approaches: first cut the position closest to its stop (the market is already questioning it), then the lowest relative-strength name, then the newest entry. Never cut the strongest leader first to "protect gains elsewhere."
5. After any single-day portfolio loss of 1 percent or more, recompute heat before the next entry and halve the size multiplier for the rest of the day. The daily-loss halt in `get_risk_state` is a wall, not a target; this rule keeps distance from it.
6. Cash is a position. In sideways and correction regimes, heat below 1 percent with a clean watchlist is correct posture, not underperformance.

## Tool workflow

```js
const risk = await tools.get_risk_state();
const pos = await tools.rh_positions({}); // discover exact rh_* names at runtime
const cmp = await tools.market_compare({ symbols: pos.symbols, range: "3m", benchmark: "SPY" });
let heat = 0;
for (const p of pos.list) heat += Math.max(0, p.price - p.stop) * p.qty / risk.equity;
// heat <= 0.03, cluster pairs with correlation > 0.8, sector sums within the live cap
```

## Failure modes

- Counting positions instead of risk. A portfolio at the position cap of tiny positions and one at the cap of max-risk positions read the same on count, but only heat tells which portfolio you hold.
- Treating correlated names as diversification. Same-factor exposure in different tickers fails together.
- Adding to heat after a loss to "make it back." The halved-multiplier rule after a 1-percent day exists because revenge sizing is the fastest path to the daily-loss halt.
