---
name: market-reference
description: Covers settlement, trading rules, the NYSE calendar, data limits, and published LLM-trading findings; load when a rule, date, or tool limit is unclear.
---

Use when: any question about pattern day trading, settlement, wash sales, holidays, what a tool does not provide, or what published agent evaluations found.

## Rules

1. Pattern day trading: the SEC approved FINRA's Rule 4210 amendments on April 14, 2026, eliminating the pattern day trader designation and the $25,000 minimum equity requirement and replacing day-trading margin with an intraday margin standard. Effective June 4, 2026, with member phase-in until October 20, 2027 (FINRA Regulatory Notice 26-10). Until your broker confirms it has cut over, behave as if the old 3-day-trades-in-5-days flag still exists: this system's own cap is 3 day trades in 5 business days regardless.
2. T+1 settlement (unverified against a primary source; confirm at sec.gov): stock trades settle the next business day. Proceeds from a sale are generally unavailable for withdrawal until settlement, and spending unsettled funds triggers good-faith violations in cash accounts. Three violations in 12 months typically brings a 90-day restriction.
3. Wash sales (unverified against a primary source; confirm at irs.gov): a loss is disallowed if you buy a substantially identical security 30 days before or after the sale at a loss. The disallowed loss adjusts the replacement shares' basis; it is not permanently lost, but it wrecks R-multiple accounting if ignored.
4. NYSE calendar: full holiday and early-close tables live in `references/nyse-calendar.md`. Never assume a Friday is a full session; check the file.
5. Tool limits (`references/data-sources.md`): daily bars only, no intraday; missing values come back null; the economic calendar may be unavailable. Design every check to degrade cleanly on nulls: a missing field fails closed and blocks the dependent setup rather than defaulting to zero.
6. Published findings (`references/research-lessons.md`): LLM trading agents show regime-dependent overconfidence and need explicit sizing governors. Read the mitigations before trusting any backtest or debate output, and re-read them whenever a backtest looks surprisingly good.

## Tool workflow

```js
// before any session with an uncertain date:
const day = await tools.notes_read({ path: "plan.md" }); // session date + holiday check
```

## Failure modes

- Assuming the broker already cut over to intraday margin. The phase-in runs to October 2027; verify with the broker, default to the stricter old counting.
- Ignoring wash-sale basis adjustments in the journal. Phantom losses corrupt calibration.
- Trading a half day like a full day. Early closes compress volume patterns and invalidate breakout confirmations.
