# System One (Jev) in Longbow

Longbow's lead agent is a slow, deliberate reasoner (System 2). System One adds the fast half: a decision model that reads structured state and answers typed questions with calibrated probabilities in about 150 ms for a fraction of a cent. The lead agent keeps the judgment. Jev does the many small gut-checks around it.

## What Jev is (research, 2026-10-26)

- TypeSafe AI's Jev, released 2026-09-15, is the first "System One" model. Input is text or JSON `state` plus typed `questions`. Output is typed answers and probabilities, never prose. It cannot be prompt-injected into acting, because it only emits numbers.
- Question types: `noul` (probability of yes, 0 to 1, no confidence field), `choice` (option, probabilities, confidence), `score` (expected zero-based level, probabilities, confidence). All questions in one request run in parallel against one state.
- Confidence for choice and score is derived from the probabilities. TypeSafe's own pattern is confidence-gated routing: high confidence acts, medium asks or flags, low does not act. Thresholds scale with the stakes.
- Models: `jev-1.14.0` (2026-10-14, `jev-latest`) and `jev-1.13.0`. Price $0.042 per million input tokens, output free. Context 64k per request, 32k per question. Latency 70 to 500 ms; we measured 147 ms.
- Endpoints: TypeSafe `POST https://api.typesafe.ai/v1/systemone`; OpenCode proxy `POST https://opencode.ai/inference/systemone/v1/systemone` with `jev-1.13` (paid) and `jev-1.13-free` (limited-time free tier).
- Known jaggedness (jev-1.13 docs, reviewed 2026-10-02): literal reading, no reliable arithmetic or counting, weak date comparison, weaker with large noisy state, sensitive to option order. TypeSafe's guidance: keep math in code, pass named buckets, ask atomic questions, decompose, combine in code.

## What the benchmark does and does not say

TradeRank lists Jev at rank 4 of 22 in the live competition (return +0.89%, Sharpe 0.62, 2 trades), behind GPT-6.1 Sol Pro, Muse Spark 1.3 and Claude Opus 5.5. TradeRank enters it as "a measured baseline rather than a contender", and its own report ([What Is Jev?](https://www.traderank.ai/blog/what-is-jev-typesafe), 2026-09-18) is blunt about why:

- Over 142 daily cycles (2026-02-02 to 2026-06-23) its next-day direction beat a drift formula on 66 days and lost on 60 (p = 0.66): no directional edge. Hit rate 0.493 against 0.487 for drift.
- It is overconfident: Brier 0.306 against 0.25 for a coin flip, and its 80% range held the outcome 68% of the time.
- Its expected move tracked the trailing 20-day return (correlation 0.67) and not the realized move (0.06): it reads recent momentum.
- It is not deterministic. Five identical requests differed by up to 0.07 in probability, so TradeRank averages five samples before acting.
- Backtest profit swung from +17.52% to -17.35% on two runs of the same model over the same window. Treat that as noise.

So Jev must not forecast price, size, or place trades. What it offers is speed (90 to 230 ms measured here), price, a typed interface that cannot be prompt-injected into acting, and decent semantic judgment on text and structured facts. That is why it sits beside the lead agent and the risk engine and is used for classification, triage, consistency checks and reading text. Two consequences are built in: decisions that gate or advise on a threshold average three fresh samples (`systemone/sampling.ts`) instead of trusting one draw, and no tool asks Jev for a price direction. The `extended` question in `jev_candidates` leans on its momentum reading on purpose.

## Design

Code stays in control. Every threshold lives in code, every number is computed in code and handed to Jev as a named bucket, and Jev's answers are inputs to deterministic rules.

1. **Client** (`apps/server/src/systemone/client.ts`): typed, never throws, circuit breaker for quota (`rate_limited`) and funds (`payment`), 10 minute cache, concurrency cap, call stats. Status appears in `GET /api/status` as `systemOne`.
2. **Agent tools** (Code Mode, read-only so subagents get them too): `jev_decide` (generic typed questions), `jev_candidates` (triage screened names), `jev_read_text` (classify news, filings and pages, and flag text that addresses an AI agent), `jev_thesis_check` (has news or price broken a held thesis), `jev_regime` (classify the market regime from computed buckets), `jev_status`.
3. **Entry second opinion** in the order gate: after the risk engine approves an entry, Jev reviews the intent's thesis against its own evidence list. The review averages three fresh samples. Result is a `system_one` entry in the verdict's checks, so every surface that shows risk checks shows it. `advise` (default) always passes; `block` rejects on a high-confidence concern; an outage passes. Exits and protective stops are never reviewed.
4. **Prompt and skill**: a System One section in the system prompt and a `system-one` skill that teaches question design, buckets and gating thresholds.
5. **Settings and UI**: `settings.systemOne {enabled, gate}` and a status chip with the gate switch in Settings.
6. **Simulations**: tools work in simulations with point-in-time state; blind runs are safe because state carries buckets, not tickers or dates.

## Not doing (v1)

- Jev never places, sizes or cancels an order and never sets a stop.
- No fine-tuning, no trained classifier on Jev outputs, no calibration database. Reviews ride on the order record's checks; a later slice can join them to realized P&L.
- No images, no long-context header, no streaming.
- No native Flutter screens for System One yet.
- No automatic wrapping of every news or web result; the agent calls `jev_read_text` where the skill says to.

## Operating it

- Production: `SYSTEMONE_URL` default (TypeSafe), `SYSTEMONE_MODEL=jev-latest`, key from `SYSTEMONE_API_KEY` or the file at `SYSTEMONE_KEY_FILE` (default `~/.config/opencode-v2/secrets/typesafe.env`, a `TYPESAFE_API_KEY=` line).
- Development and production both use TypeSafe's official API with the owner's TypeSafe key (the defaults above). The OpenCode proxy is optional: `SYSTEMONE_URL=https://opencode.ai/inference/systemone/v1/systemone`, `SYSTEMONE_MODEL=jev-1.13-free` or `jev-1.13`. As of 2026-10-26 its free tier was out of quota for hours (`FreeUsageLimitError`, shared across keys) and the paid route returned 402 for lack of funds. Either way the client trips its breaker and the tools report "System One unavailable" instead of failing a cycle.
- `apps/server/scripts/jev-probe.ts` makes one real call and prints the typed answer, for checking a new endpoint or key.
