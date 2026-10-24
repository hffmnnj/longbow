# Runbook

Runs on `laptop` as a systemd user service. State lives in `~/.local/share/robinhood-harness`
(`durable.sqlite` for the agent, `app.sqlite` for settings, journal, and orders,
`robinhood/oauth.json` for Robinhood tokens, mode 0600).

## Install or update

```sh
cd ~/Documents/robinhood-harness
git pull && bun install && bun run build:web
install -Dm644 ops/robinhood-harness.service ~/.config/systemd/user/robinhood-harness.service
systemctl --user daemon-reload
systemctl --user enable --now robinhood-harness
curl -fsS http://127.0.0.1:4520/api/status | head -c 300
```

Open http://127.0.0.1:4520 locally or http://100.101.102.103:4520 over the Tailnet.

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
  writes to `/tmp/codex-login/status.txt`, then `systemctl --user restart robinhood-harness`. It is
  the harness's own login, separate from OpenCode's, because OpenAI refresh tokens are single use.
