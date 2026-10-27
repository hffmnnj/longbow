# Runbook

Runs on one machine as a systemd user service. State lives in `~/.local/share/robinhood-harness`
(`durable.sqlite` for the agent, `app.sqlite` for settings, journal, and orders,
`robinhood/oauth.json` for Robinhood tokens, mode 0600).

## Install or update

Machine-specific settings (tailnet host and origin, bind address, `HARNESS_LIVE_TRADING=1`, `SEC_CONTACT`) live in
`~/.config/robinhood-harness/env`, which the unit loads. Live trading stays off until that file sets `HARNESS_LIVE_TRADING=1`.

```sh
cd ~/Documents/robinhood-harness
git pull && bun install && bun run build:web
install -Dm644 ops/robinhood-harness.service ~/.config/systemd/user/robinhood-harness.service
systemctl --user daemon-reload
systemctl --user enable --now robinhood-harness
curl -fsS http://127.0.0.1:4520/api/status | head -c 300
```

Open http://127.0.0.1:4520 locally or http://<tailnet-ip>:4520 over the Tailnet.

## First run

1. Click **Connect Robinhood** and sign in. The agent trades only in the Robinhood MCP account.
2. Leave the mode on **Approve** until you trust it. **Auto** places risk-approved orders without you.

## Operate

- Logs: `journalctl --user -u robinhood-harness -f`
- Stop everything now: the kill switch in the UI, or `systemctl --user stop robinhood-harness`.
- Logs: `journalctl _SYSTEMD_USER_UNIT=robinhood-harness.service -f` (this host does not keep a user journal).
- Roll back: `git checkout <previous commit> && bun install && bun run build:web && systemctl --user restart robinhood-harness`.
- Muse sign-in expired (agent shows "needs login"): run `muse` to sign in again; the server re-seeds from
  `~/.config/muse/auth.json` on the next start.
- Models: the main agent runs `MAIN_MODEL` (default `openai-codex/gpt-6.1-sol#xhigh`, ChatGPT sign-in) and subagents
  run `SUBAGENT_MODEL` (default `meta/muse-spark-1.3-contributor#xhigh`). Without a ChatGPT login the main agent falls
  back to the subagent model and logs a warning.
- ChatGPT sign-in (missing or expired): in `apps/server`, run `node scripts/codex-login.ts`, open the URL and code it
  writes to `codex-login-status.txt` in the system temp directory, then `systemctl --user restart robinhood-harness`. It is
  the harness's own login, separate from OpenCode's, because OpenAI refresh tokens are single use.

## System One

- Env vars: `SYSTEMONE_URL` (TypeSafe default; OpenCode proxy for development), `SYSTEMONE_MODEL`
  (`jev-latest` in production, `jev-1.13-free` for the OpenCode free tier), key from `SYSTEMONE_API_KEY`
  or the file at `SYSTEMONE_KEY_FILE` (default `~/.config/opencode-v2/secrets/typesafe.env`).
- Status: `curl -s http://127.0.0.1:4520/api/status` and read the `systemOne` field for connection state.
  `rate_limited` means the quota breaker tripped (shared daily quota on the free tier); `payment` means
  a billing problem. Either way the tools report unavailable and the agent continues without Jev.
- Turn it off: `curl -X PATCH -H "x-harness: 1" -H "content-type: application/json" -d '{"systemOne":{"enabled":false}}' http://127.0.0.1:4520/api/settings`.
- Restarting the service fails running simulations; check for running sims before touching it.

## Hourly R&D diagnostics

`longbow-health.timer` runs a read-only probe on the hour, including while the market is closed. It reads `/api/status` and opens `app.sqlite` read-only. It does not message the trader, submit/cancel orders, change settings, or update source code. Warnings identify repeated holds, rejected reducing exits and incomplete locally recorded stop coverage; they are not buy signals. Local stop records do not verify broker-side protection, and a recent cycle start does not prove completion.

```sh
cd ~/Documents/robinhood-harness
install -Dm644 ops/longbow-health.service ~/.config/systemd/user/longbow-health.service
install -Dm644 ops/longbow-health.timer ~/.config/systemd/user/longbow-health.timer
systemctl --user daemon-reload
systemctl --user enable --now longbow-health.timer
systemctl --user start longbow-health.service
systemctl --user list-timers longbow-health.timer --no-pager
journalctl _SYSTEMD_USER_UNIT=longbow-health.service -n 5 --no-pager
```

Run manually with `node scripts/health-monitor.ts` in `apps/server`. Stop future probes with `systemctl --user disable --now longbow-health.timer`; this does not stop trading. No unattended engineering runner is installed: hourly diagnostics must not be described as autonomous hourly upgrades. Test concrete fixes before deployment; strategy-performance claims require actual informative trades and adequate evidence, not a zero-trade suite.
