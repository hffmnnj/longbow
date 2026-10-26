import { test } from "node:test";
import assert from "node:assert/strict";
import type { Tool } from "@earendil-works/pi-mcp";
import type { OrderIntent } from "@rh/shared";
import { BrokerMappingError, cryptoOrderMapping, fetchQuotes, fetchSnapshot, orderRef, parseCryptoOrder, parseCryptoQuote, tradingAccount, validateReview } from "./mapping.ts";

function closeTo(actual: number, expected: number, tolerance = 1e-6): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

function btcRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { symbol: "BTCUSD", bid_price: "79307.34", ask_price: "80817.6238153", mark_price: "80062.48190765",
    open_price: "79493.28", updated_at: "2026-10-26T13:48:19.233-04:00", ...overrides };
}
function ethRow(): Record<string, unknown> {
  return { symbol: "ETHUSD", bid_price: "3000", ask_price: "3050", mark_price: "3025",
    open_price: "2990", updated_at: "2026-10-26T13:48:19.233-04:00" };
}
function btcPositionRow(): Record<string, unknown> {
  return { currency: { code: "BTC" }, quantity: "0.00058109", quantity_transferable: "0.00058109", quantity_held_for_sell: "0",
    cost_bases: [{ direct_quantity: "0.0004", direct_cost_basis: "30", intraday_quantity: "0.00018109", intraday_cost_basis: "19.51" }] };
}

test("crypto quotes match the hyphenated pair and cap stale marks at the venue timestamp", () => {
  const updatedAt = Date.parse("2026-10-26T13:48:19.233-04:00");
  assert.ok(Number.isFinite(updatedAt));
  const quote = parseCryptoQuote({ results: [ethRow(), btcRow()] }, "BTC-USD", updatedAt + 60_000);
  assert.deepEqual(quote, { symbol: "BTC-USD", bid: 79307.34, ask: 80817.6238153, last: 80062.48190765, at: updatedAt });
  const fresh = parseCryptoQuote({ results: [btcRow()] }, "BTC-USD", updatedAt - 1000);
  assert.equal(fresh.at, updatedAt - 1000);
  const noStamp = parseCryptoQuote({ results: [btcRow({ updated_at: "not-a-time" })] }, "BTC-USD", 12345);
  assert.equal(noStamp.at, 12345);
});

test("crypto quotes reject missing symbols and invalid prices", () => {
  assert.throws(() => parseCryptoQuote({ results: [btcRow()] }, "ETH-USD", 1), /symbol mismatch/);
  assert.throws(() => parseCryptoQuote({ results: [] }, "BTC-USD", 1), /symbol mismatch/);
  assert.throws(() => parseCryptoQuote({ nope: true }, "BTC-USD", 1), /missing crypto quote results/);
  assert.throws(() => parseCryptoQuote({ results: [btcRow({ bid_price: "0" })] }, "BTC-USD", 1), /invalid crypto quote/);
  assert.throws(() => parseCryptoQuote({ results: [btcRow({ ask_price: "79000" })] }, "BTC-USD", 1), /invalid crypto quote/);
});

test("crypto quotes route through the crypto tool with the rhs account", async () => {
  const seen: Array<{ name: string; args: Record<string, unknown> }> = [];
  const quotes = await fetchQuotes(async (name, args) => {
    seen.push({ name, args });
    if (name === "get_crypto_quotes") return { results: [btcRow()] };
    throw new Error(`unexpected tool ${name}`);
  }, ["BTC-USD"], 42, "rhs-1");
  assert.deepEqual(seen, [{ name: "get_crypto_quotes", args: { symbols: ["BTC-USD"], rhs_account_number: "rhs-1" } }]);
  assert.equal(quotes[0]?.symbol, "BTC-USD");
});

test("crypto snapshot merges positions with cost-basis math and crypto buying power", async () => {
  const seen: Array<{ name: string; args: Record<string, unknown> }> = [];
  const snapshot = await fetchSnapshot(async (name, args) => {
    seen.push({ name, args });
    if (name === "get_portfolio") return { total_value: "1229.01", cash: "370.99", buying_power: { buying_power: "370.9900" },
      crypto_value: "46.01", crypto_buying_power: { buying_power: "665.2900" } };
    if (name === "get_equity_positions") return { positions: [] };
    if (name === "get_crypto_positions") return { positions: [btcPositionRow()] };
    if (name === "get_crypto_quotes") return { results: [btcRow()] };
    throw new Error(`unexpected tool ${name}`);
  }, "masked-account", 42, "rhs-1");
  assert.equal(snapshot.cryptoBuyingPower, 665.29);
  assert.equal(snapshot.positions.length, 1);
  const position = snapshot.positions[0]!;
  assert.equal(position.symbol, "BTC-USD");
  assert.equal(position.quantity, 0.00058109);
  assert.equal(position.sharesAvailableForSells, 0.00058109);
  assert.equal(position.sector, "Crypto");
  closeTo(position.averageCost, 49.51 / 0.00058109);
  closeTo(position.marketValue, 80062.48190765 * 0.00058109);
  closeTo(position.unrealizedPnl, 80062.48190765 * 0.00058109 - 49.51);
  assert.deepEqual(seen.find((call) => call.name === "get_crypto_positions")?.args, { rhs_account_number: "rhs-1" });
  assert.deepEqual(seen.find((call) => call.name === "get_crypto_quotes")?.args, { symbols: ["BTC-USD"], rhs_account_number: "rhs-1" });
});

test("crypto positions paginate, skip empty rows, and zero unknown bases", async () => {
  const snapshot = await fetchSnapshot(async (name, args) => {
    if (name === "get_portfolio") return { total_value: "1000", cash: "500", buying_power: { buying_power: "500" }, crypto_value: "10" };
    if (name === "get_equity_positions") return { positions: [] };
    if (name === "get_crypto_positions") {
      if (!("cursor" in args)) return { positions: [btcPositionRow()], next: "page-two" };
      assert.deepEqual(args, { rhs_account_number: "rhs-1", cursor: "page-two" });
      return { positions: [
        { currency: { code: "ETH" }, quantity: "0.01", quantity_transferable: "0.01", quantity_held_for_sell: "0", cost_bases: [] },
        { ...btcPositionRow(), quantity: "0" },
      ] };
    }
    if (name === "get_crypto_quotes") return { results: [btcRow(), ethRow()] };
    throw new Error(`unexpected tool ${name}`);
  }, "masked-account", 42, "rhs-1");
  assert.equal(snapshot.positions.length, 2);
  const eth = snapshot.positions.find((position) => position.symbol === "ETH-USD")!;
  assert.equal(eth.quantity, 0.01);
  assert.equal(eth.averageCost, 0);
  assert.equal(eth.unrealizedPnl, 0);
  assert.equal(eth.sector, "Crypto");
  closeTo(eth.marketValue, 3025 * 0.01);
  assert.equal(snapshot.cryptoBuyingPower, undefined);
});

test("crypto snapshot fails closed on repeated cursors and position errors", async () => {
  const portfolio = { total_value: "1000", cash: "500", buying_power: { buying_power: "500" }, crypto_value: "10" };
  await assert.rejects(fetchSnapshot(async (name) => {
    if (name === "get_portfolio") return portfolio;
    if (name === "get_equity_positions") return { positions: [] };
    return { positions: [], next: "stuck" };
  }, "masked-account", 42, "rhs-1"), /repeated a cursor/);
  await assert.rejects(fetchSnapshot(async (name) => {
    if (name === "get_portfolio") return portfolio;
    if (name === "get_equity_positions") return { positions: [] };
    throw new Error("crypto positions unavailable");
  }, "masked-account", 42, "rhs-1"), /crypto positions unavailable/);
});

test("equity snapshots with no crypto value never touch crypto tools", async () => {
  const names: string[] = [];
  const snapshot = await fetchSnapshot(async (name) => {
    names.push(name);
    if (name === "get_portfolio") return { total_value: "1200", cash: "350", buying_power: { buying_power: "300" }, crypto_value: "0" };
    if (name === "get_equity_positions") return { positions: [{ symbol: "SPY", quantity: "2", average_buy_price: "500", shares_available_for_sells: "2" }] };
    if (name === "get_equity_quotes") return { results: [{ quote: { symbol: "SPY", bid_price: "499", ask_price: "501",
      last_trade_price: "500", venue_last_trade_time: "2026-10-23T19:59:00Z", last_non_reg_trade_price: "502", venue_last_non_reg_trade_time: "2026-10-23T20:30:00Z" } }] };
    throw new Error(`unexpected tool ${name}`);
  }, "masked-account", 42, "rhs-1");
  assert.equal(snapshot.positions.length, 1);
  assert.ok(!names.includes("get_crypto_positions") && !names.includes("get_crypto_quotes"));
  assert.equal(snapshot.cryptoBuyingPower, undefined);
});

const cryptoIntent: OrderIntent = { symbol: "BTC-USD", side: "buy", quantity: 0.0005810955, orderType: "limit",
  limitPrice: 80062.48, timeInForce: "day", invalidationPrice: 78000, timeStopDate: "2026-11-01",
  thesis: "A sufficiently detailed test thesis", probabilityWin: 0.6,
  expectedGainPct: 4, expectedLossPct: 2, estimatedCostPct: 0.1, evidence: ["test quote"] };
function cryptoTool(name: string, extraRequired: string[] = []): Tool {
  return { name, inputSchema: { type: "object", additionalProperties: false,
    properties: { rhs_account_number: { type: "string" }, symbol: { type: "string" }, side: { enum: ["buy", "sell"] },
      quantity: { type: "string" }, type: { enum: ["limit", "stop_limit"] }, limit_price: { type: "string" },
      stop_price: { type: "string" }, time_in_force: { enum: ["gfd", "gtc"] }, ref_id: { type: "string" } },
    required: ["rhs_account_number", "symbol", "side", "quantity", "type", "limit_price", "time_in_force", ...extraRequired] } };
}

test("crypto orders map a limit buy and a stop sell without market hours or dollar amounts", () => {
  const tools = [cryptoTool("preview_crypto_order"), cryptoTool("place_crypto_order", ["ref_id"])];
  const buy = cryptoOrderMapping(tools, "review", cryptoIntent, "rhs-1");
  assert.equal(buy.tool.name, "preview_crypto_order");
  assert.deepEqual(buy.args, { rhs_account_number: "rhs-1", symbol: "BTC-USD", side: "buy", type: "limit",
    quantity: "0.00058109", limit_price: "80062.48", time_in_force: "gtc" });
  const stop = cryptoOrderMapping(tools, "place", { ...cryptoIntent, side: "sell", orderType: "stop_limit",
    stopPrice: 79000.126, limitPrice: 78950.456, timeInForce: "day" }, "rhs-1", { refId: "ref-1" });
  assert.equal(stop.tool.name, "place_crypto_order");
  assert.deepEqual(stop.args, { rhs_account_number: "rhs-1", symbol: "BTC-USD", side: "sell", type: "stop_limit",
    quantity: "0.00058109", limit_price: "78950.46", stop_price: "79000.13", time_in_force: "gfd", ref_id: "ref-1" });
  assert.ok(!("market_hours" in stop.args) && !("dollar_amount" in stop.args));
  const held = cryptoOrderMapping(tools, "review", { ...cryptoIntent, orderType: "stop_limit", stopPrice: 79000, timeInForce: "gtc" }, "rhs-1");
  assert.equal(held.args.time_in_force, "gtc");
  const dust = cryptoOrderMapping(tools, "review", { ...cryptoIntent, limitPrice: 0.12345678 }, "rhs-1");
  assert.equal(dust.args.limit_price, "0.123457");
  assert.throws(() => cryptoOrderMapping(tools, "review", cryptoIntent, undefined), BrokerMappingError);
});

test("crypto placement uses the preview-rounded quantity with a stable ref id", () => {
  const tools = [cryptoTool("preview_crypto_order"), cryptoTool("place_crypto_order", ["ref_id"])];
  const preview = cryptoOrderMapping(tools, "review", cryptoIntent, "rhs-1");
  assert.ok(!("ref_id" in preview.args));
  const previewData = { order: { id: "preview-order", quantity: "0.00058108" }, customer_approval_required: false, order_checks: [] as unknown[] };
  validateReview(previewData);
  const first = cryptoOrderMapping(tools, "place", cryptoIntent, "rhs-1", { quantity: String(recordQuantity(previewData)) });
  assert.equal(first.args.quantity, "0.00058108");
  assert.equal(first.args.ref_id, orderRef(cryptoIntent));
  const second = cryptoOrderMapping(tools, "place", cryptoIntent, "rhs-1", { quantity: "0.00058108", refId: "explicit-ref" });
  assert.equal(second.args.ref_id, "explicit-ref");
  assert.throws(() => validateReview({ ...previewData, customer_approval_required: true }), /customer approval/);
  assert.throws(() => validateReview({ ...previewData, order_checks: [{ code: "held-for-review" }] }), /order_checks/);
});
function recordQuantity(previewData: { order: { quantity: string } }): string {
  return previewData.order.quantity;
}

test("crypto order states map to harness records", () => {
  for (const state of ["queued", "confirmed", "new"]) assert.equal(parseCryptoOrder({ state }).status, "submitted");
  assert.deepEqual(parseCryptoOrder({ state: "partially_filled", cumulative_quantity: "0.0002", average_price: "79900.5" }),
    { status: "partially_filled", filledQuantity: 0.0002, averageFillPrice: 79900.5 });
  assert.deepEqual(parseCryptoOrder({ state: "filled", cumulative_quantity: "0.00058108", average_price: "80000" }),
    { status: "filled", filledQuantity: 0.00058108, averageFillPrice: 80000 });
  for (const state of ["canceled", "voided"]) assert.equal(parseCryptoOrder({ state, cumulative_quantity: "0" }).status, "cancelled");
  for (const state of ["rejected", "failed"]) {
    const parsed = parseCryptoOrder({ state, cumulative_quantity: "0" });
    assert.equal(parsed.status, "failed");
    assert.match(parsed.error!, new RegExp(state));
  }
  assert.deepEqual(parseCryptoOrder({ state: "queued" }), { status: "submitted", filledQuantity: 0 });
  assert.throws(() => parseCryptoOrder({ state: "open", cumulative_quantity: "0" }), /Unknown Robinhood crypto order state/);
});

test("trading account prefers the rhs number and falls back to the account number", () => {
  const both = tradingAccount({ accounts: [{ account_number: "acc-1", rhs_account_number: "rhs-1", agentic_allowed: true }] });
  assert.equal(both.accountId, "acc-1");
  assert.equal(both.rhsAccountId, "rhs-1");
  assert.equal(tradingAccount({ accounts: [{ account_number: "acc-1", agentic_allowed: true }] }).rhsAccountId, "acc-1");
});
