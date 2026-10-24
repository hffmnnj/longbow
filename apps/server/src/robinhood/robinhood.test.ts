import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { createRegistry, type ToolRegistration } from "@earendil-works/pi-durable";
import { startAuthorization, type McpOAuthState, type OAuthClientProvider } from "@earendil-works/pi-mcp/oauth";
import type { Tool } from "@earendil-works/pi-mcp";
import type { OrderIntent } from "@rh/shared";
import { TokenStore } from "./token-store.ts";
import { DISCOVERY, MCP_URL, RobinhoodOAuth, type Authorize } from "./oauth.ts";
import { robinhoodExtension } from "./tools.ts";
import { BrokerMappingError, orderMapping, parseQuote, parseSnapshot, readMapping, tradingAccount } from "./mapping.ts";

test("token storage is private, atomic across concurrent saves, and never persists PKCE", async () => {
  const directory = await mkdtemp("/tmp/rh-storage-test-");
  const store = new TokenStore(directory);
  try {
    assert.equal(await store.load(), undefined);
    await Promise.all([store.save({ serverUrl: MCP_URL, tokens: { access_token: "first", token_type: "Bearer" } }),
      store.save({ serverUrl: MCP_URL, tokens: { access_token: "second", token_type: "Bearer" }, codeVerifier: "secret-verifier", oauthState: "secret-state" })]);
    assert.equal((await stat(store.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(store.directory, "oauth.json"))).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(join(store.directory, "oauth.json"), "utf8")), {
      serverUrl: MCP_URL, tokens: { access_token: "second", token_type: "Bearer" },
    });
    assert.equal((await store.load())?.tokens?.access_token, "second");
  } finally {
    await unlink(join(store.directory, "oauth.json"));
    await rmdir(store.directory); await rmdir(directory);
  }
});

function oauthFixture() {
  let now = 1000;
  let stored: McpOAuthState | undefined;
  let exchanges = 0;
  const authorize: Authorize = async (provider: OAuthClientProvider, options) => {
    if (options.authorizationCode) {
      assert.ok((await provider.codeVerifier()).length >= 43);
      exchanges++;
      await provider.saveTokens({ access_token: "test-access", token_type: "Bearer" });
      return "AUTHORIZED";
    }
    const authorization = await startAuthorization("https://robinhood.com", {
      metadata: DISCOVERY.authorizationServerMetadata, clientInformation: { client_id: "fake-client" },
      redirectUrl: provider.redirectUrl, state: await provider.state?.(), scope: "internal",
    });
    await provider.saveCodeVerifier(authorization.codeVerifier);
    await provider.redirectToAuthorization(authorization.authorizationUrl);
    return "REDIRECT";
  };
  const oauth = new RobinhoodOAuth({ redirectUrl: "http://127.0.0.1:4520/api/robinhood/callback", clock: { now: () => now }, authorize,
    store: { load: () => stored, save: (state) => { stored = structuredClone(state); } },
  });
  return { oauth, advance: (duration: number) => { now += duration; }, exchanges: () => exchanges };
}

test("completeConnect rejects unknown and missing state before attempting an exchange", async () => {
  const { oauth, exchanges } = oauthFixture();
  await assert.rejects(oauth.completeConnect(new URLSearchParams({ state: "unknown", code: "private-code" })), /Invalid or expired Robinhood OAuth state/);
  await assert.rejects(oauth.completeConnect(new URLSearchParams({ code: "private-code" })), /Invalid or expired Robinhood OAuth state/);
  assert.equal(exchanges(), 0);
});

test("OAuth uses PKCE, exchanges a valid callback once, and rejects replay", async () => {
  const { oauth, exchanges } = oauthFixture();
  const url = new URL(await oauth.beginConnect());
  assert.equal(url.origin + url.pathname, "https://robinhood.com/oauth");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("code_challenge"));
  const callback = new URLSearchParams({ state: url.searchParams.get("state")!, code: "private-code" });
  await oauth.completeConnect(callback);
  assert.equal((await oauth.provider.tokens())?.access_token, "test-access");
  await assert.rejects(oauth.completeConnect(callback), /Invalid or expired Robinhood OAuth state/);
  assert.equal(exchanges(), 1);
});

test("OAuth expires pending state after ten minutes", async () => {
  const { oauth, exchanges, advance } = oauthFixture();
  const url = new URL(await oauth.beginConnect());
  advance(600_000);
  await assert.rejects(oauth.completeConnect(new URLSearchParams({ state: url.searchParams.get("state")!, code: "private-code" })), /Invalid or expired/);
  assert.equal(exchanges(), 0);
});

function tool(name: string): Tool { return { name, inputSchema: { type: "object", properties: {} } }; }
test("model exposure hides place tools, retains reads and review, and installs a blocking hook", () => {
  const extension = robinhoodExtension({ tools: [tool("place_equity_order"), tool("review_equity_order"), tool("get_portfolio")],
    status: () => ({ state: "needs_auth", tools: [] }), call: async () => { throw new Error("must not call"); },
  });
  assert.deepEqual(extension.tools?.map((tool) => tool.name), ["rh_status", "rh_review_equity_order", "rh_get_portfolio"]);
  const handler = extension.hooks?.[0]?.handlers as { beforeTool(call: { name: string }): unknown };
  assert.deepEqual(handler.beforeTool({ name: "rh_place_equity_order" }), { block: "Order placement is only available through the deterministic order gate." });
  assert.equal(handler.beforeTool({ name: "rh_review_equity_order" }), undefined);
});

test("registry reinstall replaces removed tools rather than accumulating stale proxies", () => {
  const registry = createRegistry();
  const options = { status: () => ({ state: "needs_auth" as const, tools: [] }), call: async () => ({ content: [] }) };
  registry.install(robinhoodExtension({ ...options, tools: [tool("get_portfolio")] }));
  registry.install(robinhoodExtension({ ...options, tools: [tool("get_quote")] }));
  assert.equal(registry.snapshot().installed().length, 1);
  assert.deepEqual(registry.snapshot().tools().map(({ tool }) => tool.name), ["rh_status", "rh_get_quote"]);
});

test("rh_status works disconnected", async () => {
  const extension = robinhoodExtension({ tools: [], status: () => ({ state: "needs_auth", tools: [] }), call: async () => { throw new Error("must not call"); } });
  const status = extension.tools?.[0] as ToolRegistration;
  // Status uses no execution services or context.
  const execute = status.execute as (args: Record<string, unknown>) => Promise<{ output: unknown[] }>;
  assert.deepEqual((await execute({})).output, [{ type: "text", text: '{"state":"needs_auth","tools":[]}' }]);
});

test("remote tool proxies only return bounded text and redact remote errors", async () => {
  let failure = false;
  const extension = robinhoodExtension({ tools: [tool("get_portfolio")], status: () => ({ state: "connected", tools: [] }),
    call: async () => failure
      ? { isError: true, content: [{ type: "text", text: "sensitive-provider-error-body" }] }
      : { content: [{ type: "text", text: "x".repeat(20_000) }, { type: "image", data: "untrusted-image", mimeType: "image/png" }] },
  });
  const proxy = extension.tools?.[1] as ToolRegistration;
  const execute = proxy.execute as unknown as (args: Record<string, unknown>, api: unknown, context: { abortSignal?: AbortSignal }) => Promise<{ output: { type: string; text: string }[]; isError?: boolean }>;
  const result = await execute({}, {}, {});
  assert.deepEqual(result.output, [{ type: "text", text: `Untrusted Robinhood tool result:\n${"x".repeat(12_000)}` }]);
  failure = true;
  assert.deepEqual(await execute({}, {}, {}), { isError: true, output: [{ type: "text", text: "Robinhood tool reported an error." }] });
});

test("mapping rejects missing required schema fields instead of sending guessed arguments", () => {
  const discovered: Tool = { name: "get_quote", inputSchema: { type: "object", properties: { symbol: { type: "string" }, instrument_id: { type: "string" } }, required: ["symbol", "instrument_id"] } };
  assert.throws(() => readMapping([discovered], "quote", "SPY"), (error) => error instanceof BrokerMappingError && error.message === "get_quote: missing required field instrument_id");
});

test("mapping validates discovered schema constraints, not only required field names", () => {
  const discovered: Tool = { name: "get_quote", inputSchema: { type: "object", properties: { symbol: { type: "string", pattern: "^[A-Z]+$" } }, required: ["symbol"] } };
  assert.deepEqual(readMapping([discovered], "quote", "SPY").args, { symbol: "SPY" });
  assert.throws(() => readMapping([discovered], "quote", "not a ticker"), (error) => error instanceof BrokerMappingError && /do not match discovered inputSchema/.test(error.message));
});

const intent: OrderIntent = { symbol: "SPY", side: "buy", quantity: 2, orderType: "limit", limitPrice: 500,
  timeInForce: "day", invalidationPrice: 490, timeStopDate: "2026-11-01", thesis: "A sufficiently detailed test thesis", probabilityWin: 0.6,
  expectedGainPct: 4, expectedLossPct: 2, estimatedCostPct: 0.1, evidence: ["test quote"] };
function placeTool(extra: Record<string, unknown> = {}): Tool {
  return { name: "place_equity_order", inputSchema: { type: "object", additionalProperties: false,
    properties: { symbol: { type: "string" }, side: { enum: ["buy", "sell"] }, quantity: { type: "number" },
      type: { enum: ["limit", "stop_limit"] }, price: { type: "number" }, time_in_force: { enum: ["day", "gtc"] }, ...extra },
    required: ["symbol", "side", "quantity", "type", "price", "time_in_force"],
  } };
}
test("placement fails closed without idempotency or with an unidentified account selector", () => {
  assert.throws(() => orderMapping([placeTool()], "place", intent), /no supported idempotency field/);
  assert.throws(() => orderMapping([placeTool({ client_order_id: { type: "string" }, account_id: { type: "string" } })], "place", intent), /MCP trading account has not been identified/);
});

test("placement passes the dedicated account and a stable retry id without changing order economics", () => {
  const schema = placeTool({ client_order_id: { type: "string" }, account_id: { type: "string" } });
  const first = orderMapping([schema], "place", intent, "dedicated-mcp-account");
  const second = orderMapping([schema], "place", intent, "dedicated-mcp-account");
  assert.deepEqual(first.args, second.args);
  assert.match(String(first.args.client_order_id), /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.deepEqual({ ...first.args, client_order_id: "stable-id" }, { account_id: "dedicated-mcp-account", symbol: "SPY", side: "buy", quantity: 2, type: "limit", price: 500, time_in_force: "day", client_order_id: "stable-id" });
  assert.notEqual(orderMapping([schema], "place", { ...intent, quantity: 3 }, "dedicated-mcp-account").args.client_order_id, first.args.client_order_id);
});

test("account parsing never selects an unmarked or ambiguous brokerage account", () => {
  assert.throws(() => tradingAccount({ accounts: [{ id: "personal", equity: 50000 }] }), BrokerMappingError);
  assert.throws(() => tradingAccount({ accounts: [{ id: "personal", is_trading_account: true }] }), BrokerMappingError);
  assert.throws(() => tradingAccount({ accounts: [{ id: "a", is_mcp_account: true }, { id: "b", is_mcp_account: true }] }), BrokerMappingError);
  assert.deepEqual(tradingAccount({ accounts: [{ id: "personal" }, { id: "mcp", is_mcp_account: true }] }).accountId, "mcp");
});

test("snapshot and quote parse numeric strings without silently substituting zero", () => {
  assert.deepEqual(parseSnapshot({ equity: "1200", cash: "350", buying_power: "300", positions: [] }, 42), { at: 42, equity: 1200, cash: 350, buyingPower: 300, positions: [] });
  assert.deepEqual(parseQuote({ symbol: "SPY", bid_price: "499", ask_price: "501", last_trade_price: "500" }, "SPY", 43), { symbol: "SPY", bid: 499, ask: 501, last: 500, at: 43 });
  assert.throws(() => parseSnapshot({ cash: "350", buying_power: "300", positions: [] }, 42), /missing numeric equity/);
  assert.throws(() => parseQuote({ bid: "NaN", ask: "501", last: "500" }, "SPY", 43), BrokerMappingError);
});
