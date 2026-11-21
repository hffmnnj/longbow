---
name: trade-review-and-calibration
description: Reviews closed trades on R-multiples, MFE/MAE, and Brier scores and writes lessons back to memory; load at each post-close review.
---

Use when: after the close, reviewing the day's closed trades, or during the weekly calibration pass.

System One: Jev probabilities are not guarantees and never predict direction; see the system-one skill for the reading thresholds.

## Rules

1. Score every closed trade in R-multiples: actual P&L divided by the initial dollar risk. Wins below 1R after fees are execution failures even when green. Losses at exactly -1R are the system working.
2. Record MFE (maximum favorable excursion) and MAE (maximum adverse excursion) in R for each trade. Persistent pattern rules: if winners routinely reach 3R MFE but get sold at 1R, exits are too tight; if losers routinely touch -0.5R MAE before winning, entries are early.
3. Calibration: `probabilityWin` forecasts the target being reached before invalidation, not a profitable exit. Score only forecasts with a target, invalidation, and observation window fixed in advance, and enough dated evidence to resolve that event. Use 1 when the target was reached first and 0 when invalidation came first or the fully observed window ended without reaching the target. Leave missing inputs, incomplete windows, and a daily bar touching both levels with unknown order unscored. Report resolved and unscored counts with any Brier score or probability buckets. A rising Brier score alone does not identify overconfidence; do not automatically change probabilities or trading rules from it.
4. Overtrading checks: entries beyond the live entries-per-day cap in `get_risk_state` violate it, so any week with 8-plus entries gets a review of which setups were marginal. Correlate losing streaks with regime: losses cluster in sideways and correction regimes means the regime gate was ignored, not that the setups broke.
5. Every review appends at most 3 lines to `lessons.md` via notes tools. Lessons state the pattern, the evidence, and the rule change: "Breakouts bought >3% above level fail; added extension filter." No essays, no restatements of feelings.
6. Update `plan.md` watchlist notes: demote setups with two consecutive -1R outcomes to paper-only for a month. The setup earns its way back with the backtest, not with opinions.

## Tool workflow

```js
const r = pnl / initialRisk; // R-multiple
const resolved = forecasts.filter((f) => Number.isFinite(f.pWin) && f.pWin >= 0 && f.pWin <= 1 &&
  (f.targetBeforeInvalidation === 1 || f.targetBeforeInvalidation === 0));
const brier = resolved.length ? resolved.reduce((a, f) => a + (f.pWin - f.targetBeforeInvalidation) ** 2, 0) / resolved.length : undefined;
await tools.notes_append({ path: "lessons.md", text: "- Pattern | evidence | rule change" });
// use notes_read on plan.md / watchlist.md, notes_write to update demotions
```

## Failure modes

- Reviewing only losers. Winners teach exit discipline; skipped winner reviews hide the "sold at 1R, ran to 4R" leak.
- Rewriting rules after one trade. Single outcomes are noise; rule changes need at least 5 similar outcomes or a clear mechanism break.
- Letting lessons.md grow into a diary. Three lines per review, each with a rule change, or the file stops being read.
