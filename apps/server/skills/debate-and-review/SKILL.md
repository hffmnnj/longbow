---
name: debate-and-review
description: Runs bull, bear, and risk_reviewer subagents in parallel before entries and records the verdict; load before every new entry.
---

Use when: a setup passed all other checks and you are one step away from `submit_order`.

## Rules

1. Every entry requires one debate: a bull, a bear, and a risk_reviewer, all launched in parallel from a single Code Mode script with the same evidence packet. No entry proceeds on a single viewpoint.
2. The evidence packet each subagent receives: symbol, setup type, entry, invalidation, target, the 3-plus evidence lines from `news-research`, regime state, and open-risk numbers from `get_risk_state`. Identical inputs; the bear does not get a weaker brief.
3. Weigh by evidence, not eloquence. Score each argument: does it cite a filing, a price level, or a backtest number? An argument with no tier-1 or tier-2 citation counts as rhetoric and loses to any cited fact.
4. The bear's job is to kill the trade: force it to name the specific invalidation the setup ignores, the base rate of this setup failing, and what has to be true for the entry to be wrong. If the bear's kill case cites real evidence, reduce size by half or pass.
5. The risk_reviewer's job is limits, not opinions: caps, halts, day-trade count, spread, blackout windows, correlation with existing positions. A risk_reviewer flag is a hard stop, not a suggestion.
6. Record the verdict with `record_decision`: bull case in one line, bear case in one line, which evidence decided it, and the final size adjustment. If the debate reverses the entry, record that too; killed trades are decisions worth journaling.

## Tool workflow

```js
const packet = { symbol: SYM, setup: "pullback", entry, stop, target,
  evidence: EVIDENCE_LINES, regime, openRisk: risk.openRiskPct };
const [bull, bear, review] = await Promise.all([
  tools.delegate({ role: "bull", task: "Argue for this entry from the packet: " + JSON.stringify(packet), symbol: SYM }),
  tools.delegate({ role: "bear", task: "Kill this entry using the packet; cite evidence: " + JSON.stringify(packet), symbol: SYM }),
  tools.delegate({ role: "risk_reviewer", task: "Check limits and halts for this intent: " + JSON.stringify(packet), symbol: SYM })
]);
// proceed only if review passes and bear's kill case is answered by cited evidence
```

## Failure modes

- Running the debate after mentally committing. If size and direction are fixed before the bear speaks, the debate is theater; run it while passing is still easy.
- Letting the bull's story beat the bear's numbers. A vivid narrative with no citation loses to one cited fact every time.
- Skipping the debate for "obvious" setups or small size. Small obvious losses are how the monthly 6-percent halt gets reached.
