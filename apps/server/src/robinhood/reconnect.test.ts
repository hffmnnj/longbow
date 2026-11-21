import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { McpHttpError, McpTimeoutError, StreamableHttpTransport } from "@earendil-works/pi-mcp";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { OrderIntent } from "@rh/shared";
import { loadConfig } from "../config.ts";
import type { Logger } from "../ports.ts";
import { createRobinhoodBroker, type RobinhoodBroker } from "./broker.ts";
import { PlacementQuoteUnavailableError } from "./mapping.ts";
import { MCP_URL, type Authorize } from "./oauth.ts";
import { TokenStore } from "./token-store.ts";

type Client = ReturnType<NonNullable<Parameters<typeof createRobinhoodBroker>[0]["createClient"]>>;

async function fixture(mode: "transient" | "invalid", handler?: Client["callTool"]) {
  const dir = await mkdtemp("/var/tmp/james/opencode/robinhood-retry-");
  const store = new TokenStore(dir);
  await store.save({ serverUrl: MCP_URL, tokensExpireAt: 1, tokens: { access_token: "access", refresh_token: "refresh", token_type: "Bearer" } });
  let attempts = 0;
  let available = false;
  let closed: (() => void) | undefined;
  const timers: Array<{ fire: () => void; cancelled: boolean; delay: number }> = [];
  const warnings: Array<{ msg: string; fields?: Record<string, unknown> }> = [];
  const log: Logger = { info() {}, error() {}, child() { return this; }, warn(msg, fields) { warnings.push({ msg, fields }); } };
  const authorize: Authorize = async (provider) => {
    if (mode === "invalid") {
      await provider.invalidateCredentials?.("tokens");
      throw new Error("invalid grant");
    }
    if (!available) throw new TypeError("secret response body https://example.com/?token=secret");
    await provider.saveTokens({ access_token: "new-access", refresh_token: "new-refresh", token_type: "Bearer", expires_in: 3600 });
    return "AUTHORIZED";
  };
  const createClient = (): Client => ({
    async connect(transport) {
      attempts++;
      assert.ok(transport instanceof StreamableHttpTransport);
      await transport.options.authProvider?.token();
      return { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "fake", version: "1" } };
    },
    async listTools() { return ["get_accounts", "get_portfolio", "get_advanced_orders", "get_sensitive_secret", "get_equity_quotes", "place_equity_order"].map((name) => ({ name, inputSchema: { type: "object", properties: { ref_id: { type: "string" } }, additionalProperties: true } })); },
    async callTool(name, args, options) {
      if (name === "get_accounts") return { content: [{ type: "text", text: JSON.stringify({ data: { accounts: [{ account_number: "mcp", agentic_allowed: true }] } }) }] };
      if (!handler) throw new Error("unexpected call");
      return handler(name, args, options);
    },
    onClose(listener) { closed = listener; return () => {}; },
    onNotification() { return () => {}; },
    async close() {},
  });
  const broker = createRobinhoodBroker({ config: loadConfig({ DATA_DIR: dir, HARNESS_LIVE_TRADING: "1" }), clock: { now: () => 1000 }, log, authorize, createClient,
    scheduleReconnect(fire, delay) {
      const timer = { fire, delay, cancelled: false }; timers.push(timer);
      return () => { timer.cancelled = true; };
    },
  });
  return { broker, store, timers, warnings, attempts: () => attempts, makeAvailable: () => { available = true; }, drop: () => closed?.(),
    async cleanup() {
      await broker.disconnect();
      await unlink(join(store.directory, "oauth.json"));
      await unlink(join(store.directory, "tools.json")).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      await rmdir(store.directory); await rmdir(dir);
    },
  };
}

function untilState(broker: RobinhoodBroker, expected: ReturnType<RobinhoodBroker["status"]>["state"]): Promise<void> {
  if (broker.status().state === expected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { off(); reject(new Error(`Timed out waiting for ${expected}`)); }, 2000);
    const off = broker.onChange(() => {
      if (broker.status().state === expected) { clearTimeout(timeout); off(); resolve(); }
    });
  });
}

test("temporary refresh failure keeps credentials and reconnects after transport recovers", async () => {
  const f = await fixture("transient");
  try {
    await untilState(f.broker, "error");
    assert.equal((await f.store.load())?.tokens?.refresh_token, "refresh");
    assert.equal(f.timers.length, 1);
    assert.ok(f.timers[0]!.delay >= 13_500 && f.timers[0]!.delay <= 16_500);
    assert.equal(JSON.stringify(f.warnings).includes("secret"), false);
    f.makeAvailable();
    const connected = untilState(f.broker, "connected");
    f.timers[0]!.fire();
    await connected;
    assert.equal(f.attempts(), 2);
    assert.equal((await f.store.load())?.tokens?.refresh_token, "new-refresh");
    f.drop();
    await untilState(f.broker, "error");
    assert.equal(f.timers.length, 2);
  } finally { await f.cleanup(); }
});

test("invalid refresh grant requires sign-in without retrying", async () => {
  const f = await fixture("invalid");
  try {
    await untilState(f.broker, "needs_auth");
    assert.equal((await f.store.load())?.tokens, undefined);
    assert.equal(f.attempts(), 1);
    assert.equal(f.timers.length, 0);
  } finally { await f.cleanup(); }
});

test("a stale reconnect callback cannot reconnect after disconnect", async () => {
  const f = await fixture("transient");
  try {
    await untilState(f.broker, "error");
    const timer = f.timers[0]!;
    await f.broker.disconnect();
    assert.equal(timer.cancelled, true);
    timer.fire();
    await f.broker.disconnect(); // Flush any incorrectly enqueued lifecycle work.
    assert.equal(f.attempts(), 1);
    assert.equal(f.broker.status().state, "needs_auth");
  } finally { await f.cleanup(); }
});

test("broker diagnostics redact untrusted failures and never retry ambiguous placement", async () => {
  const calls: string[] = [];
  const f = await fixture("transient", async (name) => {
    calls.push(name);
    if (name === "get_portfolio" || name === "get_advanced_orders") return { isError: true, content: [{ type: "text", text: "secret response body" }] };
    const cause = new McpHttpError(503, "secret URL", "secret body");
    throw new Error("secret outer", { cause });
  });
  try {
    await untilState(f.broker, "error");
    f.makeAvailable();
    const connected = untilState(f.broker, "connected");
    f.timers[0]!.fire();
    await connected;
    f.warnings.length = 0;
    await assert.rejects(f.broker.snapshot(), { message: "Robinhood tool reported an error" });
    const advanced = f.broker.extension().tools?.find((item) => item.name === "rh_get_advanced_orders") as ToolRegistration;
    assert.ok(advanced);
    const advancedResult = await advanced.execute({}, {} as never, { abortSignal: new AbortController().signal } as never);
    const unknown = f.broker.extension().tools?.find((item) => item.name === "rh_get_sensitive_secret") as ToolRegistration;
    assert.ok(unknown);
    const result = await unknown.execute({}, {} as never, { abortSignal: new AbortController().signal } as never);
    const intent = { symbol: "AAPL", side: "sell", quantity: 1, orderType: "limit", limitPrice: 100, timeInForce: "day" } as OrderIntent;
    await assert.rejects(f.broker.placeOrder(intent), { message: "Robinhood tool request failed; reconcile any uncertain order before retrying" });
    assert.deepEqual(calls, ["get_portfolio", "get_advanced_orders", "get_sensitive_secret", "place_equity_order"]);
    assert.deepEqual(f.warnings, [
      { msg: "Robinhood tool response failed", fields: { operation: "get_portfolio", classification: "tool_error" } },
      { msg: "Robinhood tool response failed", fields: { operation: "get_advanced_orders", classification: "tool_error" } },
      { msg: "Robinhood tool request failed", fields: { operation: "unknown", name: "McpHttpError", status: 503 } },
      { msg: "Robinhood tool request failed", fields: { operation: "place_equity_order", name: "McpHttpError", status: 503 } },
    ]);
    assert.doesNotMatch(JSON.stringify({ warnings: f.warnings, result, advancedResult }), /secret|503.*body/i);
  } finally { await f.cleanup(); }
});

test("broker diagnostics classify only bounded allowlisted transport causes", async () => {
  const codes = ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
    "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"];
  const coded = (code: string) => Object.assign(new Error("secret cause"), { code });
  const failures: Error[] = [
    ...codes.map((code) => new TypeError("secret outer", { cause: coded(code) })),
    new TypeError("secret outer", { cause: coded("secret code") }),
    new TypeError("secret outer"),
    new TypeError("secret outer", { cause: { code: "ECONNRESET", message: "secret object" } }),
    new TypeError("secret outer", { cause: new Error("secret", { cause: new Error("secret", {
      cause: new Error("secret", { cause: coded("ECONNRESET") }),
    }) }) }),
    new McpTimeoutError(30_000),
  ];
  let calls = 0;
  const f = await fixture("transient", async () => { throw failures[calls++]; });
  try {
    await untilState(f.broker, "error");
    f.makeAvailable();
    const connected = untilState(f.broker, "connected");
    f.timers[0]!.fire();
    await connected;
    f.warnings.length = 0;
    for (const _failure of failures) {
      await assert.rejects(f.broker.snapshot(), { message: "Robinhood tool request failed; reconcile any uncertain order before retrying" });
    }
    assert.equal(calls, failures.length);
    assert.equal(JSON.stringify(f.warnings).includes("secret"), false, "diagnostic logs must not contain untrusted text");
    assert.deepEqual(f.warnings, [
      ...codes.map((code) => ({ msg: "Robinhood tool request failed", fields: { operation: "get_portfolio", name: "Error", code } })),
      ...["Error", "TypeError", "TypeError", "Error"].map((name) => ({ msg: "Robinhood tool request failed", fields: { operation: "get_portfolio", name } })),
      { msg: "Robinhood tool request failed", fields: { operation: "get_portfolio", name: "McpTimeoutError" } },
    ]);
  } finally { await f.cleanup(); }
});

test("a failed fractional placement quote is classified as definitely unplaced", async () => {
  const calls: string[] = [];
  const f = await fixture("transient", async (name) => {
    calls.push(name);
    throw new McpTimeoutError(30_000);
  });
  try {
    await untilState(f.broker, "error");
    f.makeAvailable();
    const connected = untilState(f.broker, "connected");
    f.timers[0]!.fire();
    await connected;
    const intent = { symbol: "AAPL", side: "sell", quantity: 0.25, orderType: "limit", limitPrice: 100, timeInForce: "day" } as OrderIntent;
    await assert.rejects(f.broker.placeOrder(intent), PlacementQuoteUnavailableError);
    assert.deepEqual(calls, ["get_equity_quotes"]);
  } finally { await f.cleanup(); }
});
