import { McpClient, StreamableHttpTransport, type Tool, type CallToolResult } from "@earendil-works/pi-mcp";
import type { Extension, Registry } from "@earendil-works/pi-durable";
import type { BrokerStatus, OrderIntent, OrderRecord, Quote } from "@rh/shared";
import { isCryptoSymbol } from "@rh/shared";
import type { Broker, Config, Logger, Clock } from "../ports.ts";
import { RobinhoodOAuth, MCP_URL } from "./oauth.ts";
import { TokenStore, privateWrite } from "./token-store.ts";
import { robinhoodCallAllowed, robinhoodExtension } from "./tools.ts";
import { BrokerMappingError, cryptoOrderMapping, findTool, orderMapping, orderRef, parseCryptoOrder, parseOpenStopOrders, parseOrder, parsePnlTrades, record, fetchSnapshot, fetchQuotes, fractionalExecution, responseObject, tradingAccount, validateArguments, validateReview, type ExecutionOptions, type OpenStopOrder, type PnlTrade } from "./mapping.ts";
import { createNyseCalendar } from "../risk/calendar.ts";

export type { OpenStopOrder, PnlTrade };

export interface RobinhoodBroker extends Broker {
  extension(): Extension;
  attach(registry: Registry): void;
  quotes(symbols: string[]): Promise<Quote[]>;
  cancelOrder(id: string, symbol?: string): Promise<void>;
  orderState(id: string, symbol?: string): Promise<Partial<OrderRecord>>;
  executeStop(intent: OrderIntent, refId: string): Promise<{ brokerOrderId: string; raw: string }>;
  /** Closed trades from Robinhood's PnL hub (span "all"), oldest first. Read-only. */
  tradeHistory(): Promise<PnlTrade[]>;
  /** Open sell stop orders resting at Robinhood. Read-only. */
  openStopOrders(): Promise<OpenStopOrder[]>;
}

export function liveTradingLockedMessage(tool: string): string {
  return `Live trading is locked: ${tool} was not sent to Robinhood (set HARNESS_LIVE_TRADING=1 to unlock)`;
}

export function createRobinhoodBroker(deps: { config: Config; log: Logger; clock: Clock }): RobinhoodBroker {
  const { config, log, clock } = deps;
  if (config.ROBINHOOD_MCP_URL !== MCP_URL) throw new Error("Robinhood MCP endpoint must be the verified trading endpoint");
  const store = new TokenStore(config.DATA_DIR);
  const oauth = new RobinhoodOAuth({ store, clock, redirectUrl: `${config.PUBLIC_URL.replace(/\/$/, "")}/api/robinhood/callback` });
  const listeners = new Set<() => void>();
  const registries = new Set<Registry>();
  let state: BrokerStatus = { state: "connecting", tools: [] };
  let tools: Tool[] = [];
  let client: McpClient | undefined;
  let accountId: string | undefined;
  let rhsAccountId: string | undefined;
  let refresh: Promise<void> | undefined;
  let lifecycle: Promise<unknown> = Promise.resolve();
  let generation = 0;
  const calendar = createNyseCalendar();

  function publish(next: BrokerStatus) {
    state = next;
    for (const listener of listeners) { try { listener(); } catch { log.warn("Robinhood change listener failed"); } }
  }
  function installTools() { for (const registry of registries) registry.install(broker.extension()); }
  function setTools(next: Tool[]) {
    tools = next;
    installTools();
    publish({ ...state, tools: tools.map((tool) => tool.name) });
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = lifecycle.then(operation);
    lifecycle = result.catch(() => {});
    return result;
  }
  async function refreshTokens() {
    refresh ??= oauth.refresh().catch((error: unknown) => {
      publish({ state: "needs_auth", tools: tools.map((tool) => tool.name), error: "Robinhood sign-in required" });
      throw error;
    }).finally(() => { refresh = undefined; });
    await refresh;
  }
  async function close() {
    generation++;
    const previous = client;
    client = undefined;
    accountId = undefined;
    rhsAccountId = undefined;
    await previous?.close().catch(() => {});
  }
  async function connect() {
    await close();
    publish({ state: "connecting", tools: [] });
    const current = new McpClient({ name: "robinhood-harness", version: "1.0.0", requestTimeoutMs: 30_000 });
    const version = generation;
    try {
      await current.connect(new StreamableHttpTransport({ url: MCP_URL, authProvider: {
        async token() {
          const stored = await store.load();
          if (stored?.tokensExpireAt !== undefined && stored.tokensExpireAt <= clock.now() + 30_000) await refreshTokens();
          return (await oauth.provider.tokens())?.access_token;
        },
        async onUnauthorized(context) {
          const token = (await oauth.provider.tokens())?.access_token;
          if (context.token && token && context.token !== token) return;
          await refreshTokens();
        },
      } }));
      const discovered = await current.listTools();
      await privateWrite(store.directory, "tools.json", discovered.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));
      client = current;
      setTools(discovered);
      const accountsTool = findTool(discovered, ["get_accounts"]);
      const identifiedConnect = tradingAccount(responseObject(await current.callTool(accountsTool.name, validateArguments(accountsTool, {}))));
      accountId = identifiedConnect.accountId;
      rhsAccountId = identifiedConnect.rhsAccountId;
      publish({ state: "connected", tools: discovered.map((tool) => tool.name) });
      current.onClose(() => {
        if (version === generation) {
          client = undefined;
          publish({ state: "error", tools: tools.map((tool) => tool.name), error: "Robinhood connection closed; reconnect required" });
        }
      });
      let toolUpdate: Promise<void> = Promise.resolve();
      current.onNotification("notifications/tools/list_changed", () => {
        toolUpdate = toolUpdate.then(async () => {
          const next = await current.listTools();
          if (version !== generation) return;
          await privateWrite(store.directory, "tools.json", next.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));
          accountId = undefined;
          rhsAccountId = undefined;
          setTools(next);
        }).catch(() => { log.warn("Robinhood tool discovery failed"); });
      });
    } catch {
      await current.close().catch(() => {});
      await close();
      setTools([]);
      publish({ state: "needs_auth", tools: [], error: "Robinhood connection unavailable; sign-in may be required" });
      throw new Error("Robinhood connection unavailable");
    }
  }
  async function call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult> {
    if (!client || state.state !== "connected") throw new Error("Robinhood is not connected");
    // Hard lock independent of the app's mode: without HARNESS_LIVE_TRADING=1 only read tools reach Robinhood.
    if (!robinhoodCallAllowed(name, deps.config.LIVE_TRADING)) throw new Error(liveTradingLockedMessage(name));
    try { return await client.callTool(name, args, { signal }); }
    catch { throw new Error("Robinhood tool request failed; reconcile any uncertain order before retrying"); }
  }
  async function identifyAccount() {
    if (accountId) return;
    const tool = findTool(tools, ["get_accounts"]);
    const identified = tradingAccount(responseObject(await call(tool.name, validateArguments(tool, {}))));
    accountId = identified.accountId;
    rhsAccountId = identified.rhsAccountId;
  }
  async function mappedCall(name: string, args: Record<string, unknown>) {
    return responseObject(await call(name, validateArguments(findTool(tools, [name]), args)));
  }
  async function execution(intent: OrderIntent): Promise<ExecutionOptions> {
    if (Number.isInteger(intent.quantity)) return {};
    const quote = (await fetchQuotes(mappedCall, [intent.symbol], clock.now()))[0]!;
    return fractionalExecution(intent, quote, calendar.clock(clock.now()).isOpen);
  }
  async function place(intent: OrderIntent, options: ExecutionOptions) {
    await identifyAccount();
    if (isCryptoSymbol(intent.symbol)) {
      if (options.market) throw new BrokerMappingError("Robinhood crypto orders do not use market orders");
      const preview = cryptoOrderMapping(tools, "review", intent, rhsAccountId);
      const previewData = responseObject(await call(preview.tool.name, preview.args));
      validateReview(previewData);
      const previewedQuantity = previewData.order == null ? undefined : record(previewData.order).quantity;
      if (typeof previewedQuantity !== "string" || !previewedQuantity) throw new BrokerMappingError("Robinhood crypto preview missing order quantity; do not retry without reconciliation");
      const mapping = cryptoOrderMapping(tools, "place", intent, rhsAccountId, { refId: options.refId ?? orderRef(intent), quantity: previewedQuantity });
      const result = await call(mapping.tool.name, mapping.args);
      const response = responseObject(result);
      if (response.customer_approval_required === true) throw new BrokerMappingError("Robinhood order requires customer approval; reconcile before retrying");
      const order = response.order == null ? response : record(response.order);
      const id = order.order_id ?? order.id;
      if (typeof id !== "string" || !id) throw new BrokerMappingError("Robinhood order response missing order id; do not retry without reconciliation");
      return { brokerOrderId: id, raw: JSON.stringify(order).slice(0, 12_000) };
    }
    const mapping = orderMapping(tools, "place", intent, accountId, options);
    const result = await call(mapping.tool.name, mapping.args);
    const response = responseObject(result);
    if (response.customer_approval_required === true) throw new BrokerMappingError("Robinhood order requires customer approval; reconcile before retrying");
    const order = response.order == null ? response : record(response.order);
    const id = order.order_id ?? order.id;
    if (typeof id !== "string" || !id) throw new BrokerMappingError("Robinhood order response missing order id; do not retry without reconciliation");
    return { brokerOrderId: id, raw: JSON.stringify(order).slice(0, 12_000) };
  }
  const broker: RobinhoodBroker = {
    status: () => ({ ...state, tools: [...state.tools] }),
    beginConnect: () => serial(() => oauth.beginConnect()),
    completeConnect: (params) => serial(async () => {
      await oauth.completeConnect(params);
      await connect();
    }),
    disconnect: () => serial(async () => {
      await close();
      await oauth.clear();
      setTools([]);
      publish({ state: "needs_auth", tools: [] });
    }),
    async snapshot() {
      await identifyAccount();
      return fetchSnapshot(mappedCall, accountId!, clock.now(), rhsAccountId);
    },
    async quote(symbol) {
      if (isCryptoSymbol(symbol)) await identifyAccount();
      return (await fetchQuotes(mappedCall, [symbol], clock.now(), rhsAccountId))[0]!;
    },
    quotes: async (symbols) => {
      if (symbols.some(isCryptoSymbol)) await identifyAccount();
      return fetchQuotes(mappedCall, symbols, clock.now(), rhsAccountId);
    },
    async tradeHistory() {
      await identifyAccount();
      const trades: PnlTrade[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const data = await mappedCall("get_pnl_trade_history", { account_number: accountId, span: "all", ...(cursor === undefined ? {} : { cursor }) });
        trades.push(...parsePnlTrades(data));
        const next = typeof data.next_cursor === "string" && data.next_cursor !== "" ? data.next_cursor : undefined;
        if (next === undefined || next === cursor) break;
        cursor = next;
      }
      return trades.sort((a, b) => a.closedAt - b.closedAt);
    },
    async openStopOrders() {
      await identifyAccount();
      const stops: OpenStopOrder[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const data = await mappedCall("get_equity_orders", { account_number: accountId, ...(cursor === undefined ? {} : { cursor }) });
        stops.push(...parseOpenStopOrders(data));
        const next = typeof data.next === "string" && data.next !== "" ? data.next : undefined;
        if (next === undefined || next === cursor) break;
        cursor = next;
      }
      return stops;
    },
    async cancelOrder(id, symbol) {
      await identifyAccount();
      if (symbol !== undefined && isCryptoSymbol(symbol)) {
        await mappedCall("cancel_crypto_order", { rhs_account_number: rhsAccountId, order_id: id });
        return;
      }
      await mappedCall("cancel_equity_order", { account_number: accountId, order_id: id });
    },
    async orderState(id, symbol) {
      await identifyAccount();
      if (symbol !== undefined && isCryptoSymbol(symbol)) {
        const data = await mappedCall("get_crypto_orders", { rhs_account_number: rhsAccountId, order_id: id });
        const order = Array.isArray(data.results) ? data.results.map(record).find((o) => o.id === id) : undefined;
        if (!order) throw new BrokerMappingError("Robinhood crypto order not found during reconciliation");
        return parseCryptoOrder(order);
      }
      const data = await mappedCall("get_equity_orders", { account_number: accountId, order_id: id });
      const order = Array.isArray(data.orders) ? data.orders.map(record).find((o) => o.id === id) : undefined;
      if (!order) throw new BrokerMappingError("Robinhood order not found during reconciliation");
      return parseOrder(order);
    },
    async executeStop(intent, refId) {
      if (isCryptoSymbol(intent.symbol)) throw new BrokerMappingError("executeStop does not support crypto symbols; crypto trades 24/7 without held stops");
      if (!calendar.clock(clock.now()).isOpen) throw new BrokerMappingError("Stop execution requires regular hours");
      await identifyAccount();
      const mapping = orderMapping(tools, "review", intent, accountId, { market: true });
      validateReview(responseObject(await call(mapping.tool.name, mapping.args)));
      return place(intent, { market: true, refId });
    },
    async reviewOrder(intent: OrderIntent) {
      await identifyAccount();
      if (isCryptoSymbol(intent.symbol)) {
        const mapping = cryptoOrderMapping(tools, "review", intent, rhsAccountId);
        const result = await call(mapping.tool.name, mapping.args);
        if (result.isError) throw new BrokerMappingError("Robinhood order review failed");
        return validateReview(responseObject(result));
      }
      const mapping = orderMapping(tools, "review", intent, accountId, await execution(intent));
      const result = await call(mapping.tool.name, mapping.args);
      if (result.isError) throw new BrokerMappingError("Robinhood order review failed");
      return validateReview(responseObject(result));
    },
    async placeOrder(intent: OrderIntent) {
      if (isCryptoSymbol(intent.symbol)) return place(intent, {});
      return place(intent, await execution(intent));
    },
    onChange(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    extension() { return robinhoodExtension({ tools, status: () => broker.status(), call }); },
    attach(registry) { registries.add(registry); registry.install(broker.extension()); },
  };
  void serial(async () => {
    try {
      if (await oauth.provider.tokens()) await connect();
      else publish({ state: "needs_auth", tools: [] });
    } catch {
      publish({ state: "needs_auth", tools: [], error: "Robinhood sign-in required" });
      log.warn("Robinhood startup requires sign-in");
    }
  });
  return broker;
}
