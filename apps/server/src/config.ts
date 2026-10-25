import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { Config, ModelSpec } from "./ports.ts";

function str(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value === "" ? fallback : value;
}

function num(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function concurrency(env: NodeJS.ProcessEnv): number {
  const raw = Number(env["SIM_CONCURRENCY"]);
  return Number.isInteger(raw) && raw >= 1 && raw <= 4 ? raw : 2;
}

/** Load server config from the environment. Every field has a same-named env var. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = homedir();
  const port = num(env, "PORT", 4520);
  const hosts = ["127.0.0.1"];
  const tailnet = env["HARNESS_TAILNET_HOST"];
  if (tailnet !== undefined && tailnet !== "") hosts.push(tailnet);
  return {
    PORT: port,
    HOSTS: hosts,
    PUBLIC_URL: str(env, "PUBLIC_URL", `http://127.0.0.1:${port}`),
    ALLOWED_ORIGINS: (env["HARNESS_ORIGINS"] ?? "").split(",").map((origin) => origin.trim()).filter((origin) => origin !== ""),
    DATA_DIR: str(env, "DATA_DIR", join(home, ".local", "share", "robinhood-harness")),
    LIVE_TRADING: env["HARNESS_LIVE_TRADING"] === "1",
    MAIN_MODEL: parseModelSpec(str(env, "MAIN_MODEL", "openai-codex/gpt-6.1-sol#xhigh")),
    SUBAGENT_MODEL: parseModelSpec(str(env, "SUBAGENT_MODEL", "meta/muse-spark-1.3-contributor#xhigh")),
    MUSE_AUTH_FILE: str(env, "MUSE_AUTH_FILE", join(home, ".config", "muse", "auth.json")),
    WEBSEARCH_CONFIG_FILE: str(
      env,
      "WEBSEARCH_CONFIG_FILE",
      join(home, ".config", "opencode-v2", "opencode.json"),
    ),
    ROBINHOOD_MCP_URL: str(env, "ROBINHOOD_MCP_URL", "https://agent.robinhood.com/mcp/trading"),
    WEB_DIR: str(env, "WEB_DIR", join(REPO_ROOT, "apps", "web", "build")),
    SIM_CONCURRENCY: concurrency(env),
  };
}

const THINKING_LEVELS: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/** "provider/model#thinking", e.g. "openai-codex/gpt-6.1-sol#xhigh"; thinking defaults to high. */
export function parseModelSpec(spec: string): ModelSpec {
  const match = /^([a-z0-9-]+)\/([^#\s]+)(?:#([a-z]+))?$/.exec(spec.trim());
  if (!match) throw new Error(`Invalid model spec "${spec}"; expected provider/model#thinking`);
  const thinkingLevel = (match[3] ?? "high") as ThinkingLevel;
  if (!THINKING_LEVELS.includes(thinkingLevel)) throw new Error(`Invalid thinking level "${match[3]}" in "${spec}"`);
  return { provider: match[1]!, modelId: match[2]!, thinkingLevel };
}
