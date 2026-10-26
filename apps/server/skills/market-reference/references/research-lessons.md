# Research lessons from published LLM trading-agent evaluations

All paper-specific claims below are unverified against the original texts; treat them as reported findings to design against, not as established facts. Alpha Arena season 1 (2025) is unverified.

## TradingAgents (multi-agent debate framework, reported 2024)

- Reported finding: splitting research, bull/bear debate, and risk management across roles beat single-agent trading on backtested US equities.
- Lesson applied here: every entry requires a parallel bull, bear, and risk_reviewer debate with identical evidence packets (`debate-and-review`). Weigh cited facts over rhetoric.

## FinMem (memory-augmented agent, reported 2024)

- Reported finding: layered memory (working, short-term, long-term with decay) improved adaptation over memoryless agents.
- Lesson applied here: the journal plus `lessons.md`, `plan.md`, and `watchlist.md` notes are the memory layer. Reviews must write back at most 3 rule-change lines per session or the memory rots.

## FinAgent (multimodal agent, reported 2024)

- Reported finding: combining price, news, and filings inputs beat price-only agents.
- Lesson applied here: entries require tier-1 or tier-2 evidence lines (`news-research`), not chart patterns alone. Unverified web claims never count as evidence.

## FINSABER (reported at KDD 2026, unverified)

- Reported finding: LLM agents are too timid in bull markets (under-sizing valid setups) and too aggressive in bear markets (bargain-hunting into downtrends).
- Lesson applied here: `market-regime` hard-codes the correction with size multipliers per regime and a mandatory journal sentence naming the day's bias direction. Regime gates the setup menu; discretion does not override it.

## StockBench (reported 2025, unverified)

- Reported finding: many published agent results failed to hold up under transaction costs, survivorship-aware data, and regime splits.
- Lesson applied here: every backtest in these skills subtracts explicit costs, requires 30-plus trades before conclusions, and re-runs quarterly. A rule that only worked in one regime is a regime rule, not a general edge.

## Alpha Arena season 1 (2025, unverified)

- Unverified reports describe live LLM trading competitions with wide dispersion between top and median agents, mostly explained by risk control rather than signal quality.
- Lesson applied here, provisional: position sizing, halts, and time stops (`position-sizing-and-exits`, `portfolio-heat`) are treated as the primary edge. Do not trade this finding as fact until verified.

## Mitigations checklist (applies regardless of which findings hold)

1. Costs in every backtest and EV computation.
2. Regime-gated setups with multipliers, re-confirmed on a two-cycle rule.
3. Parallel debate with evidence scoring before entries.
4. Calibration tracking (Brier score) against stated probabilities.
5. Hard halts (the daily-loss and monthly-drawdown halts in `get_risk_state`) that no thesis overrides.
