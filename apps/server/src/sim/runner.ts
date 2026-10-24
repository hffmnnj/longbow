import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section, type Extension } from "@earendil-works/pi-durable";
import { DEFAULT_SETTINGS, SimRunConfigSchema, type Bar, type ChatMessage, type CycleKind, type JournalEntry, type OrderRecord, type Settings, type SimRun, type SimRunConfig } from "@rh/shared";
import type { Config, EventBus, Logger, MarketCalendar, MarketData, SkillLibrary } from "../ports.ts";
import { openStore } from "../db/store.ts";
import { TradingAgent } from "../agent/runtime.ts";
import { credentialFilePath } from "../agent/credential-store.ts";
import { createTraderPromptExtension, cycleInput } from "../agent/prompt.ts";
import { createOrderGate } from "../risk/gate.ts";
import { createRiskExtension } from "../risk/tools.ts";
import { createJournalExtension } from "../tools/journal.ts";
import { createNotes } from "../skills/notes.ts";
import { createSkillsExtension } from "../skills/tools.ts";
import { createMarketExtension } from "../market/tools.ts";
import { createPointInTimeMarketData, MarketStore } from "../market/market-data.ts";
import { createSubagentExtension } from "../agent/subagents.ts";
import { createPaperBroker, type PaperBroker } from "./broker.ts";
import { createSimEventBus } from "./events.ts";
import { calculateMetrics } from "./metrics.ts";
import { etInstant, tradingDays } from "./path.ts";
import { jsonValue } from "./json.ts";

export interface SimService {
  start(config: SimRunConfig, startedBy: "user" | "agent"): Promise<SimRun>;
  list(): SimRun[];
  get(id: string): SimRun | undefined;
  stop(id: string): Promise<SimRun | undefined>;
  messages(id: string, limit: number, conversationId?: string): Promise<ChatMessage[]>;
  journal(id: string): JournalEntry[];
  orders(id: string): OrderRecord[];
  close(): Promise<void>;
  defaultStartDate(days: number): Promise<string>;
}
export interface SimServiceDeps {
  config: Config;
  log: Logger;
  bus: EventBus;
  market: MarketData;
  skills: SkillLibrary;
  calendar: MarketCalendar;
  /** Read the live settings through composition, never open the live store here. */
  settings?: () => Settings;
  buildExtensions?: (context: { run: SimRun; broker: PaperBroker }) => Extension[];
  credentialFile?: string;
}

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}
function atomic(file: string, value: unknown): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

function paperTools(broker: PaperBroker, calendar: MarketCalendar, now: () => number): Extension {
  return defineExtension({ name: "paper-account", tools: [
    defineTool({ name: "sim_quote", description: "Current simulated bid, ask and last. No future daily OHLC is disclosed.",
      parameters: Type.Object({ symbol: Type.String({ pattern: "^[A-Z.]{1,10}$" }) }),
      structuredOutputSchema: Type.Object({ symbol: Type.String(), at: Type.Number(), bid: Type.Number(), ask: Type.Number(), last: Type.Number() }), replay: "safe",
      async execute({ symbol }) { const result = await broker.quote(symbol); return { output: [{ type: "text", text: JSON.stringify(result) }], structuredOutput: jsonValue(result) }; } }),
    defineTool({ name: "sim_orders", description: "Paper account, open orders and fills today. A submitted order is not necessarily filled.", parameters: Type.Object({}),
      structuredOutputSchema: Type.Object({ account: Type.Any(), orders: Type.Array(Type.Any()), fills: Type.Array(Type.Any()) }), replay: "safe",
      async execute() { const result = { account: await broker.snapshot(), orders: broker.orders().filter((o) => o.status === "open"), fills: broker.fills().filter((f) => f.date === calendar.etDate(now())) };
        return { output: [{ type: "text", text: JSON.stringify(result) }], structuredOutput: jsonValue(result) }; } }),
    defineTool({ name: "sim_cancel_order", description: "Cancel a resting paper order by broker order id.", parameters: Type.Object({ orderId: Type.String() }),
      structuredOutputSchema: Type.Object({ cancelled: Type.Boolean() }),
      async execute({ orderId }) { broker.cancel(orderId); return { output: [{ type: "text", text: "Cancelled" }], structuredOutput: { cancelled: true } }; } }),
  ] });
}

export function createSimService(deps: SimServiceDeps): SimService {
  const root = join(deps.config.DATA_DIR, "sim");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const replayMarket = new MarketStore({ dataDir: root, log: deps.log, clock: { now: () => Date.now() } });
  const runs = new Map<string, SimRun>();
  const agents = new Map<string, TradingAgent>();
  const artifacts = new Map<string, { journal: () => JournalEntry[]; orders: () => OrderRecord[] }>();
  const queue: string[] = [];
  let active: string | undefined;
  let closed = false;
  let work: Promise<void> = Promise.resolve();
  const dir = (id: string): string => { if (!runs.has(id)) throw new Error("Unknown simulation"); return join(root, id); };
  function save(run: SimRun): void {
    atomic(join(dir(run.id), "run.json"), run);
    deps.bus.publish({ type: "sim", run: structuredClone(run) });
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[\w-]+$/.test(entry.name)) continue;
    try {
      const run = readJson<SimRun | undefined>(join(root, entry.name, "run.json"), undefined);
      if (run === undefined || run.id !== entry.name) continue;
      runs.set(run.id, run);
      if (run.status === "running" || run.status === "queued") { run.status = "failed"; run.error = "interrupted by restart"; run.finishedAt = Date.now(); save(run); }
    } catch (error) { deps.log.warn("could not read simulation", { id: entry.name, error: String(error) }); }
  }
  async function execute(run: SimRun): Promise<void> {
    const runDir = dir(run.id);
    let now = etInstant(run.config.startDate, 9);
    const clock = { now: () => now };
    const bus = createSimEventBus(deps.bus, run.id);
    const store = openStore(join(runDir, "app.sqlite"), clock);
    artifacts.set(run.id, { journal: () => store.listJournal(10000), orders: () => store.listOrders(10000) });
    const liveSettings = deps.settings?.() ?? DEFAULT_SETTINGS;
    store.patchSettings({ ...liveSettings, mode: "auto", killSwitch: false, drawdownHalted: false,
      watchlist: run.config.watchlist ?? liveSettings.watchlist, risk: { ...liveSettings.risk, ...run.config.risk } });
    const history = new Map<string, Promise<Bar[]>>();
    const bars = (symbol: string): Promise<Bar[]> => {
      let promise = history.get(symbol);
      if (promise === undefined) {
        const from = new Date(Date.parse(`${run.config.startDate}T12:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
        // Fetch through today for Nasdaq compatibility, but retain the historical path privately.
        promise = replayMarket.barsBetween(symbol, from, deps.calendar.etDate(Date.now())); history.set(symbol, promise);
      }
      return promise;
    };
    const spy = await bars("SPY");
    const days = tradingDays(spy, run.config.startDate, run.config.days);
    if (days.length !== run.config.days || days.some((b) => b.date >= deps.calendar.etDate(Date.now()))) throw new Error("Simulation range must contain the requested number of completed past trading days");
    const asOf = (): string => spy.filter((b) => b.date < deps.calendar.etDate(now) || (b.date === deps.calendar.etDate(now) && now >= etInstant(b.date, 16))).at(-1)?.date ?? (() => { throw new Error("No prior trading day available"); })();
    const historicalMarket = new MarketStore({ dataDir: runDir, log: deps.log, clock: { now: () => Date.now() }, asOf });
    const market = createPointInTimeMarketData(historicalMarket, asOf);
    const broker = createPaperBroker({ startingCash: run.config.startingCash, clock, calendar: deps.calendar, bars });
    const gate = createOrderGate({ store, broker, calendar: deps.calendar, clock, bus, log: deps.log, market });
    let agent: TradingAgent | undefined;
    const currentCycleId = (): string | undefined => agent?.currentCycleId();
    const children = new Set<string>();
    const notes = createNotes({ dir: join(runDir, "workspace"), bus, clock });
    const extensions: Extension[] = [
      createRiskExtension({ gate, store, calendar: deps.calendar, clock, broker, currentCycleId }),
      createJournalExtension({ store, bus, clock, currentCycleId }),
      createTraderPromptExtension(),
      createSkillsExtension({ library: deps.skills, notes }),
      createMarketExtension({ market, dataDir: runDir, log: deps.log, clock, asOf }),
      createSubagentExtension({ log: deps.log, maxConcurrent: 4,
        excludedTools: ["submit_order", "notes_write", "notes_append", "record_decision", "delegate", "sim_cancel_order"],
        onRun(child) { children.add(child.id); bus.publish({ type: "subagent", run: child }); if (child.status === "running") void agent?.watchChild(child.id).catch((error: unknown) => deps.log.warn("simulation child watch failed", { error: String(error) })); } }),
      paperTools(broker, deps.calendar, clock.now),
      defineExtension({ name: "simulation-prompt", sections: [section("simulation", () =>
        "This is a historical paper-account simulation. The simulated date is in each cycle. Treat it exactly like the live account. Web search and Robinhood tools are unavailable to prevent look-ahead. Use sim_quote for current prices and sim_orders to confirm fills and account state; sim_cancel_order cancels resting orders. Historical indicators exclude today's incomplete bar. Never use remembered future events or prices.\n" + (run.config.strategy ?? ""))] }),
      ...(deps.buildExtensions?.({ run: structuredClone(run), broker }) ?? []),
    ];
    async function snapshot(): Promise<void> {
      const account = await broker.snapshot();
      run.positions = account.positions;
      run.fills = broker.fills();
      const orders = store.listOrders(10000);
      run.metrics = calculateMetrics(run.config.startingCash, run.equity, run.fills, orders);
      atomic(join(runDir, "journal.json"), store.listJournal(10000));
      atomic(join(runDir, "orders.json"), orders);
      if (agent !== undefined) {
        atomic(join(runDir, "messages.json"), await agent.listMessages(10000));
        for (const id of children) atomic(join(runDir, `messages-${id}.json`), await agent.listMessages(10000, id));
      }
      save(run);
    }
    try {
      agent = await TradingAgent.open({ config: { ...deps.config, DATA_DIR: runDir }, credentialFile: deps.credentialFile ?? credentialFilePath(deps.config.DATA_DIR),
        log: deps.log.child(run.id), bus, clock, extensions,
        cycleInput: async (kind, cycleId) => {
          const account = await broker.snapshot();
          store.markEquity(now, deps.calendar.etDate(now), account.equity);
          return cycleInput({ kind, cycleId, market: deps.calendar.clock(now), settings: store.getSettings(), halts: await gate.halts(), account });
        } });
      agents.set(run.id, agent);
      const times: [number, number, CycleKind][] = [
        ...(run.config.cyclesPerDay >= 3 ? [[9, 0, "pre_open"] as [number, number, CycleKind]] : []),
        [10, 15, "intraday"], ...(run.config.cyclesPerDay === 4 ? [[12, 30, "intraday"] as [number, number, CycleKind]] : []), [15, 30, "intraday"],
      ];
      for (let i = 0; i < days.length && run.status === "running"; i++) {
        const day = days[i]!;
        run.currentDate = day.date;
        run.progress.day = i + 1;
        for (let j = 0; j < times.length && run.status === "running"; j++) {
          const [hour, minute, kind] = times[j]!;
          now = etInstant(day.date, hour, minute);
          await broker.advance();
          run.progress.cycle = j + 1;
          save(run);
          const result = await agent.runCycleAndWait(kind, 8 * 60_000);
          if (result !== "done") deps.log.warn("simulation cycle did not answer", { id: run.id, date: day.date, result });
          await snapshot();
        }
        if (run.status !== "running") break;
        now = etInstant(day.date, 16);
        await broker.advance();
        const account = await broker.snapshot();
        run.equity.push({ date: day.date, equity: account.equity, cash: account.cash, benchmark: run.config.startingCash * day.close / days[0]!.open });
        await snapshot();
      }
      if (run.status === "running") {
        now = etInstant(days.at(-1)!.date, 16, 10);
        await agent.runCycleAndWait("post_close", 8 * 60_000);
        if (run.status === "running") run.status = "done";
      }
      await snapshot();
    } finally {
      agents.delete(run.id);
      await agent?.close();
      artifacts.delete(run.id);
    }
  }
  function pump(): void {
    if (active !== undefined || closed) return;
    const id = queue.shift();
    if (id === undefined) return;
    const run = runs.get(id)!;
    if (run.status !== "queued") { pump(); return; }
    active = id;
    run.status = "running";
    save(run);
    work = execute(run).catch((error: unknown) => {
      if (run.status !== "stopped") { run.status = "failed"; run.error = error instanceof Error ? error.message : String(error); }
      deps.log.warn("simulation ended", { id, error: String(error) });
    }).finally(() => { artifacts.delete(id); run.finishedAt = Date.now(); save(run); active = undefined; pump(); });
  }
  return {
    async defaultStartDate(days) {
      const past = (await deps.market.history("SPY", "1y")).bars.filter((b) => b.date < deps.calendar.etDate(Date.now()));
      const date = past.at(-(days + 5))?.date;
      if (date === undefined) throw new Error("Insufficient historical sessions");
      return date;
    },
    async start(input, startedBy) {
      if (closed) throw new Error("Simulation service is closed");
      const config = SimRunConfigSchema.parse(input);
      if (config.startDate >= deps.calendar.etDate(Date.now())) throw new Error("Simulation must start in the past");
      if (startedBy === "agent" && (active !== undefined || queue.length > 0)) throw new Error("A simulation is already active");
      const spy = await replayMarket.barsBetween("SPY", config.startDate, deps.calendar.etDate(Date.now()));
      const days = tradingDays(spy, config.startDate, config.days);
      if (days.length !== config.days || days.at(-1)!.date >= deps.calendar.etDate(Date.now())) throw new Error("Simulation range is not fully in the past or historical bars are missing");
      // Recheck after I/O so concurrent agent calls cannot both start.
      if (closed || (startedBy === "agent" && (active !== undefined || queue.length > 0))) throw new Error("Simulation unavailable or already active");
      const id = `${new Date().toISOString().replace(/\D/g, "")}-${randomBytes(3).toString("hex")}`;
      const run: SimRun = { id, createdAt: Date.now(), startedBy, config, status: "queued", progress: { day: 0, days: config.days, cycle: 0, cyclesPerDay: config.cyclesPerDay }, equity: [], positions: [], fills: [] };
      mkdirSync(join(root, id), { mode: 0o700 }); runs.set(id, run); save(run); queue.push(id); pump(); return structuredClone(run);
    },
    list: () => [...runs.values()].sort((a, b) => b.createdAt - a.createdAt).map((r) => structuredClone(r)),
    get: (id) => { const run = runs.get(id); return run === undefined ? undefined : structuredClone(run); },
    async stop(id) { const run = runs.get(id); if (run === undefined) return undefined;
      if (run.status === "running" || run.status === "queued") { run.status = "stopped"; run.finishedAt = Date.now(); save(run); await agents.get(id)?.abortCycle(); }
      return structuredClone(run); },
    async messages(id, limit, conversationId) {
      if (conversationId !== undefined && !/^[1-9]\d*$/.test(conversationId)) throw new Error("Unknown conversation");
      const agent = agents.get(id);
      if (agent !== undefined) return agent.listMessages(limit, conversationId);
      return readJson<ChatMessage[]>(join(dir(id), conversationId === undefined ? "messages.json" : `messages-${conversationId}.json`), []).slice(-Math.max(0, Math.min(10000, limit)));
    },
    journal(id) { return artifacts.get(id)?.journal() ?? readJson<JournalEntry[]>(join(dir(id), "journal.json"), []); },
    orders(id) { return artifacts.get(id)?.orders() ?? readJson<OrderRecord[]>(join(dir(id), "orders.json"), []); },
    async close() { closed = true; for (const run of runs.values()) if (run.status === "running" || run.status === "queued") { run.status = "stopped"; run.finishedAt = Date.now(); save(run); }
      await Promise.all([...agents.values()].map((agent) => agent.abortCycle())); await work; },
  };
}
