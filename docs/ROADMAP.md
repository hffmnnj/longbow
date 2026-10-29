# Roadmap

## Slices (v1)

| # | Slice | Owner | Status |
|---|-------|-------|--------|
| 1 | Scaffold, shared contract, ports | coordinator | done |
| 2 | Server core: config, store, Harness + Muse, scheduler, HTTP + SSE | minion | done |
| 3 | Robinhood MCP: OAuth, token store, read-tool extension, broker | engineer | done |
| 4 | Risk engine, NYSE calendar, order gate, submit_order tool | minion | done |
| 5 | Websearch extension, journal tool, system prompt | minion | done |
| 6 | Web UI | frontend | done |
| 7 | Market data: Nasdaq bars, indicators, earnings, VIX, yields, SEC | minion | done |
| 8 | Skills loader and notes workspace; skills content | minion x2 | done |
| 9 | Subagents (`delegate`) | minion | done |
| 10 | Code Mode wiring, earnings and liquidity in the risk engine, prompt update | coordinator | done |
| 11 | UI: code mode calls, subagent transcripts, price charts, skills and notes | frontend | done |
| 12 | Small account and full auto: defaults, fractional sizing, self-clearing drawdown halt, prompt and skills | coordinator + minions | done |
| 13 | Point-in-time market data | minion | done |
| 14 | Simulation engine, paper broker, metrics, sim_start/sim_results | engineer | done |
| 15 | Web push notifications | minion | done |
| 16 | UI pass 3: installable PWA, push opt-in, simulation lab | frontend | done |
| 17 | Agent UI on the shadcn Trace component; resting protective stops | frontend-minion + coordinator | done |
| 18 | Integration, systemd service, live simulation test, QA, PR | coordinator | done |
| 19 | Live Robinhood sign-in and real tool-schema mapping, harness-held fractional stops, live-trading lock | coordinator + engineer | done |
| 20 | Main agent on ChatGPT gpt-6.1-sol xhigh, subagents on Muse xhigh, long-running background subagents | coordinator + minion | done |
| 21 | Longbow redesign: logo, dithered charts, Portfolio, Markets, Performance, control room, decision cards; analytics endpoints; helper reports in the feed | frontend + minions + coordinator | done |
| 22 | Sector cap fed by SEC industry codes (Robinhood reports no sector) | coordinator | done |
| 23 | Daily, weekly and trade reports: agent narrative, server figures, push, report view with print | minion + frontend-minion + coordinator | done |
| 24 | Simulation upgrade: historical, blind and bootstrap environments, realistic execution, scenario library, suites with A/B comparison, richer metrics | minions + coordinator | done |
| 25 | Quant tools (screen, backtest, portfolio risk, sizing) and the full-auto system prompt | minion + coordinator | done |
| 26 | Lab UI for scenarios, suites and the new metrics | frontend-minion + coordinator | done |
| 27 | Go-live: live trading on, auto mode, 24/7 service on 0.0.0.0 with tailnet-only peers | coordinator | done (2026-10-25) |
| 28 | Android app: Flutter shell around the live UI, native bridge (alerts, print, haptics, copy), APK at /download/longbow.apk | frontend-minion + coordinator | built; awaiting on-device check |
| 29 | Local-timezone timestamps; chat messages steer a running cycle instead of queueing behind it | coordinator | done (2026-10-26) |
| 30 | Native Flutter Android app replacing the WebView shell: models, data layer, design system, all screens | frontend + frontend-minions + minions + coordinator | done |
| 31 | System One (Jev) decision layer: typed client, agent tools, entry second opinion, prompt and skill, settings and status chip, on web and Android | minions + frontend-minion + coordinator | done (PR #3); agent seen calling jev_* live |
| 32 | Native Codex remote compaction, gated to openai-codex/gpt-6.1-sol; Muse and subagents keep text compaction | engineer + coordinator | in progress |
| 33 | Crypto sleeve: capped BTC/ETH skill, gate rules, prompt and docs | minions + coordinator | in progress |

## Follow-ups

- Current R&D (2026-10-28): controlled deployments lost in-memory cycle history and caused false NO_CYCLE_RECORDED alerts. Startup now restores only the latest valid tagged cycle input's original timestamp/kind from at most 1,000 entries, without marking it active or changing execution. Root typecheck, 672 server tests and safety review passed. Deployed at 22:06 MST while idle/no simulations; live status exactly matched persisted 21:00:01.007 MST, not deployment time, with settings/next 01:00 MST run unchanged. The real health probe immediately returned HEALTHY.
- Current owner mandate: later in-app instructions prohibit new index-fund buys and request migration of existing funds after a decent profit, with risk exits still taking priority. The trader recognized these instructions; the earlier conditional ETF allowance is not permission to override them.
- Pacing follow-up: pre-open baseline was about 62 minutes; first post-guidance intraday cycle finished in about 33 minutes but still skipped the 10:45 ET run. One observation does not prove a latency improvement. Continue measuring cycle duration/overlaps; clarify the diversified-ETF policy universe before extending it to leveraged, inverse or thematic funds.
- Shipped R&D (PRs #10–20): reducing-exit entry-cap exemption; owner/strategy instruction priority; persisted message/helper timestamps; early fractional marketability check without repricing; held-stop restoration only on definite local refusal; read-only hourly diagnostics and older working-exit warnings; five-minute account refresh outside equity hours; overnight cadence before pre-open; pacing guidance; narrow owner-directed ETF cost-basis clarification without relaxing binding controls.
- Live verification: the BTC exit filled and a fresh account confirmed no BTC; after-hours snapshots advance without agent cycles; corrected 01:00 and 05:00 MST overnight runs both finished before the normal pre-open run. Timestamp API checks matched persisted times across reload, with web/Android regressions and phone QA. More frequent after-hours reads also increase existing equity-mark frequency; baseline calibration remains a follow-up.
- The hourly health timer is read-only; user-requested 60-minute background waits drive further R&D while this engineering session is active. No separate unattended coding runner is installed.
- R&D follow-ups: derive the current lot rather than earliest historical buy; fix minimum-hold trading-day counting and stop lookup beyond seven days; surface loss halts from a fresh account snapshot. Current live minimum hold is zero, so those hold defects did not cause the observed inactivity.
- Review protection gaps after ambiguous exit placement, pre-placement quote-read failures and native-stop replacement, plus exit spread policy separately. The typed fractional-refusal fix does not cover them; stop restoration also depends on local persistence/event publication succeeding.
- Health warnings are recorded in journald, not pushed to an unattended engineering runner. Locally recorded stop coverage is not broker verification, and the bounded 5,000-order scan can miss older still-resting protection.
- Simulation comparability: fractional equity limit intents now need a marketable ask/bid at the shared gate, rather than parking patient fractional limits. Earlier simulation returns are not directly comparable; paper-broker resting-fill physics remains a separate limitation.
- Join entry reviews to realized P&L to measure Jev's calibration on our own trades.
- First live `system_one` order check (advise and block) is still unseen; watch the first entry the agent proposes.
- Free OpenCode Jev tier is quota-limited by IP or pool; production uses TypeSafe direct.
- Fractional stops are protected only while the harness runs during regular hours.
- Background helper stop cannot abort a child turn already running (no abort API on the tool context).
- Simulations run without background helpers; reports between cycles would break the fixed clock.
- Wash-sale lot tracking.
- Settings changes are logged but not journaled; the live mode was found off once with no record of who changed it.
- Push delivery, install, badge, and safe areas on a real phone are untested.
- The native `generate_image` tool fails with "Session project changed" in this project; the logo is a hand-built SVG until it works.
- Phone Markets index table clips its trend column; it should scroll or drop a column.
- SIC-based sectors are coarse; widely held names are overridden in apps/server/src/market/sectors.ts.
- Suite strip chart over-scales its dot with one run per variant; a suite whose runs all failed to start is kept as an empty failed suite.
- Sim agents retried an identical risk-rejected order four times; the prompt forbids it, so watch whether it recurs after the stop-rounding fix.
- Run a full blind suite (several scenarios plus bootstrap markets) to set a baseline for the new prompt before go-live.
- Fee schedule in apps/server/src/fees.ts: FINRA's TAF pause ends 2026-12-31 and the SEC resets the Section 31 rate each spring; update the table when either changes.
