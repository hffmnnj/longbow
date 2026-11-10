---
name: portfolio-heat
description: Measures total open risk, correlation clusters, and sector exposure and forces reductions before limits bind; load when considering entries and during position reviews.
---

Use when: before any new entry, when open risk feels high, or after a regime change toward caution.

## Rules

1. Total open risk is the sum over positions of (current price minus stop) times shares, divided by equity. Ceiling: about 12 percent of equity (roughly four full-risk positions, or more smaller ones), lowered to 6 percent in bear-high-vol. If a new entry would push heat above the ceiling, size it down to fit or wait for an exit. Owner-ordered positions without stops are not counted as heat; note their notional separately.
2. Correlation clusters: run `market_compare` on all open symbols plus SPY. Any pair with correlation above 0.8 counts as one position for heat purposes: sum their risks and apply the live per-name cap from `get_risk_state` to the cluster. Two semicon shorts are one bet wearing two tickers.
3. Sector exposure: sum position notionals by sector against the live sector cap from `get_risk_state` before every entry. A new entry that breaches the sector cap is rejected even if heat and name caps pass.
4. Reduction order when heat or a halt approaches: first cut the position closest to its stop (the market is already questioning it), then the lowest relative-strength name, then the newest entry. Never cut the strongest leader first to "protect gains elsewhere."
5. After a single-day portfolio loss of 2 percent or more, recompute heat before the next entry and defer new names (not later tranches of held quality names) to the next day. The daily-loss halt in `get_risk_state` is a wall, not a target.
6. Cash is a position, and usually a losing one against the benchmark. Compare invested exposure with the regime target in the trader prompt; being far below it is a posture problem to fix, not a safe default.

## Tool workflow

```js
const risk = await tools.get_risk_state();
const pos = await tools.rh_positions({}); // discover exact rh_* names at runtime
const cmp = await tools.market_compare({ symbols: pos.symbols, range: "3m", benchmark: "SPY" });
let heat = 0;
for (const p of pos.list) heat += Math.max(0, p.price - p.stop) * p.qty / risk.equity;
// heat <= 0.12 (0.06 in bear-high-vol), cluster pairs with correlation > 0.8, sector sums within the live cap
```

## Failure modes

- Counting positions instead of risk. A portfolio at the position cap of tiny positions and one at the cap of max-risk positions read the same on count, but only heat tells which portfolio you hold.
- Treating correlated names as diversification. Same-factor exposure in different tickers fails together.
- Adding to heat after a loss to "make it back." The halved-multiplier rule after a 1-percent day exists because revenge sizing is the fastest path to the daily-loss halt.
