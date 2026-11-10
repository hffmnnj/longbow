import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { StreamableHttpTransport } from "@earendil-works/pi-mcp";
import { loadConfig } from "../config.ts";
import type { Logger } from "../ports.ts";
import { createRobinhoodBroker, type RobinhoodBroker } from "./broker.ts";
import { MCP_URL, type Authorize } from "./oauth.ts";
import { TokenStore } from "./token-store.ts";

type Client = ReturnType<NonNullable<Parameters<typeof createRobinhoodBroker>[0]["createClient"]>>;

async function fixture(mode: "transient" | "invalid") {
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
    async listTools() { return [{ name: "get_accounts", inputSchema: { type: "object", properties: {} } }]; },
    async callTool() { return { content: [{ type: "text", text: JSON.stringify({ data: { accounts: [{ account_number: "mcp", agentic_allowed: true }] } }) }] }; },
    onClose(listener) { closed = listener; return () => {}; },
    onNotification() { return () => {}; },
    async close() {},
  });
  const broker = createRobinhoodBroker({ config: loadConfig({ DATA_DIR: dir }), clock: { now: () => 1000 }, log, authorize, createClient,
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
