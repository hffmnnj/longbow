import { createHash } from "node:crypto";
import type { SystemOneStatus } from "@rh/shared";
import type { Clock, Logger } from "../ports.ts";
import {
  SystemOneResponseSchema,
  type AskFailure,
  type AskRequest,
  type AskResult,
  type AnswersFor,
  type Question,
  type QuestionMap,
} from "./types.ts";

/**
 * Typed client for a System One endpoint (TypeSafe's `POST /v1/systemone`, or OpenCode's
 * `/inference/systemone/v1/systemone` proxy). It never throws: callers get an `ok: false` result
 * and carry on without the model. A circuit breaker stops calls after quota or payment errors so a
 * dead key costs no latency, and a short cache makes repeated identical asks free.
 */

export interface SystemOneClient {
  ask<M extends QuestionMap>(request: AskRequest<M>): Promise<AskResult<M>>;
  status(): SystemOneStatus;
  /** True when a key is configured and the breaker is closed. */
  available(): boolean;
}

export interface SystemOneClientDeps {
  url: string;
  model: string;
  /** Absent means unconfigured: every ask fails fast with reason `unconfigured`. */
  apiKey?: string;
  clock: Clock;
  log: Logger;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxConcurrent?: number;
  cacheTtlMs?: number;
  maxRetries?: number;
  /** Sleep between retries; injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_BODY_BYTES = 96 * 1024;
const DAY_MS = 86_400_000;
const STATS_WINDOW = 200;
const CACHE_LIMIT = 500;
const DEFAULT_QUOTA_COOLDOWN_MS = 15 * 60_000;
const PAYMENT_COOLDOWN_MS = 10 * 60_000;
const AUTH_COOLDOWN_MS = 5 * 60_000;
const SHORT_RATE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = DAY_MS;

interface CallStat {
  at: number;
  ok: boolean;
  latencyMs: number;
  inputTokens: number;
}

function validateQuestions(questions: QuestionMap): string | undefined {
  const ids = Object.keys(questions);
  if (ids.length === 0) return "at least one question is required";
  for (const id of ids) {
    const q: Question = questions[id] as Question;
    if (q.instructions.trim() === "") return `question ${id} needs instructions`;
    if (q.type === "choice" && Object.keys(q.criteria).length < 2) return `choice ${id} needs at least two options`;
    if (q.type === "score" && (q.criteria.length < 2 || q.criteria.length > 10)) return `score ${id} needs 2 to 10 levels`;
  }
  return undefined;
}

function shortText(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, MAX_COOLDOWN_MS) : undefined;
}

export function createSystemOneClient(deps: SystemOneClientDeps): SystemOneClient {
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 8000;
  const maxConcurrent = Math.max(1, deps.maxConcurrent ?? 4);
  const cacheTtlMs = deps.cacheTtlMs ?? 10 * 60_000;
  const maxRetries = deps.maxRetries ?? 2;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const stats: CallStat[] = [];
  const cache = new Map<string, { at: number; answers: unknown; model: string; inputTokens: number }>();
  let cooldownUntil = 0;
  let cooldownState: "rate_limited" | "payment" | "degraded" = "degraded";
  let lastError: string | undefined;
  let lastOkAt: number | undefined;
  let consecutiveFailures = 0;

  let active = 0;
  const waiting: (() => void)[] = [];
  async function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  function release(): void {
    const next = waiting.shift();
    if (next === undefined) active -= 1;
    else next();
  }

  function record(stat: CallStat): void {
    stats.push(stat);
    if (stats.length > STATS_WINDOW) stats.shift();
  }

  function trip(state: "rate_limited" | "payment" | "degraded", ms: number, detail: string): void {
    cooldownUntil = deps.clock.now() + ms;
    cooldownState = state;
    lastError = detail;
    deps.log.warn("system one cooling down", { state, seconds: Math.round(ms / 1000), detail });
  }

  function failure<M extends QuestionMap>(reason: AskFailure, detail: string, retry?: number): AskResult<M> {
    lastError = detail;
    return { ok: false, reason, detail, ...(retry === undefined ? {} : { retryAfterMs: retry }) };
  }

  async function post(body: string): Promise<{ response: Response; text: string } | { error: string; timedOut: boolean }> {
    try {
      const response = await doFetch(deps.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${deps.apiKey ?? ""}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { response, text: await response.text() };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      return { error: name === "TimeoutError" || name === "AbortError" ? "request timed out" : shortText(String(error)), timedOut: name === "TimeoutError" || name === "AbortError" };
    }
  }

  async function ask<M extends QuestionMap>(request: AskRequest<M>): Promise<AskResult<M>> {
    if (deps.apiKey === undefined || deps.apiKey === "") return failure("unconfigured", "no System One API key is configured");
    const invalid = validateQuestions(request.questions);
    if (invalid !== undefined) return failure("invalid_request", invalid);
    const now = deps.clock.now();
    if (now < cooldownUntil) {
      return failure(cooldownState === "payment" ? "payment" : "rate_limited", lastError ?? "cooling down", cooldownUntil - now);
    }

    const body = JSON.stringify({ model: deps.model, state: request.state, questions: request.questions });
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return failure("invalid_request", "state and questions exceed the 96 KiB cap");

    const key = createHash("sha256").update(body).digest("hex");
    const hit = request.fresh === true ? undefined : cache.get(key);
    if (hit !== undefined && now - hit.at < cacheTtlMs) {
      return { ok: true, answers: hit.answers as AnswersFor<M>, model: hit.model, latencyMs: 0, inputTokens: 0, cached: true };
    }

    await acquire();
    const started = deps.clock.now();
    try {
      for (let attempt = 0; ; attempt += 1) {
        const sent = await post(body);
        if ("error" in sent) {
          if (attempt < maxRetries) {
            await sleep(250 * 2 ** attempt);
            continue;
          }
          record({ at: deps.clock.now(), ok: false, latencyMs: deps.clock.now() - started, inputTokens: 0 });
          consecutiveFailures += 1;
          if (consecutiveFailures >= 3) trip("degraded", SHORT_RATE_COOLDOWN_MS, sent.error);
          return failure(sent.timedOut ? "timeout" : "http", sent.error);
        }
        const { response, text } = sent;
        const status = response.status;

        if (status === 200) {
          let parsed;
          try {
            parsed = SystemOneResponseSchema.safeParse(JSON.parse(text));
          } catch {
            parsed = undefined;
          }
          if (parsed === undefined || !parsed.success) {
            record({ at: deps.clock.now(), ok: false, latencyMs: deps.clock.now() - started, inputTokens: 0 });
            return failure("bad_response", "response did not match the System One schema");
          }
          const answers = parsed.data.answers;
          for (const [id, question] of Object.entries(request.questions)) {
            if (answers[id]?.type !== question.type) {
              record({ at: deps.clock.now(), ok: false, latencyMs: deps.clock.now() - started, inputTokens: 0 });
              return failure("bad_response", `answer for ${id} is missing or the wrong type`);
            }
          }
          const latencyMs = deps.clock.now() - started;
          const inputTokens = parsed.data.usage?.input_tokens ?? 0;
          record({ at: deps.clock.now(), ok: true, latencyMs, inputTokens });
          consecutiveFailures = 0;
          lastOkAt = deps.clock.now();
          if (request.fresh !== true) {
            if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
            cache.set(key, { at: deps.clock.now(), answers, model: parsed.data.model, inputTokens });
          }
          return { ok: true, answers: answers as AnswersFor<M>, model: parsed.data.model, latencyMs, inputTokens, cached: false };
        }

        record({ at: deps.clock.now(), ok: false, latencyMs: deps.clock.now() - started, inputTokens: 0 });
        const detail = `HTTP ${status}: ${shortText(text)}`;

        if (status === 402) {
          trip("payment", PAYMENT_COOLDOWN_MS, detail);
          return failure("payment", detail, PAYMENT_COOLDOWN_MS);
        }
        if (status === 401 || status === 403) {
          trip("degraded", AUTH_COOLDOWN_MS, detail);
          return failure("http", detail, AUTH_COOLDOWN_MS);
        }
        if (status === 400 || status === 413 || status === 415 || status === 422) return failure("invalid_request", detail);

        if (status === 429 || status === 529 || status >= 500) {
          const wait = retryAfterMs(response);
          const quotaExhausted = /FreeUsageLimitError/.test(text) || (wait !== undefined && wait > 30_000);
          if (status === 429 && quotaExhausted) {
            const cool = wait ?? DEFAULT_QUOTA_COOLDOWN_MS;
            trip("rate_limited", cool, detail);
            return failure("rate_limited", detail, cool);
          }
          if (attempt < maxRetries) {
            await sleep(Math.min(wait ?? 250 * 2 ** attempt, 5000));
            continue;
          }
          consecutiveFailures += 1;
          if (status === 429) {
            trip("rate_limited", SHORT_RATE_COOLDOWN_MS, detail);
            return failure("rate_limited", detail, SHORT_RATE_COOLDOWN_MS);
          }
          if (consecutiveFailures >= 3) trip("degraded", SHORT_RATE_COOLDOWN_MS, detail);
          return failure("http", detail);
        }
        return failure("http", detail);
      }
    } finally {
      release();
    }
  }

  function status(): SystemOneStatus {
    const now = deps.clock.now();
    const recent = stats.filter((s) => now - s.at < DAY_MS);
    const okRecent = recent.filter((s) => s.ok);
    const latencies = stats.filter((s) => s.ok).map((s) => s.latencyMs).sort((a, b) => a - b);
    const median = latencies.length === 0 ? undefined : latencies[Math.floor(latencies.length / 2)];
    const unconfigured = deps.apiKey === undefined || deps.apiKey === "";
    const cooling = now < cooldownUntil;
    const state: SystemOneStatus["state"] = unconfigured
      ? "unconfigured"
      : cooling
        ? cooldownState
        : consecutiveFailures > 0
          ? "degraded"
          : "ok";
    return {
      state,
      model: deps.model,
      calls24h: okRecent.length,
      inputTokens24h: okRecent.reduce((sum, s) => sum + s.inputTokens, 0),
      ...(median === undefined ? {} : { medianLatencyMs: median }),
      ...(cooling ? { cooldownUntil } : {}),
      ...(lastError !== undefined && state !== "ok" ? { lastError } : {}),
      ...(lastOkAt === undefined ? {} : { lastOkAt }),
    };
  }

  return {
    ask,
    status,
    available: () => deps.apiKey !== undefined && deps.apiKey !== "" && deps.clock.now() >= cooldownUntil,
  };
}

/** Reads the key from SYSTEMONE_API_KEY, or from a file holding the bare key or a KEY=value line. */
export function parseKeyFile(text: string): string | undefined {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?[A-Za-z0-9_]*=(.*)$/.exec(line);
    const value = (match === null ? line : (match[1] ?? "")).trim().replace(/^["']|["']$/g, "");
    return value === "" ? undefined : value;
  }
  return undefined;
}
