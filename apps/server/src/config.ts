import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
import type { Config } from "./ports.ts";

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
    MUSE_MODEL: str(env, "MUSE_MODEL", "muse-spark-1.3-contributor"),
    MUSE_AUTH_FILE: str(env, "MUSE_AUTH_FILE", join(home, ".config", "muse", "auth.json")),
    WEBSEARCH_CONFIG_FILE: str(
      env,
      "WEBSEARCH_CONFIG_FILE",
      join(home, ".config", "opencode-v2", "opencode.json"),
    ),
    ROBINHOOD_MCP_URL: str(env, "ROBINHOOD_MCP_URL", "https://agent.robinhood.com/mcp/trading"),
    WEB_DIR: str(env, "WEB_DIR", join(REPO_ROOT, "apps", "web", "build")),
  };
}
