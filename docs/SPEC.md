# Robinhood Harness: spec

## Goal

A 24/7 agentic trading harness for the user's Robinhood MCP trading account. A durable Pi agent
running `muse-spark-1.3-contributor` researches with the Robinhood Trading MCP and the OpenCode
`openai_websearch` tools, journals every decision, and proposes orders. A deterministic risk engine
outside the model decides whether an order may go out. A Svelte + shadcn UI shows the account,
the agent's live work, the journal, pending approvals, settings, and a kill switch.

## Architecture

- `apps/server`: Node 26, Hono, `@earendil-works/pi-durable` 1.3.0 with SQLite storage, pi-ai's Meta
  provider (credential seeded from `~/.config/muse/auth.json`), `@earendil-works/pi-mcp` for the
  Robinhood MCP (OAuth with dynamic client registration and PKCE) and the websearch MCP.
- `apps/web`: SvelteKit static SPA, shadcn-svelte, bits-ui, Tailwind 4, HugeIcons. Served by the server.
- `packages/shared`: wire types and zod schemas (`packages/shared/src/index.ts`).
- Server ports: `apps/server/src/ports.ts`.
- Code Mode everywhere: the model is offered only the `codemode` tool and writes JavaScript that calls
  every other tool (Robinhood `rh_*`, `market_*`, `sec_company`, web, skills, notes, risk, journal,
  `delegate`) as `await tools.<name>()`, in parallel where useful. Tools return structured JSON.
- Skills: trading playbooks and reference resources in `apps/server/skills/<name>/SKILL.md`, listed in
  the system prompt and loaded on demand. Notes: a durable markdown workspace for theses, plan, lessons.
- Market data from free sources: Nasdaq daily bars and earnings calendar, CBOE VIX, US Treasury yields,
  SEC EDGAR filings and XBRL facts, plus deterministic indicators computed server-side.
- Subagents: `delegate` runs read-only analyst, bull, bear, risk reviewer, or researcher subagents,
  several in parallel.
- Simulation: accelerated point-in-time replays of past trading days (`apps/server/src/sim/`) with a paper
  cash broker, synthetic intraday path from daily bars, the real risk engine, and metrics against SPY
  buy-and-hold. Runs are isolated in `${DATA_DIR}/sim/<id>/`; the live agent can start one with `sim_start`
  to test a strategy hypothesis.
- Installable PWA at https://<host>.<tailnet>.ts.net:8443 (Tailscale serve, tailnet only) with web push for
  fills, failures, halts, sign-in problems, the daily review, and finished simulations.
- Defaults tuned for a small cash account in full auto: fractional shares, 1.5% risk per trade, 30% per name,
  4 positions, $500 order cap, self-clearing drawdown halt.
- One lead agent conversation. Scheduled cycles (pre-open, intraday every 30 min, post-close, overnight
  every 4 h) and the user's chat messages are inputs to it. Cycle request ids make them idempotent.
- Crypto sleeve: any pair Robinhood lists (optional allowlist), an 8 percent of equity total cap, native
  Robinhood stops, and Coinbase daily candles for charts. Crypto trades 24/7 and is exempt from
  market-hours and day-trade rules.
- The model never sees order-placing Robinhood tools. It calls `submit_order` with a structured intent
  (thesis, invalidation, time stop, EV inputs, evidence). The gate runs the risk engine, then
  Robinhood's review, then places the order (mode `auto`) or queues it for approval (mode `approve`).
- System One (Jev): TypeSafe's fast decision model answers typed questions with calibrated
  probabilities. The agent calls six read-only tools (`jev_status`, `jev_decide`, `jev_candidates`,
  `jev_read_text`, `jev_thesis_check`, `jev_regime`) as second opinions for triage, text reading,
  thesis checks, and regime reads. After the risk engine approves an entry, Jev reviews the thesis
  and the result appears as a `system_one` check in the verdict (`advise` always passes, `block`
  rejects on a high-confidence concern, outages pass). It never places, sizes, or cancels orders.
- Port 4520 on 127.0.0.1 and the Tailnet address. Mutating requests need the `x-harness` header.

## Not doing (v1)

- R&D does not place test orders, unlock trading, automatically raise financial limits, spend reserved cash, or claim that more trades guarantee profit.
- Hourly telemetry is not an autonomous coding agent; unattended source upgrades require a supported scheduled engineering runner.
- No strategy optimizer or parameter sweeps; simulations run one at a time.
- No options, shorting, margin use, or multi-leg orders. Crypto is limited to a small capped sleeve.
- No app login; the Tailnet plus the CSRF header is the boundary.
- No FRED, Yahoo, or Stooq (blocked or rate-limited from this host); no paid data feeds.
- No bash or file access for the agent beyond its notes workspace.
- No hosted deploy; it runs on one machine as a user service.
- System One: Jev never places, sizes, or cancels orders and never sets a stop; no fine-tuning or
  calibration database yet (reviews ride on the order record); no automatic wrapping of every news
  result; no native Flutter screens for it yet.

## Native Android app (apps/mobile)

Goal: a fully native Flutter app with every feature of the web app, a premium look, and automatic connection to the tailnet server. It replaces the WebView shell; the web app stays for browsers.

Not doing: no iOS build, no Play Store release, no offline order entry, no new server endpoints beyond what the web uses, no custom charting package.

Checks:
1. `flutter analyze` and `flutter test` pass in `apps/mobile`.
2. Models parse real server JSON for status, orders, journal, reports, market overview, symbol detail, sim runs and suites (fixtures captured from the live server).
3. With Tailscale up, a cold start reaches the server with no typing, and the unreachable screen offers Retry, Open Tailscale and a manual host.
4. Every web section has a native screen: Feed, Portfolio, Markets, Performance, Agent, Reports, Journal and orders, Lab, Settings, symbol detail.
5. Approve, reject, kill switch, mode change, send message, run cycle, settings patch, and Robinhood connect work against the live server.
6. `flutter build apk --release` succeeds and the APK installs and starts in an emulator.
7. Design is recorded in `apps/mobile/DESIGN.md` and the screens use its tokens.

## Acceptance checks

### Investment-policy R&D pass (2026-10-27)

1. Cover all retained live-session history and distinguish model holds from deterministic risk rejections, with dates and counts.
2. Risk-reducing sells and protective stops are not trapped by entry-only notional caps; buys, oversells, kill switch and mode-off remain constrained.
3. The trader reads the owner's current preferences and live limits, distinguishes strategy preferences from engine prohibitions, and does not invent evidence or financial targets.
4. A read-only hourly health check reports inactivity, repeated risk blocks, stale cycles and protection gaps without messaging the trader or changing orders/settings.
5. Run focused regression tests and typechecking, publish the change, and report separately what is deployed and what remains unsupported.

### Fractional execution and transcript timestamps (2026-10-27)

1. Historical user, assistant, tool, cycle and helper messages retain their original persisted timestamps across reloads; missing times use only an explicit fallback.
2. Completed helper timestamps use persisted completion state, not the time a status list is viewed; both clients preserve event times and completed durations.
3. A fractional equity intent whose limit cannot cover the fresh ask/bid fails before placement with actionable diagnostics; no implicit repricing, relaxed price ceilings or uncertain-order retry is added.
4. Marketable fractional conversion, whole-share resting limits and existing trading controls retain regression coverage; no live test order is placed.
5. Run server, web and Android checks plus one read-only browser reload check; deploy with the trader idle and simulations inactive, then merge under the owner's standing authorization.

Not doing: no redesign, new order type, numeric limit change, live execution test, or changes to reserved cash.

### Hourly R&D: local exit refusal (2026-10-27)

1. If the fractional execution check refuses a sell before any placement request, restore only the harness-held stops canceled for that attempt, in both automatic and approved exits.
2. Successful sells still cancel their held protection; ambiguous broker errors, response parsing errors and timeouts never restore stops or retry a possibly placed sell.
3. Verify the refusal type originates only at the local fractional preflight, and cover quote movement after review, subsequent stop execution and unaffected crypto cancellation behavior.
4. Run server tests and typechecking, obtain one focused safety review, and deploy only when the trader is idle and simulations are inactive.

Not doing: no native-stop replacement, ambiguous-order reconciliation, financial-limit changes, forced trades, client wire changes, or live test orders.

### Hourly R&D: working-exit visibility (2026-10-27)

1. The read-only monitor flags locally recorded plain-limit risk-reducing sells still working at least 60 wall-clock minutes after creation, even when created before the last-hour order window.
2. Report remaining quantity, original creation time and limit, with local-only provenance; exclude protective stops, buys, oversells, terminal orders and orders with no quantity remaining.
3. Bound displayed orders to the oldest 20 while retaining the detected count; warn, never instruct cancellation/repricing or change trading state. The existing newest-5,000-record scan limit remains disclosed.
4. Run focused tests, typechecking and one real read-only probe; merge without restarting the trader.

Not doing: no automatic order management, new broker calls, allocation changes, client UI/wire changes, or service restart. Age is not proof of a broker fault or stale price.

### Hourly R&D: after-hours account freshness (2026-10-27)

1. Continue the existing five-minute read-only account refresh outside regular equity hours; disconnected brokers still skip refresh and failed reads retain the cached snapshot.
2. Both clients and diagnostics continue using the same account wire shape; no order, settings, strategy or credential behavior changes.
3. Run root typechecking/tests and one focused safety review, restart only with trader idle and no running simulations, then verify the broker account no longer shows the filled BTC holding.
4. Verify a subsequent after-hours snapshot advances without a new agent cycle before merging.

Not doing: no immediate fill-event refresh framework, new timer, forced cycle, live test trade, financial-limit change or order retry.

### Hourly R&D: overnight cadence before pre-open (2026-10-27)

1. Before 09:00 ET on a trading day, choose the earlier of the aligned configured overnight interval and pre-open; pre-open wins a tie.
2. Preserve daytime intraday/post-close scheduling, holidays/weekends, early closes and strictly future cycle times. Keep the existing single-timer scheduler and all order/session permissions unchanged.
3. Cover the observed midnight-to-pre-open gap, later overnight intervals, pre-open priority and a daylight-saving boundary with deterministic tests; run root typecheck/tests and one focused safety review.
4. Deploy only with trader idle and no running simulations; confirm the live next cycle is the nearer overnight run without forcing a cycle or trade.

Not doing: no new scheduler, timer, cadence setting, trading permission, forced cycle, or cycle-history persistence change.

### Hourly R&D: scheduled research pacing (2026-10-28)

1. Prompt the trader to finish pre-open planning before the regular open and bound intraday work to the configured open-cycle interval, without skipping required protection, reconciliation, evidence or entry checks.
2. Defer nonessential deep research to read-only helpers/later cycles; reuse current measured evidence when its validity and market inputs are unchanged rather than repeating the same analysis.
3. If the market session changes during pre-open planning or a research-only cycle, confirm the live session through get_risk_state, journal and finish that assignment; do not silently broaden its order scope or abort an uncertain order.
4. Verify the assembled prompts with focused regressions and root checks. Deploy only after the active cycle settles with no running simulations; monitor subsequent durations rather than claiming prompt text guarantees a timeout.

Not doing: no forced trade, lowered thinking level, hard timeout/abort, pending-cycle queue, engine change, live-trader message or strategy threshold change.

### Original v1 checks

1. `bun run typecheck` and `bun run test` pass.
2. The server starts, `GET /api/status` returns the agent, market clock, settings, and broker state.
3. A manual cycle runs end to end on Muse: the agent uses web search, writes a journal entry, and the
   transcript streams into the UI.
4. Robinhood connect: the UI's Connect button returns a working sign-in URL; after sign-in the broker
   is `connected` and the agent can read the account and portfolio.
5. The risk engine rejects an oversized or out-of-hours entry with named checks (unit tests), and the
   model cannot call any Robinhood place tool directly.
6. In `approve` mode an approved-by-risk order appears in the UI and can be approved or rejected;
   the kill switch blocks every order.
7. The UI works at desktop and phone widths.
9. A 5-day simulation finishes with an equity curve, fills, and metrics, and leaks no data after the simulated date.
10. The app installs on a phone from the Tailscale HTTPS URL and a test push notification arrives.
8. The model's only direct tool is `codemode`; a cycle's script calls market data, skills, and
   `delegate` in parallel, and the UI shows the script and its nested calls.
