import { readFileSync } from "node:fs";
import type { Clock, Config, Logger } from "../ports.ts";
import { createSystemOneClient, parseKeyFile, type SystemOneClient } from "./client.ts";

/** The key from SYSTEMONE_API_KEY, else from the key file; undefined leaves System One unconfigured. */
export function loadSystemOneKey(
  config: Pick<Config, "SYSTEMONE_KEY_FILE">,
  env: NodeJS.ProcessEnv = process.env,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string | undefined {
  const fromEnv = env["SYSTEMONE_API_KEY"];
  if (fromEnv !== undefined && fromEnv.trim() !== "") return fromEnv.trim();
  try {
    return parseKeyFile(read(config.SYSTEMONE_KEY_FILE));
  } catch {
    return undefined;
  }
}

/** One shared client for the live agent and every simulation, so the cache, breaker and rate limit are shared. */
export function createConfiguredSystemOne(config: Config, log: Logger, clock: Clock): SystemOneClient {
  const apiKey = loadSystemOneKey(config);
  if (apiKey === undefined) log.warn("system one has no key; its tools and the entry review stay off", { keyFile: config.SYSTEMONE_KEY_FILE });
  return createSystemOneClient({
    url: config.SYSTEMONE_URL,
    model: config.SYSTEMONE_MODEL,
    ...(apiKey === undefined ? {} : { apiKey }),
    clock,
    log,
  });
}
