import { createHash } from "node:crypto";
import { Type, validateToolArguments, type JsonObject } from "@earendil-works/pi-ai";
import type { Tool } from "@earendil-works/pi-mcp";
import type { AccountSnapshot, OrderIntent, OrderRecord, Quote } from "@rh/shared";

export class BrokerMappingError extends Error {
  constructor(message: string) { super(message); this.name = "BrokerMappingError"; }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BrokerMappingError("Expected an object in Robinhood response");
  return value as Record<string, unknown>;
}
export function validateArguments(tool: Tool, args: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(tool.inputSchema.required)) for (const key of tool.inputSchema.required) {
    if (typeof key !== "string" || args[key] === undefined) throw new BrokerMappingError(`${tool.name}: missing required field ${String(key)}`);
  }
  try {
    return validateToolArguments({ name: tool.name, description: "", parameters: Type.Unsafe(tool.inputSchema) }, {
      type: "toolCall", id: "mapping", name: tool.name, arguments: args as JsonObject,
    }) as Record<string, unknown>;
  } catch { throw new BrokerMappingError(`${tool.name}: arguments do not match discovered inputSchema`); }
}
export function findTool(tools: Tool[], names: string[]): Tool {
  const tool = tools.find((tool) => names.includes(tool.name));
  if (!tool) throw new BrokerMappingError(`No supported Robinhood tool: ${names.join(" or ")}`);
  return tool;
}
export function readMapping(tools: Tool[], kind: "snapshot" | "quote", symbol?: string, accountId?: string) {
  const tool = findTool(tools, [kind === "snapshot" ? "get_portfolio" : "get_equity_quotes"]);
  return { tool, args: validateArguments(tool, kind === "snapshot" ? { account_number: requireAccount(accountId) } : { symbols: [symbol] }) };
}
function requireAccount(account?: string): string {
  if (!account) throw new BrokerMappingError("MCP trading account has not been identified");
  return account;
}
export function orderRef(intent: OrderIntent, key = ""): string {
  const hash = createHash("sha256").update(key + JSON.stringify(Object.entries(intent).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export interface ExecutionOptions { market?: boolean; refId?: string }
export function orderMapping(tools: Tool[], kind: "review" | "place", intent: OrderIntent, accountId?: string, options: ExecutionOptions = {}) {
  const tool = findTool(tools, [kind === "review" ? "review_equity_order" : "place_equity_order"]);
  if (kind === "place" && !Object.hasOwn(record(tool.inputSchema.properties), "ref_id")) throw new BrokerMappingError(`${tool.name}: no supported idempotency field`);
  if (!Number.isInteger(intent.quantity) && !options.market) throw new BrokerMappingError("Robinhood only fills fractional shares as market orders");
  if (!Number.isFinite(intent.quantity) || intent.quantity <= 0 || Math.abs(intent.quantity * 1e6 - Math.round(intent.quantity * 1e6)) > 1e-6) throw new BrokerMappingError("Robinhood quantity must have at most 6 decimals");
  const price = (value: number) => value.toFixed(value >= 1 ? 2 : 4);
  const args = {
    account_number: requireAccount(accountId), symbol: intent.symbol, side: intent.side,
    type: options.market ? "market" : intent.orderType, quantity: String(intent.quantity),
    ...(!options.market ? { limit_price: price(intent.limitPrice), ...(intent.stopPrice === undefined ? {} : { stop_price: price(intent.stopPrice) }) } : {}),
    time_in_force: options.market || intent.timeInForce === "day" ? "gfd" : "gtc", market_hours: "regular_hours",
    ...(kind === "place" ? { ref_id: options.refId ?? orderRef(intent) } : {}),
  };
  return { tool, args: validateArguments(tool, args) };
}
export function fractionalExecution(intent: OrderIntent, quote: Quote, regular: boolean): ExecutionOptions {
  if (Number.isInteger(intent.quantity)) return {};
  if (intent.orderType !== "limit" || !regular || (intent.side === "buy" ? quote.ask > intent.limitPrice : quote.bid < intent.limitPrice)) {
    throw new BrokerMappingError("fractional limit not marketable now; Robinhood only fills fractional shares as market orders");
  }
  return { market: true };
}
export function responseObject(result: { structuredContent?: unknown; content: unknown[]; isError?: boolean }): Record<string, unknown> {
  if (result.isError) throw new BrokerMappingError("Robinhood tool reported an error");
  try { return record(record(JSON.parse(textContent(result))).data); }
  catch { throw new BrokerMappingError("Robinhood response has no supported data envelope"); }
}
export function textContent(result: { content: unknown[] }): string {
  return result.content.flatMap((item) => item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item && typeof item.text === "string" ? [item.text] : []).join("\n");
}
export function numeric(object: Record<string, unknown>, name: string): number {
  const value = object[name];
  if ((typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value))) return Number(value);
  throw new BrokerMappingError(`Robinhood response missing numeric ${name}`);
}
function string(object: Record<string, unknown>, name: string): string {
  if (typeof object[name] !== "string" || !object[name]) throw new BrokerMappingError(`Robinhood response missing ${name}`);
  return object[name];
}
export function tradingAccount(response: Record<string, unknown>): { account: Record<string, unknown>; accountId: string } {
  const matches = Array.isArray(response.accounts) ? response.accounts.map(record).filter((account) => account.agentic_allowed === true) : [];
  if (matches.length !== 1) throw new BrokerMappingError("Cannot uniquely identify the dedicated MCP trading account");
  return { account: matches[0]!, accountId: string(matches[0]!, "account_number") };
}
export function parseSnapshot(account: Record<string, unknown>, at: number, positions: Record<string, unknown>[] = [], quotes: Quote[] = []): AccountSnapshot {
  return { at, equity: numeric(account, "total_value"), cash: numeric(account, "cash"), buyingPower: numeric(record(account.buying_power), "buying_power"),
    positions: positions.map((position) => {
      const symbol = string(position, "symbol"), quantity = numeric(position, "quantity");
      const quote = quotes.find((quote) => quote.symbol === symbol);
      if (!quote) throw new BrokerMappingError(`Missing position mark for ${symbol}`);
      const averageCost = position.average_buy_price == null ? 0 : numeric(position, "average_buy_price");
      return { symbol, quantity, averageCost, marketValue: quote.last * quantity,
        sharesAvailableForSells: numeric(position, "shares_available_for_sells"),
        unrealizedPnl: position.average_buy_price == null ? 0 : (quote.last - averageCost) * quantity };
    }),
  };
}
export function parseQuote(response: Record<string, unknown>, symbol: string, at: number): Quote {
  if (!Array.isArray(response.results)) throw new BrokerMappingError("Robinhood response missing quote results");
  const row = response.results.map(record).map((row) => record(row.quote)).find((quote) => quote.symbol === symbol);
  if (!row) throw new BrokerMappingError("Robinhood quote symbol mismatch");
  const bid = numeric(row, "bid_price"), ask = numeric(row, "ask_price");
  const regularTime = Date.parse(String(row.venue_last_trade_time));
  const nonRegularTime = Date.parse(String(row.venue_last_non_reg_trade_time));
  const nonRegularIsNewer = Number.isFinite(nonRegularTime) && (!Number.isFinite(regularTime) || nonRegularTime > regularTime);
  const last = numeric(row, nonRegularIsNewer ? "last_non_reg_trade_price" : "last_trade_price");
  if (bid <= 0 || ask <= 0 || ask < bid || last <= 0) throw new BrokerMappingError("Robinhood returned an invalid quote");
  return { symbol, at, bid, ask, last };
}
export function parseOrder(response: Record<string, unknown>): Pick<OrderRecord, "status" | "filledQuantity" | "averageFillPrice" | "error"> {
  const state = string(response, "state");
  const status = state === "filled" ? "filled" : state === "partially_filled" ? "partially_filled" : state === "cancelled" || state === "voided" ? "cancelled" : state === "rejected" || state === "failed" ? "failed" : ["new", "queued", "confirmed", "unconfirmed"].includes(state) ? "submitted" : undefined;
  if (!status) throw new BrokerMappingError("Unknown Robinhood order state");
  return { status, filledQuantity: numeric(response, "cumulative_quantity"), ...(response.average_price == null ? {} : { averageFillPrice: numeric(response, "average_price") }), ...(status === "failed" ? { error: `Robinhood order ${state}` } : {}) };
}
export function validateReview(data: Record<string, unknown>): string {
  if (data.customer_approval_required === true) throw new BrokerMappingError("Robinhood requires customer approval; automatic placement blocked");
  const checks = data.order_checks;
  if (checks != null && (Array.isArray(checks) ? checks.length > 0 : Object.keys(record(checks)).length > 0)) throw new BrokerMappingError("Robinhood pre-trade order_checks require resolution; placement blocked");
  return JSON.stringify(data).slice(0, 12_000);
}
export type ReadCall = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
export async function fetchQuotes(call: ReadCall, symbols: string[], at: number): Promise<Quote[]> {
  const unique = [...new Set(symbols)];
  const quotes: Quote[] = [];
  for (let i = 0; i < unique.length; i += 20) {
    const batch = unique.slice(i, i + 20);
    const data = await call("get_equity_quotes", { symbols: batch });
    quotes.push(...batch.map((symbol) => parseQuote(data, symbol, at)));
  }
  return quotes;
}
export async function fetchSnapshot(call: ReadCall, account: string, at: number): Promise<AccountSnapshot> {
  const portfolio = await call("get_portfolio", { account_number: account });
  const positions: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await call("get_equity_positions", { account_number: account, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(page.positions)) throw new BrokerMappingError("Robinhood response missing positions");
    positions.push(...page.positions.map(record));
    cursor = typeof page.next === "string" && page.next ? page.next : undefined;
    if (cursor && seen.has(cursor)) throw new BrokerMappingError("Robinhood position pagination repeated a cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return parseSnapshot(portfolio, at, positions, await fetchQuotes(call, positions.map((p) => string(p, "symbol")), at));
}
