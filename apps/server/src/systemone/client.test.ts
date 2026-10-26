import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Logger } from "../ports.ts";
import { createSystemOneClient, parseKeyFile, type SystemOneClientDeps } from "./client.ts";
import type { NoulQuestion } from "./types.ts";

const LIVE = readFileSync(new URL("./fixtures/live-response.json", import.meta.url), "utf8");

const log: Logger = { info() {}, warn() {}, error() {}, child: () => log };

const questions = {
  headline_tone: {
    type: "choice",
    instructions: "What is the tone of the headline for shareholders?",
    criteria: { positive: "Good news", negative: "Bad news", neutral: "No clear impact" },
  },
  chasing: { type: "noul", instructions: "Would buying now be chasing an extended move?" },
  setup_quality: {
    type: "score",
    instructions: "How clean is the long setup?",
    criteria: ["Poor: conflicting signals", "Mixed: some support, some risk", "Clean: signals agree and risk is limited"],
  },
} as const;

function build(responses: (Response | Error)[], over: Partial<SystemOneClientDeps> = {}) {
  let now = 1_000_000;
  const calls: { url: string; init: RequestInit }[] = [];
  const queue = [...responses];
  const client = createSystemOneClient({
    url: "https://example.test/v1/systemone",
    model: "jev-latest",
    apiKey: "secret-key",
    clock: { now: () => now },
    log,
    sleep: async () => {},
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (next === undefined) throw new Error("unexpected extra request");
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch,
    ...over,
  });
  return { client, calls, advance: (ms: number) => (now += ms) };
}

const json = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "application/json", ...headers } });

describe("system one client", () => {
  it("parses a captured live response into typed answers and sends the request shape the API expects", async () => {
    const { client, calls } = build([json(LIVE)]);
    const result = await client.ask({ label: "t", state: { headline: "Raises guidance" }, questions });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.answers.headline_tone.choice, "positive");
    assert.equal(result.answers.chasing.noul, 0.86);
    assert.equal(result.answers.setup_quality.score, 1.04);
    assert.equal(result.model, "jev-1.14.0");
    assert.equal(result.inputTokens, 505);
    const sent = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    assert.equal(sent["model"], "jev-latest");
    assert.deepEqual(Object.keys(sent).sort(), ["model", "questions", "state"]);
    assert.equal((calls[0]?.init.headers as Record<string, string>)["Authorization"], "Bearer secret-key");
  });

  it("serves an identical ask from the cache without a second request", async () => {
    const { client, calls } = build([json(LIVE)]);
    await client.ask({ label: "t", state: "x", questions });
    const again = await client.ask({ label: "t", state: "x", questions });
    assert.equal(calls.length, 1);
    assert.equal(again.ok && again.cached, true);
  });

  it("fails fast without a key and never calls the network", async () => {
    const { client, calls } = build([], { apiKey: undefined });
    const result = await client.ask({ label: "t", state: "x", questions });
    assert.deepEqual(result.ok ? null : result.reason, "unconfigured");
    assert.equal(calls.length, 0);
    assert.equal(client.status().state, "unconfigured");
  });

  it("opens the breaker on a free-quota error and skips the network until the cooldown ends", async () => {
    const body = JSON.stringify({ type: "error", error: { type: "FreeUsageLimitError", message: "Free usage limit reached" } });
    const { client, calls, advance } = build([json(body, 429, { "retry-after": "26198" }), json(LIVE)]);
    const first = await client.ask({ label: "t", state: "x", questions });
    assert.equal(first.ok ? null : first.reason, "rate_limited");
    assert.equal(client.available(), false);
    const second = await client.ask({ label: "t", state: "y", questions });
    assert.equal(second.ok ? null : second.reason, "rate_limited");
    assert.equal(calls.length, 1, "no request while cooling down");
    const status = client.status();
    assert.equal(status.state, "rate_limited");
    assert.ok(status.cooldownUntil !== undefined && status.cooldownUntil > 1_000_000 + 26_000_000);
    advance(26_200_000);
    const third = await client.ask({ label: "t", state: "z", questions });
    assert.equal(third.ok, true);
    assert.equal(client.status().state, "ok");
  });

  it("reports a payment failure on 402", async () => {
    const { client } = build([json(JSON.stringify({ error: { message: "Insufficient account funds" } }), 402)]);
    const result = await client.ask({ label: "t", state: "x", questions });
    assert.equal(result.ok ? null : result.reason, "payment");
    assert.equal(client.status().state, "payment");
  });

  it("retries a 529 once then succeeds", async () => {
    const { client, calls } = build([json("{}", 529), json(LIVE)]);
    const result = await client.ask({ label: "t", state: "x", questions });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
  });

  it("rejects a response whose answer type does not match the question", async () => {
    const wrong = JSON.stringify({ model: "m", answers: { chasing: { type: "choice", choice: "a", confidence: 1, probabilities: { a: 1 } } } });
    const q: Record<string, NoulQuestion> = { chasing: questions.chasing };
    const { client } = build([json(wrong)]);
    const result = await client.ask({ label: "t", state: "x", questions: q });
    assert.equal(result.ok ? null : result.reason, "bad_response");
  });

  it("rejects malformed questions before sending", async () => {
    const { client, calls } = build([]);
    const result = await client.ask({
      label: "t",
      state: "x",
      questions: { one: { type: "choice", instructions: "pick", criteria: { only: "one option" } } },
    });
    assert.equal(result.ok ? null : result.reason, "invalid_request");
    assert.equal(calls.length, 0);
  });

  it("never leaks the key into failure details", async () => {
    const { client } = build([new Error("connect ECONNREFUSED"), new Error("connect ECONNREFUSED"), new Error("connect ECONNREFUSED")]);
    const result = await client.ask({ label: "t", state: "x", questions });
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes("secret-key"));
  });
});

describe("parseKeyFile", () => {
  it("reads a bare key, an env line, and skips comments", () => {
    assert.equal(parseKeyFile("abc123\n"), "abc123");
    assert.equal(parseKeyFile("# note\nTYPESAFE_API_KEY=abc123\n"), "abc123");
    assert.equal(parseKeyFile('export TYPESAFE_API_KEY="abc123"'), "abc123");
    assert.equal(parseKeyFile("\n\n"), undefined);
  });
});
