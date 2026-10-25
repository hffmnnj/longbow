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
| 27 | Go-live: owner says go, set HARNESS_LIVE_TRADING=1 and mode auto, execute the adoption exit queue | coordinator | waiting on the owner |

## Follow-ups

- First live order is the first check of Robinhood's place and cancel response shapes; watch it.
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
