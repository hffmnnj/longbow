import { createHash } from "node:crypto";
import { Type, validateToolArguments, type JsonObject } from "@earendil-works/pi-ai";
import type { Tool } from "@earendil-works/pi-mcp";
import type { AccountSnapshot, OrderIntent, Quote } from "@rh/shared";

export class BrokerMappingError extends Error {
  constructor(message: string) { super(message); this.name = "BrokerMappingError"; }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BrokerMappingError("Expected an object in Robinhood response");
  return value as Record<string, unknown>;
}
export function validateArguments(tool: Tool, args: Record<string, unknown>): Record<string, unknown> {
  const required = tool.inputSchema.required;
  if (Array.isArray(required)) for (const key of required) {
    if (typeof key !== "string" || args[key] === undefined) throw new BrokerMappingError(`${tool.name}: missing required field ${String(key)}`);
  }
  try {
    return validateToolArguments({ name: tool.name, description: "", parameters: Type.Unsafe(tool.inputSchema) }, {
      type: "toolCall", id: "mapping", name: tool.name, arguments: args as JsonObject,
    }) as Record<string, unknown>;
  } catch { throw new BrokerMappingError(`${tool.name}: arguments do not match discovered inputSchema`); }
}
export function findTool(tools: Tool[], names: string[]): Tool {
  const tool = names.map((name) => tools.find((tool) => tool.name === name)).find((tool) => tool !== undefined);
  if (!tool) throw new BrokerMappingError(`No supported Robinhood tool: ${names.join(" or ")}`);
  return tool;
}
function properties(tool: Tool): Record<string, unknown> {
  return record(tool.inputSchema.properties ?? {});
}
function pick(tool: Tool, candidates: Record<string, unknown>): Record<string, unknown> {
  const props = properties(tool);
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidates)) if (Object.hasOwn(props, key) && value !== undefined) args[key] = value;
  return args;
}
function accountArguments(tool: Tool, accountId?: string): Record<string, unknown> {
  const props = properties(tool);
  const args: Record<string, unknown> = {};
  for (const key of ["account_number", "account"]) {
    if (Object.hasOwn(props, key)) throw new BrokerMappingError(`${tool.name}: unsupported account selector ${key}; signed-in schema mapping needed`);
  }
  for (const key of ["account_id", "accountId"]) {
    if (Object.hasOwn(props, key)) {
      if (!accountId) throw new BrokerMappingError(`${tool.name}: MCP trading account has not been identified`);
      args[key] = accountId;
    }
  }
  return args;
}
export function readMapping(tools: Tool[], kind: "snapshot" | "quote", symbol?: string, accountId?: string) {
  const tool = findTool(tools, kind === "snapshot" ? ["get_portfolio", "get_account", "get_accounts"] : ["get_quote", "get_equity_quote", "get_stock_quote", "get_quotes"]);
  const args = { ...accountArguments(tool, accountId), ...pick(tool, { symbol, ticker: symbol, symbols: symbol ? [symbol] : undefined }) };
  return { tool, args: validateArguments(tool, args) };
}
export function orderMapping(tools: Tool[], kind: "review" | "place", intent: OrderIntent, accountId?: string) {
  const tool = findTool(tools, [kind === "review" ? "review_equity_order" : "place_equity_order"]);
  // The stable UUID is based on the entire gate intent, not time or a retry count.
  const hash = createHash("sha256").update(JSON.stringify(Object.entries(intent).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const idKeys = ["client_order_id", "clientOrderId", "idempotency_key", "ref_id", "request_id"];
  const props = properties(tool);
  if (kind === "place" && !idKeys.some((key) => Object.hasOwn(props, key))) {
    throw new BrokerMappingError(`${tool.name}: no supported idempotency field; order placement disabled`);
  }
  const args = {
    ...accountArguments(tool, accountId),
    ...pick(tool, {
      symbol: intent.symbol, ticker: intent.symbol, side: intent.side, quantity: intent.quantity,
      order_type: intent.orderType, type: intent.orderType, limit_price: intent.limitPrice,
      price: intent.limitPrice, stop_price: intent.stopPrice, time_in_force: intent.timeInForce,
      ...Object.fromEntries(idKeys.map((key) => [key, id])),
    }),
  };
  for (const alternatives of [["symbol", "ticker"], ["side"], ["quantity"], ["order_type", "type"], ["limit_price", "price"], ["time_in_force"]]) {
    if (!alternatives.some((key) => Object.hasOwn(args, key))) throw new BrokerMappingError(`${tool.name}: unsupported order field ${alternatives.join("/")}`);
  }
  if (intent.orderType === "stop_limit" && (!intent.stopPrice || !Object.hasOwn(args, "stop_price"))) {
    throw new BrokerMappingError(`${tool.name}: stop-limit order requires a supported stop_price`);
  }
  return { tool, args: validateArguments(tool, args) };
}
export function responseObject(result: { structuredContent?: unknown; content: unknown[]; isError?: boolean }): Record<string, unknown> {
  if (result.isError) throw new BrokerMappingError("Robinhood tool reported an error");
  if (result.structuredContent) return record(result.structuredContent);
  const text = textContent(result);
  try { return record(JSON.parse(text)); }
  catch { throw new BrokerMappingError("Robinhood response has no supported JSON object; schema mapping needed"); }
}
export function textContent(result: { content: unknown[] }): string {
  return result.content.flatMap((item) => {
    if (item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item && typeof item.text === "string") return [item.text];
    return [];
  }).join("\n");
}
function numeric(object: Record<string, unknown>, names: string[]): number {
  for (const name of names) {
    const value = object[name];
    if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  throw new BrokerMappingError(`Robinhood response missing numeric ${names.join("/")}`);
}
function string(object: Record<string, unknown>, name: string): string {
  if (typeof object[name] !== "string" || !object[name]) throw new BrokerMappingError(`Robinhood response missing ${name}`);
  return object[name];
}
export function tradingAccount(response: Record<string, unknown>): { account: Record<string, unknown>; accountId?: string } {
  const isTrading = (value: Record<string, unknown>) => value.is_mcp_account === true || value.account_type === "mcp" || value.account_type === "mcp_trading";
  const candidates = Array.isArray(response.accounts) ? response.accounts.map(record) : [response];
  const matches = candidates.filter(isTrading);
  if (matches.length !== 1) throw new BrokerMappingError("Cannot uniquely identify the dedicated MCP trading account; signed-in schema mapping needed");
  const account = matches[0]!;
  const id = account.account_id ?? account.id;
  return { account, ...(typeof id === "string" ? { accountId: id } : {}) };
}
export function parseSnapshot(account: Record<string, unknown>, at: number): AccountSnapshot {
  if (!Array.isArray(account.positions)) throw new BrokerMappingError("Robinhood response missing positions");
  return {
    at, equity: numeric(account, ["equity", "portfolio_value"]), cash: numeric(account, ["cash"]),
    buyingPower: numeric(account, ["buying_power", "buyingPower"]),
    ...(account.settled_cash === undefined ? {} : { settledCash: numeric(account, ["settled_cash"]) }),
    positions: account.positions.map((value) => {
      const position = record(value);
      return { symbol: string(position, "symbol"), quantity: numeric(position, ["quantity"]),
        averageCost: numeric(position, ["average_cost", "averageCost", "average_buy_price"]),
        marketValue: numeric(position, ["market_value", "marketValue"]),
        unrealizedPnl: numeric(position, ["unrealized_pnl", "unrealizedPnl"]),
        ...(typeof position.sector === "string" ? { sector: position.sector } : {}),
      };
    }),
  };
}
export function parseQuote(response: Record<string, unknown>, symbol: string, at: number): Quote {
  if (response.symbol !== undefined && response.symbol !== symbol) throw new BrokerMappingError("Robinhood quote symbol mismatch");
  const bid = numeric(response, ["bid", "bid_price"]), ask = numeric(response, ["ask", "ask_price"]);
  const last = numeric(response, ["last", "last_trade_price", "price"]);
  if (bid <= 0 || ask < bid || last <= 0) throw new BrokerMappingError("Robinhood returned an invalid quote");
  return { symbol, at, bid, ask, last };
}
