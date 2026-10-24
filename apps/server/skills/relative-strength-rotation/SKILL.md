---
name: relative-strength-rotation
description: Ranks sectors and leaders by 3- and 6-month relative strength against SPY with market_compare; load for weekly rotation and to confirm leaders.
---

Use when: weekly rotation review, confirming a breakout or pullback candidate is a leader, or deciding which sector a new entry may come from.

## Rules

1. Rank the 11 sector ETFs (XLK, XLF, XLE, XLV, XLY, XLP, XLI, XLU, XLB, XLRE, XLC) by 3-month and 6-month relative strength against SPY using `market_compare` with benchmark SPY. New entries come from the top 4 sectors only.
2. A leader must show positive relative strength on both the 3-month and 6-month windows and a correlation to SPY below 0.95 (above that it is a tracker, not a leader). Both windows avoids one-month wonders.
3. Rotation cadence: full ranking once a week, same day. Mid-week re-ranks happen only after a 5-percent index move or a regime change. Daily rotation is churn; the live sector cap already limits concentration.
4. Within a qualifying sector, rank candidates the same way against SPY and take only the top 3 names per sector. A fifth idea in a hot sector still respects the live position cap and the live entries-per-day cap in `get_risk_state`.
5. Demotion rule: a sector falling out of the top 6 on both windows loses eligibility for new entries immediately. Existing positions stay under their own stops; rotation gates entries, not exits. Promoted sectors need one full week in the top 4 before supplying entries, so rankings prove sticky rather than spiky.
6. Bear rule: in bear-high-vol there is no rotation into strength. Cash and short-duration safety is the position; relative strength only decides what to buy when the regime turns.

## Tool workflow

```js
const sectors = ["XLK","XLF","XLE","XLV","XLY","XLP","XLI","XLU","XLB","XLRE","XLC"];
const cmp = await tools.market_compare({ symbols: sectors, range: "6m", benchmark: "SPY" });
const leaders = cmp.rows
  .filter(r => r.relativeStrengthPct > 0 && r.correlation < 0.95)
  .sort((a, b) => b.relativeStrengthPct - a.relativeStrengthPct)
  .slice(0, 4);
// confirm a single name the same way before entry
const one = await tools.market_compare({ symbols: [SYM], range: "3m", benchmark: "SPY" });
```

## Failure modes

- Buying the strongest one-day sector. Rotation uses 3- and 6-month windows precisely to ignore daily noise.
- Concentrating every slot in one hot sector. The live sector cap exists because leadership rotates without warning.
- Keeping a demoted-sector watchlist alive out of habit. Rebuild the candidate list from the ranking every week.
