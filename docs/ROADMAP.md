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
| 19 | Live Robinhood sign-in and real tool-schema mapping | coordinator | blocked on the user's sign-in |

## Follow-ups

- Confirm Robinhood accepts fractional limit orders; if not, add dollar-based orders for fractional sizing.
- Map broker snapshot, quote, review, and place to the real Robinhood tool schemas after first sign-in.
- Calibration report: Brier score of `probabilityWin` against outcomes.
- Wash-sale lot tracking.
- Settings changes are logged but not journaled; the live mode was found off once with no record of who changed it.
- Push delivery, install, badge, and safe areas on a real phone are untested.
