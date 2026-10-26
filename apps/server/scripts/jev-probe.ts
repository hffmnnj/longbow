import { loadConfig } from "../src/config.ts";
import { createLogger } from "../src/log.ts";
import { createConfiguredSystemOne } from "../src/systemone/setup.ts";

/**
 * One real System One call with the configured endpoint, model and key, to check a new setup.
 * Usage (from apps/server): node scripts/jev-probe.ts
 * Development on OpenCode's free tier:
 *   SYSTEMONE_URL=https://opencode.ai/inference/systemone/v1/systemone SYSTEMONE_MODEL=jev-1.13-free \
 *   SYSTEMONE_KEY_FILE=~/.config/opencode-v2/secrets/opencode-jev.key node scripts/jev-probe.ts
 * Prints the typed answers, latency and status. Never prints the key.
 */
const config = loadConfig();
const client = createConfiguredSystemOne(config, createLogger("jev-probe"), { now: () => Date.now() });

const result = await client.ask({
  label: "probe",
  state: { setup_context: { trend: "above both the 50-day and 200-day averages", momentum: "firm", volume: "elevated", versus_market: "stronger than the market" } },
  questions: {
    setup_quality: {
      type: "score",
      instructions: "How clean is the long setup described in setup_context?",
      criteria: ["Weak: signals conflict", "Fair: some support but a clear flaw", "Strong: trend, momentum and volume agree"],
    },
    extended: { type: "noul", instructions: "Would a long entry now chase a move that has already run?" },
  },
});

console.log(JSON.stringify({ endpoint: config.SYSTEMONE_URL, model: config.SYSTEMONE_MODEL, result, status: client.status() }, null, 2));
process.exit(result.ok ? 0 : 1);
