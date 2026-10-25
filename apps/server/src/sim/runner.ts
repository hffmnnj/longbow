import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section, type Extension } from "@earendil-works/pi-durable";
import { DEFAULT_SETTINGS, SimRunConfigSchema, type Bar, type ChatMessage, type CycleKind, type JournalEntry, type OrderRecord, type Settings, type SimRun, type SimRunConfigInput } from "@rh/shared";
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
import { MarketCache } from "../market/cache.ts";
import { createSectorDirectory, type SectorDirectory } from "../market/sectors.ts";
import { createSubagentExtension } from "../agent/subagents.ts";
import { createQuantExtension } from "../quant/extension.ts";
import { createPaperBroker, type PaperBroker } from "./broker.ts";
import { createSimEventBus } from "./events.ts";
import { calculateMetrics } from "./metrics.ts";
import { etInstant, tradingDays } from "./path.ts";
import { scenarioById } from "./scenarios.ts";
import { buildScenarioMarket, createStaticSectorDirectory, type ScenarioMarket } from "./scenario-market.ts";
import { jsonValue } from "./json.ts";

export interface SimService {
  start(config: SimRunConfigInput, startedBy: "user" | "agent", options?: { suiteId?: string; variant?: string }): Promise<SimRun>;
  list(): SimRun[];
  get(id: string): SimRun | undefined;
  stop(id: string): Promise<SimRun | undefined>;
  messages(id: string, limit: number, conversationId?: string): Promise<ChatMessage[]>;
  journal(id: string): JournalEntry[];
  orders(id: string): OrderRecord[];
  close(): Promise<void>;
  defaultStartDate(days: number): Promise<string>;
}

/** What a test driver sees at each simulated cycle (no model credentials needed). */
export interface SimDriverContext {
  kind: CycleKind;
  bars(symbol: string): Promise<Bar[]>;
  market: MarketData;
  asOf: () => string;
  symbols: string[];
  benchmark: string;
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
  /** Test seam: source bars without Nasdaq (defaults to the replay market). */
  fetchBars?: (symbol: string, from: string, to: string) => Promise<Bar[]>;
  /** Test seam: replaces the TradingAgent cycle run (which needs model credentials). */
  driver?: (run: SimRun, ctx: SimDriverContext) => Promise<void>;
  /** Test seam: real-symbol sectors without SEC lookups. */
  sectorSource?: SectorDirectory;
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

function historicalPrompt(strategy: string | undefined): string {
  return "This is a historical paper-account simulation. The simulated date is in each cycle. Treat it exactly like the live account. Web search and Robinhood tools are unavailable to prevent look-ahead. Use sim_quote for current prices and sim_orders to confirm fills and account state; sim_cancel_order cancels resting orders. Historical indicators exclude today's incomplete bar. Never use remembered future events or prices.\n" + (strategy ?? "");
}

function scenarioPrompt(scenario: ScenarioMarket, strategy: string | undefined): string {
  const dropped = scenario.dropped.length === 0
    ? ""
    : ` Unavailable this run for missing history: ${scenario.dropped.join(", ")}.`;
  return "This is a paper-account simulation on a fictional market. Tickers are aliases with disclosed sectors, dates are fictional weekdays, and prices are rescaled; treat MKT as the broad-market index. Macro, earnings, calendar, volatility, yield and SEC tools are unavailable. Trade only on what the market, quant and account tools show; never use remembered real-world events or prices." +
    ` Visible universe: ${scenario.universeText}.${dropped}\n` + (strategy ?? "");
}

export function createSimService(deps: SimServiceDeps): SimService {
  const root = join(deps.config.DATA_DIR, "sim");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const replayMarket = new MarketStore({ dataDir: root, log: deps.log, clock: { now: () => Date.now() } });
  const fetchBars = deps.fetchBars ?? ((symbol, from, to) => replayMarket.barsBetween(symbol, from, to));
  const runs = new Map<string, SimRun>();
  const agents = new Map<string, TradingAgent>();
  const artifacts = new Map<string, { journal: () => JournalEntry[]; orders: () => OrderRecord[] }>();
  const aliasMaps = new Map<string, Record<string, string>>();
  const calendars = new Map<string, ScenarioMarket["calendar"]>();
  const queue: string[] = [];
  const active = new Set<string>();
  const pending = new Set<Promise<void>>();
  let closed = false;
  const dir = (id: string): string => { if (!runs.has(id)) throw new Error("Unknown simulation"); return join(root, id); };
  function poolSize(): number {
    const n = deps.config.SIM_CONCURRENCY;
    return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 2;
  }
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
    const blindish = run.config.mode === "blind" || run.config.mode === "bootstrap";
    const todayStr = deps.calendar.etDate(Date.now());
    let now = 0;
    const clock = { now: () => now };
    const bus = createSimEventBus(deps.bus, run.id);
    const store = openStore(join(runDir, "app.sqlite"), clock);
    artifacts.set(run.id, { journal: () => store.listJournal(10000), orders: () => store.listOrders(10000) });
    const liveSettings = deps.settings?.() ?? DEFAULT_SETTINGS;
    store.patchSettings({ ...liveSettings, mode: "auto", killSwitch: false, drawdownHalted: false,
      watchlist: run.config.watchlist ?? liveSettings.watchlist, risk: { ...liveSettings.risk, ...run.config.risk } });
    const universe = [...new Set(run.config.watchlist ?? liveSettings.watchlist)];
    let bars: (symbol: string) => Promise<Bar[]>;
    let market: MarketData;
    let asOf: () => string;
    let symbols: string[];
    let benchmark = "SPY";
    let simDays: string[];
    let benchPrice: (date: string) => number;
    let scenario: ScenarioMarket | undefined;
    if (!blindish) {
      const startDate = run.config.startDate;
      if (startDate === undefined) throw new Error("Simulation start date is missing");
      const history = new Map<string, Promise<Bar[]>>();
      bars = (symbol: string): Promise<Bar[]> => {
        let promise = history.get(symbol);
        if (promise === undefined) {
          const from = new Date(Date.parse(`${startDate}T12:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
          // Fetch through today for Nasdaq compatibility, but retain the historical path privately.
          promise = fetchBars(symbol, from, todayStr); history.set(symbol, promise);
        }
        return promise;
      };
      const spy = await bars("SPY");
      const days = tradingDays(spy, startDate, run.config.days);
      if (days.length !== run.config.days || days.some((b) => b.date >= todayStr)) throw new Error("Simulation range must contain the requested number of completed past trading days");
      simDays = days.map((b) => b.date);
      const closes = new Map(days.map((b) => [b.date, b.close]));
      const firstOpen = days[0]!.open;
      benchPrice = (date) => (closes.get(date) ?? NaN) / firstOpen * run.config.startingCash;
      asOf = (): string => spy.filter((b) => b.date < deps.calendar.etDate(now) || (b.date === deps.calendar.etDate(now) && now >= etInstant(b.date, 16))).at(-1)?.date ?? (() => { throw new Error("No prior trading day available"); })();
      const historicalMarket = new MarketStore({ dataDir: runDir, log: deps.log, clock: { now: () => Date.now() }, asOf });
      market = createPointInTimeMarketData(historicalMarket, asOf);
      symbols = universe;
      now = etInstant(startDate, 9);
    } else {
      if (run.seed === undefined) throw new Error("Simulation seed is missing");
      const sectorSource = deps.sectorSource ?? createSectorDirectory({ cache: new MarketCache(runDir, deps.log, clock), log: deps.log });
      scenario = await buildScenarioMarket({ mode: run.config.mode as "blind" | "bootstrap", seed: run.seed,
        watchlist: universe, days: run.config.days,
        ...(run.config.startDate === undefined ? {} : { startDate: run.config.startDate }),
        today: todayStr, fetch: fetchBars, sectors: sectorSource });
      aliasMaps.set(run.id, scenario.aliases);
      calendars.set(run.id, { ...scenario.calendar });
      bars = (symbol: string) => scenario!.bars(symbol);
      simDays = scenario.simDates;
      const benchBars = new Map((await scenario.bars(scenario.benchmark)).map((b) => [b.date, b]));
      const firstOpen = benchBars.get(simDays[0]!)?.open ?? NaN;
      benchPrice = (date) => (benchBars.get(date)?.close ?? NaN) / firstOpen * run.config.startingCash;
      asOf = (): string => {
        const current = deps.calendar.etDate(now);
        const dates = scenario!.allDates;
        return dates.filter((d) => d < current || (d === current && now >= etInstant(d, 16))).at(-1)
          ?? (() => { throw new Error("No prior trading day available"); })();
      };
      market = scenario.market(asOf);
      symbols = scenario.symbols;
      benchmark = scenario.benchmark;
      now = etInstant(simDays[0]!, 9);
    }
    const broker = createPaperBroker({ startingCash: run.config.startingCash, clock, calendar: deps.calendar, bars,
      execution: run.config.execution, seed: run.seed });
    const gate = createOrderGate({ store, broker, calendar: deps.calendar, clock, bus, log: deps.log, market,
      ...(scenario === undefined ? {} : { sectors: createStaticSectorDirectory(Object.fromEntries(scenario.symbols.map((s) => [s, scenario!.sectorOf(s)]))) }) });
    let agent: TradingAgent | undefined;
    const currentCycleId = (): string | undefined => agent?.currentCycleId();
    const children = new Set<string>();
    const notes = createNotes({ dir: join(runDir, "workspace"), bus, clock });
    const quant = createQuantExtension({ market, getAccount: () => broker.snapshot().catch(() => null),
      getRisk: () => store.getSettings().risk, universe: () => [...symbols],
      sectorOf: scenario === undefined ? () => undefined : (symbol) => scenario!.sectorOf(symbol),
      benchmark: () => benchmark, clock, log: deps.log });
    const extensions: Extension[] = [
      createRiskExtension({ gate, store, calendar: deps.calendar, clock, broker, currentCycleId }),
      createJournalExtension({ store, bus, clock, currentCycleId }),
      createTraderPromptExtension(),
      createSkillsExtension({ library: deps.skills, notes }),
      // Transport/cache time stays real so Nasdaq accepts history windows;
      // every agent-visible market date is independently constrained by asOf.
      // Blind and bootstrap runs read only the scenario market: no earnings,
      // calendars, VIX, yields, or SEC tools are registered.
      createMarketExtension({ market, dataDir: runDir, log: deps.log, clock: { now: () => Date.now() }, asOf,
        ...(blindish ? { pricesOnly: true as const } : {}) }),
      quant,
      createSubagentExtension({ log: deps.log, maxConcurrent: 4,
        excludedTools: ["submit_order", "notes_write", "notes_append", "record_decision", "delegate", "sim_cancel_order"],
        onRun(child) { children.add(child.id); bus.publish({ type: "subagent", run: child }); if (child.status === "running") void agent?.watchChild(child.id).catch((error: unknown) => deps.log.warn("simulation child watch failed", { error: String(error) })); } }),
      paperTools(broker, deps.calendar, clock.now),
      defineExtension({ name: "simulation-prompt", sections: [section("simulation", () =>
        scenario === undefined ? historicalPrompt(run.config.strategy) : scenarioPrompt(scenario, run.config.strategy))] }),
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
      if (deps.driver === undefined) {
        const agentConfig = run.config.model === "subagent"
          ? { ...deps.config, MAIN_MODEL: deps.config.SUBAGENT_MODEL }
          : deps.config;
        agent = await TradingAgent.open({ config: { ...agentConfig, DATA_DIR: runDir }, credentialFile: deps.credentialFile ?? credentialFilePath(deps.config.DATA_DIR),
          log: deps.log.child(run.id), bus, clock, extensions,
          cycleInput: async (kind, cycleId) => {
            const account = await broker.snapshot();
            store.markEquity(now, deps.calendar.etDate(now), account.equity);
            return cycleInput({ kind, cycleId, market: deps.calendar.clock(now), settings: store.getSettings(), halts: await gate.halts(), account });
          } });
        agents.set(run.id, agent);
      }
      const stepCycle = deps.driver !== undefined
        ? async (kind: CycleKind) => { await deps.driver!(run, { kind, bars, market, asOf, symbols: [...symbols], benchmark }); }
        : async (kind: CycleKind) => {
            const result = await agent!.runCycleAndWait(kind, 8 * 60_000);
            if (result !== "done") deps.log.warn("simulation cycle did not answer", { id: run.id, date: run.currentDate, result });
          };
      const times: [number, number, CycleKind][] = [
        ...(run.config.cyclesPerDay >= 3 ? [[9, 0, "pre_open"] as [number, number, CycleKind]] : []),
        [10, 15, "intraday"], ...(run.config.cyclesPerDay === 4 ? [[12, 30, "intraday"] as [number, number, CycleKind]] : []), [15, 30, "intraday"],
      ];
      for (let i = 0; i < simDays.length && run.status === "running"; i++) {
        const date = simDays[i]!;
        run.currentDate = date;
        run.progress.day = i + 1;
        for (let j = 0; j < times.length && run.status === "running"; j++) {
          const [hour, minute, kind] = times[j]!;
          now = etInstant(date, hour, minute);
          await broker.advance();
          run.progress.cycle = j + 1;
          save(run);
          await stepCycle(kind);
          await snapshot();
        }
        if (run.status !== "running") break;
        now = etInstant(date, 16);
        await broker.advance();
        const account = await broker.snapshot();
        run.equity.push({ date, equity: account.equity, cash: account.cash, benchmark: benchPrice(date) });
        await snapshot();
      }
      if (run.status === "running") {
        now = etInstant(simDays.at(-1)!, 16, 10);
        await stepCycle("post_close");
        if (run.status === "running") run.status = "done";
      }
      await snapshot();
    } finally {
      agents.delete(run.id);
      await agent?.close();
      artifacts.delete(run.id);
    }
  }
  function agentBlocked(): boolean {
    return [...runs.values()].some((run) => run.startedBy === "agent" && run.suiteId === undefined && (run.status === "running" || run.status === "queued"));
  }
  function pump(): void {
    if (closed) return;
    while (active.size < poolSize()) {
      const id = queue.shift();
      if (id === undefined) return;
      const run = runs.get(id);
      if (run === undefined || run.status !== "queued") continue;
      active.add(id);
      run.status = "running";
      save(run);
      const task = execute(run).catch((error: unknown) => {
        if (run.status !== "stopped") { run.status = "failed"; run.error = error instanceof Error ? error.message : String(error); }
        deps.log.warn("simulation ended", { id, error: String(error) });
      }).finally(() => {
        try {
          if (run.config.mode !== "historical") {
            const aliases = aliasMaps.get(id);
            if (aliases !== undefined) run.aliases = { ...aliases };
            aliasMaps.delete(id);
            const calendar = calendars.get(id);
            if (calendar !== undefined) run.calendar = { ...calendar };
            calendars.delete(id);
          }
        } finally {
          artifacts.delete(id);
          run.finishedAt = Date.now();
          save(run);
          active.delete(id);
          pump();
        }
      });
      pending.add(task);
      void task.finally(() => { pending.delete(task); });
    }
  }
  return {
    async defaultStartDate(days) {
      const past = (await deps.market.history("SPY", "1y")).bars.filter((b) => b.date < deps.calendar.etDate(Date.now()));
      const date = past.at(-(days + 5))?.date;
      if (date === undefined) throw new Error("Insufficient historical sessions");
      return date;
    },
    async start(input, startedBy, options) {
      if (closed) throw new Error("Simulation service is closed");
      const raw = (input ?? {}) as Record<string, unknown>;
      const scenarioId = raw["scenario"] as string | undefined;
      const library = scenarioId === undefined ? undefined : scenarioById(scenarioId);
      if (scenarioId !== undefined && library === undefined) throw new Error(`Unknown scenario "${scenarioId}"`);
      const filled: Record<string, unknown> = { ...raw };
      if (library !== undefined) {
        if (filled["startDate"] === undefined) filled["startDate"] = library.startDate;
        if (filled["days"] === undefined) filled["days"] = library.days;
      }
      const config = SimRunConfigSchema.parse(filled);
      const mode = config.mode;
      const startDate = mode === "bootstrap" ? undefined : (config.startDate ?? library?.startDate);
      if (startDate === undefined) throw new Error("A start date is required");
      const today = deps.calendar.etDate(Date.now());
      if (startDate >= today) throw new Error("Simulation must start in the past");
      if (startedBy === "agent" && options?.suiteId === undefined && agentBlocked()) throw new Error("A simulation is already active");
      if (mode === "bootstrap") {
        // No date validation: the bootstrap market is synthetic and ignores startDate.
      } else if (mode === "blind") {
        const from = new Date(Date.parse(`${startDate}T12:00:00Z`) - 800 * 86_400_000).toISOString().slice(0, 10);
        const spy = await fetchBars("SPY", from, today);
        const dates = spy.map((b) => b.date).sort();
        const startIdx = dates.indexOf(startDate);
        if (startIdx < 300 || startIdx + config.days > dates.length || dates[startIdx + config.days - 1]! >= today) {
          throw new Error("Simulation range is not fully in the past or historical bars are missing");
        }
      } else {
        const spy = await fetchBars("SPY", startDate, today);
        const days = tradingDays(spy, startDate, config.days);
        if (days.length !== config.days || days.at(-1)!.date >= today) throw new Error("Simulation range is not fully in the past or historical bars are missing");
      }
      // Recheck after I/O so concurrent agent calls cannot both start.
      if (closed || (startedBy === "agent" && options?.suiteId === undefined && agentBlocked())) throw new Error("Simulation unavailable or already active");
      const seed = config.seed ?? Math.floor(Math.random() * 2_147_483_648);
      const id = `${new Date().toISOString().replace(/\D/g, "")}-${randomBytes(3).toString("hex")}`;
      const run: SimRun = { id, createdAt: Date.now(), startedBy,
        // Bootstrap markets are synthetic: a startDate would claim a source window the run never used.
        config: mode === "bootstrap" ? { ...config, startDate: undefined } : config, seed,
        ...(options?.suiteId === undefined ? {} : { suiteId: options.suiteId }),
        ...(options?.variant === undefined ? {} : { variant: options.variant }),
        status: "queued", progress: { day: 0, days: config.days, cycle: 0, cyclesPerDay: config.cyclesPerDay }, equity: [], positions: [], fills: [] };
      mkdirSync(join(root, id), { mode: 0o700 }); runs.set(id, run); save(run); queue.push(id); pump(); return structuredClone(run);
    },
    list: () => [...runs.values()].sort((a, b) => b.createdAt - a.createdAt).map((r) => structuredClone(r)),
    get: (id) => { const run = runs.get(id); return run === undefined ? undefined : structuredClone(run); },
    async stop(id) { const run = runs.get(id); if (run === undefined) return undefined;
      if (run.status === "running" || run.status === "queued") {
        if (run.config.mode !== "historical") {
          const aliases = aliasMaps.get(id);
          if (aliases !== undefined) run.aliases = { ...aliases };
          const calendar = calendars.get(id);
          if (calendar !== undefined) run.calendar = { ...calendar };
        }
        run.status = "stopped"; run.finishedAt = Date.now(); save(run); await agents.get(id)?.abortCycle();
      }
      return structuredClone(run); },
    async messages(id, limit, conversationId) {
      if (conversationId !== undefined && !/^[1-9]\d*$/.test(conversationId)) throw new Error("Unknown conversation");
      const agent = agents.get(id);
      if (agent !== undefined) return agent.listMessages(limit, conversationId);
      return readJson<ChatMessage[]>(join(dir(id), conversationId === undefined ? "messages.json" : `messages-${conversationId}.json`), []).slice(-Math.max(0, Math.min(10000, limit)));
    },
    journal(id) { return artifacts.get(id)?.journal() ?? readJson<JournalEntry[]>(join(dir(id), "journal.json"), []); },
    orders(id) { return artifacts.get(id)?.orders() ?? readJson<OrderRecord[]>(join(dir(id), "orders.json"), []); },
    async close() {
      closed = true;
      const running = [...active];
      for (const run of runs.values()) if (run.status === "running" || run.status === "queued") { run.status = "stopped"; run.finishedAt = Date.now(); save(run); }
      // A completed run can still be snapshotting/closing after its final event.
      // Join that work rather than racing its close with an unnecessary abort.
      await Promise.all(running.map((id) => agents.get(id)?.abortCycle()));
      await Promise.all([...pending]);
    },
  };
}
