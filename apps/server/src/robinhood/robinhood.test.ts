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
import { robinhoodExtension, modelTools, beforeRobinhoodTool, robinhoodCallAllowed } from "./tools.ts";
import { BrokerMappingError, orderMapping, parseQuote, parseSnapshot, readMapping, tradingAccount, responseObject, fetchSnapshot, fetchQuotes, fractionalExecution, parseOrder, validateReview } from "./mapping.ts";

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
  const discovered: Tool = { name: "get_equity_quotes", inputSchema: { type: "object", properties: { symbols: { type: "array", items: { type: "string" } }, instrument_id: { type: "string" } }, required: ["symbols", "instrument_id"] } };
  assert.throws(() => readMapping([discovered], "quote", "SPY"), (error) => error instanceof BrokerMappingError && error.message === "get_equity_quotes: missing required field instrument_id");
});

test("mapping validates discovered schema constraints, not only required field names", () => {
  const discovered: Tool = { name: "get_equity_quotes", inputSchema: { type: "object", properties: { symbols: { type: "array", items: { type: "string", pattern: "^[A-Z]+$" } } }, required: ["symbols"] } };
  assert.deepEqual(readMapping([discovered], "quote", "SPY").args, { symbols: ["SPY"] });
  assert.throws(() => readMapping([discovered], "quote", "not a ticker"), (error) => error instanceof BrokerMappingError && /do not match discovered inputSchema/.test(error.message));
});

const intent: OrderIntent = { symbol: "SPY", side: "buy", quantity: 2, orderType: "limit", limitPrice: 500,
  timeInForce: "day", invalidationPrice: 490, timeStopDate: "2026-11-01", thesis: "A sufficiently detailed test thesis", probabilityWin: 0.6,
  expectedGainPct: 4, expectedLossPct: 2, estimatedCostPct: 0.1, evidence: ["test quote"] };
function placeTool(extra: Record<string, unknown> = {}): Tool {
  return { name: "place_equity_order", inputSchema: { type: "object", additionalProperties: false,
    properties: { account_number: { type: "string" }, symbol: { type: "string" }, side: { enum: ["buy", "sell"] }, quantity: { type: "string" },
      type: { enum: ["market", "limit", "stop_limit"] }, limit_price: { type: "string" }, stop_price: { type: "string" }, market_hours: { const: "regular_hours" }, time_in_force: { enum: ["gfd", "gtc"] }, ...extra },
    required: ["account_number", "symbol", "side", "quantity", "type", "time_in_force"],
  } };
}
test("placement fails closed without idempotency or with an unidentified account selector", () => {
  assert.throws(() => orderMapping([placeTool()], "place", intent), /no supported idempotency field/);
  assert.throws(() => orderMapping([placeTool({ ref_id: { type: "string" } })], "place", intent), /MCP trading account has not been identified/);
});

test("placement passes the dedicated account and a stable retry id without changing order economics", () => {
  const schema = placeTool({ ref_id: { type: "string" } });
  const first = orderMapping([schema], "place", intent, "dedicated-mcp-account");
  const second = orderMapping([schema], "place", intent, "dedicated-mcp-account");
  assert.deepEqual(first.args, second.args);
  assert.match(String(first.args.ref_id), /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.deepEqual({ ...first.args, ref_id: "stable-id" }, { account_number: "dedicated-mcp-account", symbol: "SPY", side: "buy", quantity: "2", type: "limit", limit_price: "500.00", time_in_force: "gfd", market_hours: "regular_hours", ref_id: "stable-id" });
  assert.notEqual(orderMapping([schema], "place", { ...intent, quantity: 3 }, "dedicated-mcp-account").args.ref_id, first.args.ref_id);
  const stop = orderMapping([schema], "place", { ...intent, side: "sell", orderType: "stop_limit", stopPrice: 495.123, limitPrice: 494.999, timeInForce: "gtc" }, "dedicated-mcp-account");
  assert.equal(stop.args.stop_price, "495.12"); assert.equal(stop.args.limit_price, "495.00"); assert.equal(stop.args.type, "stop_limit"); assert.equal(stop.args.time_in_force, "gtc");
});

test("account parsing never selects an unmarked or ambiguous brokerage account", () => {
  assert.throws(() => tradingAccount({ accounts: [{ id: "personal", equity: 50000 }] }), BrokerMappingError);
  assert.throws(() => tradingAccount({ accounts: [{ id: "personal", is_trading_account: true }] }), BrokerMappingError);
  assert.throws(() => tradingAccount({ accounts: [{ account_number: "a", agentic_allowed: true }, { account_number: "b", agentic_allowed: true }] }), BrokerMappingError);
  assert.deepEqual(tradingAccount({ accounts: [{ account_number: "personal", agentic_allowed: false }, { account_number: "mcp", agentic_allowed: true, type: "limited_margin" }] }).accountId, "mcp");
});

test("snapshot and quote parse numeric strings without silently substituting zero", () => {
  assert.deepEqual(parseSnapshot({ total_value: "1200", cash: "350", buying_power: { buying_power: "300" } }, 42), { at: 42, equity: 1200, cash: 350, buyingPower: 300, positions: [] });
  assert.deepEqual(parseQuote(quoteData("SPY"), "SPY", 43), { symbol: "SPY", bid: 499, ask: 501, last: 502, at: 43 });
  assert.throws(() => parseSnapshot({ cash: "350", buying_power: "300" }, 42), /missing numeric total_value/);
  assert.throws(() => parseQuote({ bid: "NaN", ask: "501", last: "500" }, "SPY", 43), BrokerMappingError);
});

function quoteData(symbol: string) { return { results: [{ quote: { symbol, bid_price: "499", ask_price: "501", last_trade_price: "500", venue_last_trade_time: "2026-10-23T19:59:00Z", last_non_reg_trade_price: "502", venue_last_non_reg_trade_time: "2026-10-23T20:30:00Z" }, close: "498" }] }; }
test("text envelopes ignore guide and snapshots join every positions page to quote marks", async () => {
  assert.deepEqual(responseObject({ content: [{ type: "text", text: JSON.stringify({ data: { cash: "350" }, guide: "untrusted" }) }] }), { cash: "350" });
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const snapshot = await fetchSnapshot(async (name, args) => {
    calls.push({ name, args });
    if (name === "get_portfolio") return { total_value: "1229.01", cash: "370.99", buying_power: { buying_power: "370.9900" }, crypto_value: "0" };
    if (name === "get_equity_quotes") return { results: (args.symbols as string[]).flatMap((s) => quoteData(s).results) };
    return args.cursor ? { positions: [{ symbol: "NVDA", quantity: "0.832971", shares_available_for_sells: "0.800000" }] } : { positions: [{ symbol: "CDNS", quantity: "0.205652", average_buy_price: "291.760000", shares_available_for_sells: "0.205652" }], next: "page-two" };
  }, "masked-account", 42);
  assert.equal(snapshot.equity, 1229.01); assert.equal(snapshot.cash, 370.99); assert.equal(snapshot.buyingPower, 370.99); assert.equal(snapshot.settledCash, undefined);
  assert.equal(snapshot.positions.length, 2);
  assert.deepEqual(snapshot.positions[0], { symbol: "CDNS", quantity: 0.205652, averageCost: 291.76, marketValue: 502 * 0.205652, unrealizedPnl: (502 - 291.76) * 0.205652, sharesAvailableForSells: 0.205652 });
  assert.equal(snapshot.positions[1]?.unrealizedPnl, 0);
  assert.deepEqual(calls.filter((c) => c.name === "get_equity_positions").map((c) => c.args), [{ account_number: "masked-account" }, { account_number: "masked-account", cursor: "page-two" }]);
});
test("quotes batch at 20 symbols and reject invalid or crossed prices", async () => {
  const sizes: number[] = [];
  const symbols = Array.from({ length: 21 }, (_, i) => `S${i}`);
  assert.equal((await fetchQuotes(async (_name, args) => { const batch = args.symbols as string[]; sizes.push(batch.length); return { results: batch.flatMap((s) => quoteData(s).results) }; }, symbols, 42)).length, 21);
  assert.deepEqual(sizes, [20, 1]);
  for (const [bid, ask] of [[0, 501], [502, 501]]) { const data = quoteData("SPY"); data.results[0]!.quote.bid_price = String(bid); data.results[0]!.quote.ask_price = String(ask); assert.throws(() => parseQuote(data, "SPY", 42), /invalid quote/); }
});
test("fractional limits convert only when marketable in regular hours", () => {
  const fractional = { ...intent, quantity: 0.205652, limitPrice: 501 };
  const quote = parseQuote(quoteData("SPY"), "SPY", 42);
  assert.deepEqual(fractionalExecution(fractional, quote, true), { market: true });
  const mapped = orderMapping([placeTool({ ref_id: { type: "string" } })], "place", fractional, "masked", { market: true });
  assert.equal(mapped.args.type, "market"); assert.equal(mapped.args.quantity, "0.205652"); assert.equal(mapped.args.limit_price, undefined); assert.equal(mapped.args.dollar_amount, undefined);
  assert.throws(() => fractionalExecution({ ...fractional, limitPrice: 500 }, quote, true), /fractional limit not marketable now/);
  assert.throws(() => fractionalExecution(fractional, quote, false), /fractional limit not marketable now/);
  assert.deepEqual(fractionalExecution({ ...fractional, side: "sell", limitPrice: 499 }, quote, true), { market: true });
  assert.throws(() => fractionalExecution({ ...fractional, side: "sell", limitPrice: 500 }, quote, true), /fractional limit not marketable now/);
});
test("fractional execution refuses the observed SPY buy ceiling below the ask without repricing", () => {
  const order = { ...intent, quantity: 0.121, limitPrice: 770.51 };
  const quote = { symbol: "SPY", bid: 770.51, ask: 770.53, last: 770.51, at: 42 };
  assert.throws(() => fractionalExecution(order, quote, true), (error) => error instanceof BrokerMappingError && /SPY buy ask 770\.53, ceiling 770\.51/.test(error.message) && /not placed/.test(error.message));
  assert.equal(order.limitPrice, 770.51);
  assert.deepEqual(fractionalExecution({ ...order, limitPrice: 770.53 }, quote, true), { market: true });
});
test("mutating Robinhood tools are neither exposed nor callable", () => {
  const forbidden = ["exercise_option", "cancel_equity_order", "place_equity_order", "create_alert", "review_option_order", "get_limited_margin_upgrade_info"];
  assert.deepEqual(modelTools([...forbidden, "get_accounts", "search", "review_equity_order"].map(tool)).map((t) => t.name), ["get_accounts", "search", "review_equity_order"]);
  for (const name of forbidden) assert.ok(beforeRobinhoodTool({ name: `rh_${name}` })?.block);
  assert.equal(beforeRobinhoodTool({ name: "rh_get_accounts" }), undefined);
});
test("review blocks approval requirements and alerts; sync maps terminal and partial states", () => {
  assert.equal(validateReview({ customer_approval_required: false, order_checks: [] }), '{"customer_approval_required":false,"order_checks":[]}');
  assert.throws(() => validateReview({ customer_approval_required: true, order_checks: [] }), /requires customer approval/);
  assert.throws(() => validateReview({ order_checks: ["PDT alert"] }), /order_checks/);
  assert.deepEqual(parseOrder({ state: "partially_filled", cumulative_quantity: "0.2", average_price: "499.80" }), { status: "partially_filled", filledQuantity: 0.2, averageFillPrice: 499.8 });
  for (const state of ["filled", "cancelled", "rejected", "queued"]) assert.equal(parseOrder({ state, cumulative_quantity: "0" }).status, state === "rejected" ? "failed" : state === "queued" ? "submitted" : state);
});

test("the live-trading lock lets only read tools reach Robinhood until unlocked", () => {
  for (const write of ["place_equity_order", "cancel_equity_order", "exercise_option", "place_crypto_order"]) {
    assert.equal(robinhoodCallAllowed(write, false), false, `${write} is blocked while locked`);
    assert.equal(robinhoodCallAllowed(write, true), true, `${write} is allowed once unlocked`);
  }
  for (const read of ["get_accounts", "get_portfolio", "get_equity_quotes", "review_equity_order"]) {
    assert.equal(robinhoodCallAllowed(read, false), true, `${read} stays available while locked`);
  }
});
