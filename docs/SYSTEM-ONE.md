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

TradeRank lists Jev at rank 4 of 22 in the live competition (return +0.89%, Sharpe 0.62, 2 trades), behind GPT-6.1 Sol Pro, Muse Spark 1.3 and Claude Opus 5.5. TradeRank itself calls Jev "a measured baseline rather than a contender": it reads a masked snapshot (ratios only, no symbol, date or price) and its direction was indistinguishable from "yesterday's drift continues" (p = 0.66) over the research window, with an 80% band that held 68% of the time. So Jev is not a better trader than the lead agent and must not place trades. Its value here is speed, price, calibration and being unhijackable, which is why it sits beside the lead agent and the risk engine instead of replacing either.

## Design

Code stays in control. Every threshold lives in code, every number is computed in code and handed to Jev as a named bucket, and Jev's answers are inputs to deterministic rules.

1. **Client** (`apps/server/src/systemone/client.ts`): typed, never throws, circuit breaker for quota (`rate_limited`) and funds (`payment`), 10 minute cache, concurrency cap, call stats. Status appears in `GET /api/status` as `systemOne`.
2. **Agent tools** (Code Mode, read-only so subagents get them too): `jev_decide` (generic typed questions), `jev_candidates` (triage screened names), `jev_read_text` (classify news, filings and pages, and flag text that addresses an AI agent), `jev_thesis_check` (has news or price broken a held thesis), `jev_regime` (classify the market regime from computed buckets), `jev_status`.
3. **Entry second opinion** in the order gate: after the risk engine approves an entry, Jev reviews the intent's thesis against its own evidence list. Result is a `system_one` entry in the verdict's checks, so every surface that shows risk checks shows it. `advise` (default) always passes; `block` rejects on a high-confidence concern; an outage passes. Exits and protective stops are never reviewed.
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
