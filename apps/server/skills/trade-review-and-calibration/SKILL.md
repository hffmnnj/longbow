---
name: trade-review-and-calibration
description: Reviews closed trades on R-multiples, MFE/MAE, and Brier scores and writes lessons back to memory; load at each post-close review.
---

Use when: after the close, reviewing the day's closed trades, or during the weekly calibration pass.

System One: Jev probabilities are not guarantees and never predict direction; see the system-one skill for the reading thresholds.

## Rules

1. Score every closed trade in R-multiples: actual P&L divided by the initial dollar risk. Wins below 1R after fees are execution failures even when green. Losses at exactly -1R are the system working.
2. Record MFE (maximum favorable excursion) and MAE (maximum adverse excursion) in R for each trade. Persistent pattern rules: if winners routinely reach 3R MFE but get sold at 1R, exits are too tight; if losers routinely touch -0.5R MAE before winning, entries are early.
3. Calibration: compare stated probabilityWin against realized outcomes in buckets (40-50, 50-60, 60-70, 70+ percent). Compute the Brier score: mean of squared (stated probability minus outcome, 1 for win, 0 for loss). Track it weekly; a rising Brier score means overconfidence and requires cutting stated probabilities by 10 points until it stabilizes.
4. Overtrading checks: entries beyond the live entries-per-day cap in `get_risk_state` violate it, so any week with 8-plus entries gets a review of which setups were marginal. Correlate losing streaks with regime: losses cluster in sideways and correction regimes means the regime gate was ignored, not that the setups broke.
5. Every review appends at most 3 lines to `lessons.md` via notes tools. Lessons state the pattern, the evidence, and the rule change: "Breakouts bought >3% above level fail; added extension filter." No essays, no restatements of feelings.
6. Update `plan.md` watchlist notes: demote setups with two consecutive -1R outcomes to paper-only for a month. The setup earns its way back with the backtest, not with opinions.

## Tool workflow

```js
const r = pnl / initialRisk; // R-multiple
const brier = trades.reduce((a, t) => a + (t.pWin - (t.pnl > 0 ? 1 : 0)) ** 2, 0) / trades.length;
await tools.notes_append({ path: "lessons.md", text: "- Pattern | evidence | rule change" });
// use notes_read on plan.md / watchlist.md, notes_write to update demotions
```

## Failure modes

- Reviewing only losers. Winners teach exit discipline; skipped winner reviews hide the "sold at 1R, ran to 4R" leak.
- Rewriting rules after one trade. Single outcomes are noise; rule changes need at least 5 similar outcomes or a clear mechanism break.
- Letting lessons.md grow into a diary. Three lines per review, each with a rule change, or the file stops being read.
