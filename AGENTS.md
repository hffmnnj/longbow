# Robinhood harness guidance

## Hard limits
- Orders reach Robinhood only through `submit_order` (risk engine, review, place). Never expose Robinhood `place_*` tools to the model or bypass `apps/server/src/risk/gate.ts`.
- Never print `~/.config/muse/auth.json`, `~/.local/share/robinhood-harness/robinhood/oauth.json`, or the websearch Authorization header in `~/.config/opencode-v2/opencode.json`.
- Never `pkill -f` with a command-line pattern (`node src/main.ts`, `vite dev --port 5241`): it matches the agent's own shell. Stop scratch servers by PID. The server is the systemd user unit `robinhood-harness`; use `systemctl --user restart robinhood-harness` and read logs with `journalctl _SYSTEMD_USER_UNIT=robinhood-harness.service` (the user journal is empty on this host).
- Restarting `robinhood-harness` fails every running simulation ("interrupted by restart"); check `curl -s http://127.0.0.1:4520/api/sim/runs` for running runs first.
- Live orders and cancels need `HARNESS_LIVE_TRADING=1` in the systemd unit; without it the broker is read-only regardless of the app's mode. Only the owner's explicit go unlocks it.
- The harness has its own ChatGPT login (`apps/server/scripts/codex-login.ts`); never copy OpenCode's OpenAI tokens, refresh tokens are single use.
- Simulation events carry `simRunId`; the live UI reducer, journal, and push notifier must ignore them.
- Report figures come only from `apps/server/src/reports/facts.ts`; the model supplies narrative through `publish_report`, never numbers.
- Every user-facing change ships to both clients in the same PR: the web app (`apps/web`) and the native Android app (`apps/mobile`, Flutter). A server wire change updates both parsers (`packages/shared` and `apps/mobile/lib/models`). Owner's standing instruction.

## Delivery authority
- The owner authorizes merging all open and future PRs in `hffmnnj/longbow` without asking again. Verify the changes and obey required checks and branch protections; this does not authorize direct pushes to `main` or changes to live-trading controls.

## Commands
- `bun run typecheck && bun run test` in the repo root; the web tests run separately with `bun run test` in `apps/web` (vitest, Node environment, no DOM).
- After web changes, `bun run build` in `apps/web`; the server serves `apps/web/build` on port 4520.
- Mutating API calls need the header `x-harness: 1` (CSRF guard), for example `curl -X PATCH -H "x-harness: 1" -H "content-type: application/json" -d '{"mode":"auto"}' http://127.0.0.1:4520/api/settings`.

## Gotchas
- `FractionalPreflightError` proves refusal before placement and lets the gate restore canceled held stops. Throw it only from local fractional preflight, never for transport, broker-response or parsing errors; ambiguous placement must not restore protection or retry a possible sale.
- Yahoo, Stooq, and FRED are blocked from this host; market data comes from Nasdaq, CBOE, Treasury, and SEC (`apps/server/src/market/market-data.ts`). Nasdaq ignores past `todate`, so fetch to today and slice.
- The Playwright MCP browser cannot reach this machine's 127.0.0.1 or the tailnet; for local screenshots use Agent Browser (`web-visual-qa`) or headless `/usr/bin/chromium`.
- Robinhood positions carry no sector; the sector cap and charts get sectors from `apps/server/src/market/sectors.ts` (SEC SIC codes plus overrides). Add overrides there for misfiled names.
- For scratch checks, snapshot the live DB with `VACUUM INTO` on a read-only open of `~/.local/share/robinhood-harness/app.sqlite`; a plain `cp` misses the WAL and yields a malformed copy.
- bits-ui sets `data-state`, not `data-checked`, so shadcn classes written as `data-checked:` never apply; style with `data-[state=checked]:` (the Switch was invisible until fixed).
- Bottom sheets need `max-h-[…dvh]`, not `h-[…]`: bits-ui's `data-[side=bottom]:h-auto` outranks a plain height class and the sheet grows past the screen.
- The PWA's tailnet origin is `https://<host>.<tailnet>.ts.net:8443` (`tailscale serve`); the public Funnel on :443 belongs to another project and must stay untouched.

## Read when
- Operating or rolling back the service → `docs/RUNBOOK.md`.
- Scope and open work → `docs/SPEC.md`, `docs/ROADMAP.md`.
- System One (Jev) tools, gate review, keys and endpoints → `docs/SYSTEM-ONE.md`; check it live with `node scripts/jev-probe.ts` in `apps/server`.
