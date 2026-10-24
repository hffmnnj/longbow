# Roadmap

## Slices (v1)

| # | Slice | Owner | Status |
|---|-------|-------|--------|
| 1 | Scaffold, shared contract, ports | coordinator | done |
| 2 | Server core: config, store, Harness + Muse, scheduler, HTTP + SSE | minion | in progress |
| 3 | Robinhood MCP: OAuth, token store, read-tool extension, broker | engineer | done |
| 4 | Risk engine, NYSE calendar, order gate, submit_order tool | minion | in progress |
| 5 | Websearch extension, journal tool, system prompt | minion | in progress |
| 6 | Web UI | frontend | in progress |
| 7 | Market data: Nasdaq bars, indicators, earnings, VIX, yields, SEC | minion | in progress |
| 8 | Skills loader and notes workspace; skills content | minion x2 | in progress |
| 9 | Subagents (`delegate`) | minion | in progress |
| 10 | Code Mode wiring, earnings and liquidity in the risk engine, prompt update | coordinator | planned |
| 11 | UI: code mode calls, subagent transcripts, price charts, skills and notes | frontend | planned |
| 12 | Integration, live Robinhood sign-in, QA, PR | coordinator | planned |

## Follow-ups

- Map broker snapshot, quote, review, and place to the real Robinhood tool schemas after first sign-in.
- Calibration report: Brier score of `probabilityWin` against outcomes.
- Wash-sale lot tracking.
