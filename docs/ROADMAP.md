# Roadmap

## Slices (v1)

| # | Slice | Owner | Status |
|---|-------|-------|--------|
| 1 | Scaffold, shared contract, ports | coordinator | done |
| 2 | Server core: config, store, Harness + Muse, scheduler, HTTP + SSE | minion | in progress |
| 3 | Robinhood MCP: OAuth, token store, read-tool extension, broker | engineer | in progress |
| 4 | Risk engine, NYSE calendar, order gate, submit_order tool | minion | in progress |
| 5 | Websearch extension, journal tool, system prompt | minion | in progress |
| 6 | Web UI | frontend | in progress |
| 7 | Integration, live Robinhood sign-in, QA, PR | coordinator | planned |

## Follow-ups

- Map broker snapshot, quote, review, and place to the real Robinhood tool schemas after first sign-in.
- Bull/bear subagent debate before entries (TradingAgents pattern).
- Regime inputs from FRED and CBOE VIX; earnings calendar check server-side.
- Calibration report: Brier score of `probabilityWin` against outcomes.
- Wash-sale lot tracking.
