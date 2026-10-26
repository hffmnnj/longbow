import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Clock, Logger } from "../ports.ts";

/**
 * File cache plus bounded HTTP for the market-data layer. Every remote body
 * is treated as untrusted data: only the fields named by the callers are
 * parsed, and fetch failures carry short typed messages that never include
 * response bodies.
 */

export type MarketErrorCode = "network" | "bad_response" | "not_configured";

export class MarketError extends Error {
  readonly code: MarketErrorCode;
  constructor(code: MarketErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** One retry on a 5xx or a network failure. Defaults to true. */
  retry?: boolean;
}

const FETCH_TIMEOUT_MS = 20_000;

/** Prescribed cache TTLs. */
export const TTL = {
  /** Nasdaq daily history is chosen per call: open-session vs closed. */
  historyOpenMs: 15 * 60_000,
  historyClosedMs: 6 * 60 * 60_000,
  calendarMs: 6 * 60 * 60_000,
  vixMs: 60 * 60_000,
  yieldsMs: 60 * 60_000,
  secTickersMs: 7 * 24 * 60 * 60_000,
  secCompanyMs: 12 * 60 * 60_000,
} as const;

function keyToFile(key: string): string {
  return `${Buffer.from(key, "utf8").toString("base64url")}.json`;
}

const etParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const etDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** ET calendar date (YYYY-MM-DD) of an instant. */
export function etDate(now: number): string {
  return etDateFmt.format(new Date(now));
}

/** True during the NYSE regular session (09:30-16:00 ET, Monday-Friday). */
export function isRegularSession(now: number): boolean {
  const parts = Object.fromEntries(etParts.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const day = parts["weekday"];
  if (day === "Sat" || day === "Sun") return false;
  const hm = `${parts["hour"]}:${parts["minute"]}`;
  return hm >= "09:30" && hm < "16:00";
}

export class MarketCache {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly dataDir: string;
  private readonly log: Logger;
  private readonly clock: Clock;
  private readonly fetchImpl: typeof fetch;

  constructor(dataDir: string, log: Logger, clock: Clock, fetchImpl: typeof fetch = fetch) {
    this.dataDir = dataDir;
    this.log = log;
    this.clock = clock;
    this.fetchImpl = fetchImpl;
  }

  private dir(): string {
    return join(this.dataDir, "cache", "market");
  }

  /**
   * Return the cached value for `key` when it is younger than `ttlMs`,
   * otherwise run `fetchFn`, cache its result, and return it. Concurrent
   * identical requests share one fetch.
   */
  async getOrFetch<T>(key: string, ttlMs: number, fetchFn: () => Promise<T>): Promise<T> {
    try {
      const raw = await readFile(join(this.dir(), keyToFile(key)), "utf8");
      const parsed = JSON.parse(raw) as { at?: unknown; value?: unknown };
      if (typeof parsed?.at === "number" && this.clock.now() - parsed.at < ttlMs && "value" in parsed) {
        return parsed.value as T;
      }
    } catch {
      // Cache miss, unreadable file, or bad JSON: fetch fresh below.
    }
    const running = this.inflight.get(key);
    if (running !== undefined) return running as Promise<T>;
    const pending = (async (): Promise<T> => {
      const value = await fetchFn();
      try {
        await mkdir(this.dir(), { recursive: true });
        await writeFile(join(this.dir(), keyToFile(key)), JSON.stringify({ at: this.clock.now(), value }));
      } catch (error) {
        this.log.warn("market cache write failed", { key, error: error instanceof Error ? error.message : "unknown" });
      }
      return value;
    })();
    this.inflight.set(key, pending);
    try {
      return await pending;
    } finally {
      this.inflight.delete(key);
    }
  }

  /** GET a URL as text with a 20s timeout and one retry on 5xx/network errors. */
  async fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
    const attempts = (opts.retry ?? true) ? 2 : 1;
    let lastError: string = "fetch failed";
    for (let attempt = 0; attempt < attempts; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: opts.headers,
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : "network error";
        continue;
      }
      if (response.status === 404) {
        throw new MarketError("bad_response", `not found: ${briefUrl(url)} (404)`);
      }
      if (response.status >= 500 && attempt + 1 < attempts) {
        lastError = `server error ${response.status}`;
        continue;
      }
      if (!response.ok) {
        throw new MarketError("bad_response", `request failed: ${briefUrl(url)} (${response.status})`);
      }
      try {
        return await response.text();
      } catch (error) {
        lastError = error instanceof Error ? error.message : "unreadable response";
      }
    }
    throw new MarketError("network", `request failed: ${briefUrl(url)} (${lastError})`);
  }
}

function briefUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "url";
  }
}
