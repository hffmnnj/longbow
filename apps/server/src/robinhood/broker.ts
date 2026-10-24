import { McpClient, StreamableHttpTransport, type Tool, type CallToolResult } from "@earendil-works/pi-mcp";
import type { Extension, Registry } from "@earendil-works/pi-durable";
import type { BrokerStatus, OrderIntent } from "@rh/shared";
import type { Broker, Config, Logger, Clock } from "../ports.ts";
import { RobinhoodOAuth, MCP_URL } from "./oauth.ts";
import { TokenStore, privateWrite } from "./token-store.ts";
import { robinhoodExtension } from "./tools.ts";
import { BrokerMappingError, findTool, orderMapping, parseQuote, parseSnapshot, readMapping, responseObject, textContent, tradingAccount, validateArguments } from "./mapping.ts";

export interface RobinhoodBroker extends Broker {
  extension(): Extension;
  attach(registry: Registry): void;
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
  let refresh: Promise<void> | undefined;
  let lifecycle: Promise<unknown> = Promise.resolve();
  let generation = 0;

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
    try { return await client.callTool(name, args, { signal }); }
    catch { throw new Error("Robinhood tool request failed; reconcile any uncertain order before retrying"); }
  }
  async function identifyAccount() {
    if (accountId) return;
    if (!tools.some((tool) => tool.name === "get_accounts")) return;
    const tool = findTool(tools, ["get_accounts"]);
    const identified = tradingAccount(responseObject(await call(tool.name, validateArguments(tool, {}))));
    accountId = identified.accountId;
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
      const mapping = readMapping(tools, "snapshot", undefined, accountId);
      const response = responseObject(await call(mapping.tool.name, mapping.args));
      // An explicitly account-scoped request can use its direct portfolio result. Unscoped reads must identify the MCP account.
      const scoped = accountId && Object.keys(mapping.args).some((key) => /^account/.test(key));
      const identified = scoped ? { account: response, accountId } : tradingAccount(response);
      accountId = identified.accountId;
      return parseSnapshot(identified.account, clock.now());
    },
    async quote(symbol) {
      const mapping = readMapping(tools, "quote", symbol, accountId);
      return parseQuote(responseObject(await call(mapping.tool.name, mapping.args)), symbol, clock.now());
    },
    async reviewOrder(intent: OrderIntent) {
      await identifyAccount();
      const mapping = orderMapping(tools, "review", intent, accountId);
      const result = await call(mapping.tool.name, mapping.args);
      if (result.isError) throw new BrokerMappingError("Robinhood order review failed");
      const text = textContent(result);
      if (!text) throw new BrokerMappingError("Robinhood order review returned no text");
      return text.slice(0, 12_000);
    },
    async placeOrder(intent: OrderIntent) {
      await identifyAccount();
      const mapping = orderMapping(tools, "place", intent, accountId);
      const result = await call(mapping.tool.name, mapping.args);
      const response = responseObject(result);
      const id = response.order_id ?? response.id;
      if (typeof id !== "string" || !id) throw new BrokerMappingError("Robinhood order response missing order id; do not retry without reconciliation");
      return { brokerOrderId: id, raw: textContent(result).slice(0, 12_000) };
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
