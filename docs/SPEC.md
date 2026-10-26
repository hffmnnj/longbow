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
