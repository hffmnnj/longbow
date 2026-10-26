import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { AccountSnapshot, StatusResponse, SubagentRun } from "@rh/shared";
import { loadConfig } from "./config.ts";
import { createLogger } from "./log.ts";
import { createEventBus } from "./events.ts";
import { openStore } from "./db/store.ts";
import { TradingAgent } from "./agent/runtime.ts";
import { startScheduler } from "./scheduler/cycles.ts";
import { buildStatus, createApp } from "./http/app.ts";
import { createNyseCalendar } from "./risk/calendar.ts";
import { createRobinhoodBroker } from "./robinhood/broker.ts";
import { createOrderGate } from "./risk/gate.ts";
import { createRiskExtension } from "./risk/tools.ts";
import { createWebsearchExtension } from "./tools/websearch.ts";
import { createJournalExtension } from "./tools/journal.ts";
import { createTraderPromptExtension, cycleInput } from "./agent/prompt.ts";
import { createSkillLibrary } from "./skills/library.ts";
import { createNotes } from "./skills/notes.ts";
import { createSkillsExtension } from "./skills/tools.ts";
import { createMarketData } from "./market/market-data.ts";
import { MarketCache } from "./market/cache.ts";
import { createSectorDirectory } from "./market/sectors.ts";
import { createMarketExtension } from "./market/tools.ts";
import { createSubagentExtension } from "./agent/subagents.ts";
import { createBackgroundSubagentExtension } from "./agent/background-subagents.ts";
import { createPushService } from "./push/service.ts";
import { startNotifier } from "./push/notifier.ts";
import { mountPushRoutes } from "./http/push-routes.ts";
import { createNativePushHub } from "./push/native-stream.ts";
import { createSimService } from "./sim/runner.ts";
import { createSimToolsExtension } from "./sim/tools.ts";
import { mountSimRoutes } from "./http/sim-routes.ts";
import { createSuiteService } from "./sim/suite.ts";
import { createQuantExtension } from "./quant/extension.ts";
import { DEFAULT_UNIVERSE } from "./quant/universe.ts";
import { createAnalyticsService } from "./analytics/service.ts";
import { mountAnalyticsRoutes } from "./http/analytics-routes.ts";
import { createReportExtension } from "./reports/extension.ts";
import { isLastTradingDayOfWeek } from "./reports/ids.ts";
import { ensureDailyReport } from "./reports/service.ts";
import { mountReportRoutes } from "./http/report-routes.ts";
import { credentialFilePath } from "./agent/credential-store.ts";
import { createConfiguredSystemOne } from "./systemone/setup.ts";
import { createEntryReview } from "./systemone/review.ts";
import { createSystemOneExtension } from "./systemone/extension.ts";

const MAX_SUBAGENT_RUNS = 50;

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger("harness");
  const clock = { now: () => Date.now() };
  const bus = createEventBus();
  const store = openStore(join(config.DATA_DIR, "app.sqlite"), clock);

  const calendar = createNyseCalendar();
  const market = createMarketData({ dataDir: config.DATA_DIR, log: log.child("market"), clock });
  // Newest first; presentation state for the agents lane, rebuilt from live runs after a restart.
  const subagentRuns: SubagentRun[] = [];
  const onSubagentRun = (run: SubagentRun): void => {
    const index = subagentRuns.findIndex((existing) => existing.id === run.id);
    if (index >= 0) subagentRuns.splice(index, 1);
    subagentRuns.unshift(run);
    subagentRuns.length = Math.min(subagentRuns.length, MAX_SUBAGENT_RUNS);
    bus.publish({ type: "subagent", run });
    if (run.status === "running") {
      void agent?.watchChild(run.id).catch((error: unknown) => {
        log.warn("subagent watch failed", { error: error instanceof Error ? error.message : "unknown" });
      });
    }
  };
  const broker = createRobinhoodBroker({ config, log: log.child("robinhood"), clock });
  const sectors = createSectorDirectory({ cache: new MarketCache(config.DATA_DIR, log.child("sectors"), clock), log: log.child("sectors") });
  const systemOne = createConfiguredSystemOne(config, log.child("systemone"), clock);
  const gate = createOrderGate({
    store,
    broker,
    calendar,
    clock,
    bus,
    log: log.child("risk"),
    market,
    sectors,
    entryReview: createEntryReview({ client: systemOne, clock, log: log.child("systemone") }),
  });

  // Late-bound: extensions and the scheduler need the agent's id before it exists.
  let agent: TradingAgent | undefined;
  const currentCycleId = (): string | undefined => agent?.currentCycleId();

  let cachedAccount: AccountSnapshot | null = null;
  const refreshAccount = async (why: string): Promise<void> => {
    if (broker.status().state !== "connected") return;
    try {
      const snapshot = await broker.snapshot();
      await sectors.resolve(snapshot.positions.map((p) => p.symbol));
      cachedAccount = {
        ...snapshot,
        positions: snapshot.positions.map((p) => {
          const sector = p.sector ?? sectors.get(p.symbol);
          return sector === undefined ? p : { ...p, sector };
        }),
      };
      store.markEquity(cachedAccount.at, calendar.etDate(cachedAccount.at), cachedAccount.equity);
    } catch (error) {
      log.warn("account refresh failed", { why, error: error instanceof Error ? error.message : "unknown" });
    }
  };

  // Fill the account card as soon as Robinhood connects, not only at the next cycle or market-hours tick.
  let wasConnected = false;
  broker.onChange(() => {
    const connected = broker.status().state === "connected";
    if (connected && !wasConnected) void refreshAccount("connect");
    wasConnected = connected;
  });

  const skills = createSkillLibrary(SKILLS_DIR);
  // Simulation runs share the live Muse credential file so a token refresh never forks it.
  const sim = createSimService({
    config,
    log: log.child("sim"),
    bus,
    market,
    systemOne,
    skills,
    calendar,
    settings: () => store.getSettings(),
    credentialFile: credentialFilePath(config.DATA_DIR),
  });
  const suites = createSuiteService({ runner: sim, bus, log: log.child("suites"), dataDir: config.DATA_DIR });
  const notes = createNotes({ dir: join(config.DATA_DIR, "workspace"), bus, clock });
  const analytics = createAnalyticsService({
    store,
    market,
    broker,
    getAccount: () => cachedAccount,
    notes,
    calendar,
    clock,
    log: log.child("analytics"),
    dataDir: config.DATA_DIR,
  });

  const extensions = [
    createRiskExtension({ gate, store, calendar, clock, broker, currentCycleId, cancelOrder: (id) => gate.cancel(id) }),
    await createWebsearchExtension({ configFile: config.WEBSEARCH_CONFIG_FILE, log: log.child("websearch") }),
    createJournalExtension({ store, bus, clock, currentCycleId }),
    // Live only: simulations build their own extension list and never publish reports.
    createReportExtension({
      store,
      market,
      broker,
      getAccount: () => cachedAccount,
      notes,
      calendar,
      clock,
      log: log.child("reports"),
      bus,
      currentCycleId,
    }),
    createTraderPromptExtension(),
    createSkillsExtension({ library: skills, notes }),
    createMarketExtension({ market, dataDir: config.DATA_DIR, log: log.child("market"), clock }),
    createSubagentExtension({
      log: log.child("subagents"),
      maxConcurrent: 4,
      excludedTools: ["submit_order", "cancel_order", "notes_write", "notes_append", "record_decision", "publish_report", "delegate"],
      onRun: onSubagentRun,
      model: { provider: config.SUBAGENT_MODEL.provider, modelId: config.SUBAGENT_MODEL.modelId },
      thinkingLevel: config.SUBAGENT_MODEL.thinkingLevel,
    }),
    // Live only: simulations replay on a fixed clock, and helpers reporting between cycles would break it.
    createBackgroundSubagentExtension({
      log: log.child("background-subagents"),
      excludedTools: ["submit_order", "cancel_order", "notes_write", "notes_append", "record_decision", "publish_report"],
      onRun: onSubagentRun,
      model: { provider: config.SUBAGENT_MODEL.provider, modelId: config.SUBAGENT_MODEL.modelId },
      thinkingLevel: config.SUBAGENT_MODEL.thinkingLevel,
    }),
    createSimToolsExtension({ sim, suites }),
    createSystemOneExtension({
      client: systemOne,
      market,
      isEnabled: () => store.getSettings().systemOne.enabled,
      benchmark: () => "SPY",
      log: log.child("systemone"),
      clock,
    }),
    createQuantExtension({
      market,
      getAccount: async () => (broker.status().state === "connected" ? await broker.snapshot().catch(() => cachedAccount) : cachedAccount),
      getRisk: () => store.getSettings().risk,
      universe: () => [
        ...new Set([...DEFAULT_UNIVERSE, ...store.getSettings().watchlist, ...(cachedAccount?.positions.map((p) => p.symbol) ?? [])]),
      ],
      sectorOf: (symbol) => sectors.get(symbol),
      benchmark: () => "SPY",
      clock,
      log: log.child("quant"),
    }),
  ];

  agent = await TradingAgent.open({
    config,
    log: log.child("agent"),
    bus,
    clock,
    extensions,
    onRegistry: (registry) => broker.attach(registry),
    cycleInput: async (kind, cycleId) => {
      await gate.sync();
      await refreshAccount(`cycle-${cycleId}`);
      return cycleInput({
        kind,
        cycleId,
        market: calendar.clock(clock.now()),
        settings: store.getSettings(),
        halts: await gate.halts(),
        account: cachedAccount,
        isLastTradingDayOfWeek: isLastTradingDayOfWeek(calendar, calendar.etDate(clock.now())),
      });
    },
    // Safety net: a post_close cycle that ends without a daily report for the
    // date publishes one from the cycle's own review, so the owner always gets
    // the daily numbers.
    onSettled: (kind) => {
      if (kind !== "post_close") return;
      const date = calendar.etDate(clock.now());
      void ensureDailyReport(
        {
          store,
          market,
          broker,
          getAccount: () => cachedAccount,
          notes,
          calendar,
          clock,
          log: log.child("reports"),
          bus,
          currentCycleId,
        },
        date,
      ).catch((error: unknown) => {
        log.warn("daily report safety net failed", { date, error: error instanceof Error ? error.message : "unknown" });
      });
    },
  });
  const tradingAgent = agent;

  const scheduler = startScheduler({
    agent: tradingAgent,
    calendar,
    store,
    bus,
    clock,
    log: log.child("scheduler"),
    onNext: (next) => tradingAgent.setNextCycle(next),
  });

  const appDeps = {
    config,
    store,
    bus,
    agent: tradingAgent,
    broker,
    gate,
    calendar,
    clock,
    scheduler,
    getAccount: (): AccountSnapshot | null => cachedAccount,
    log: log.child("http"),
    skills,
    notes,
    market,
    subagents: (): SubagentRun[] => subagentRuns,
    systemOne,
  };
  // Agent status events carry the live snapshot minus the agent field itself.
  tradingAgent.setStatusSnapshot(async (): Promise<Omit<StatusResponse, "agent">> => {
    const { agent: _agent, ...rest } = await buildStatus(appDeps);
    void _agent;
    return rest;
  });

  const app = createApp(appDeps);
  const push = createPushService({
    dataDir: config.DATA_DIR,
    log: log.child("push"),
    subject: "mailto:hffmnnj@users.noreply.github.com",
  });
  mountPushRoutes(app, { push, log: log.child("push") });
  const nativePush = createNativePushHub();
  nativePush.mount(app);
  mountSimRoutes(app, { sim, suites, log: log.child("sim") });
  mountAnalyticsRoutes(app, { analytics, log: log.child("analytics") });
  mountReportRoutes(app, { store, log: log.child("reports") });
  const stopNotifier = startNotifier({ bus, push: nativePush.wrap(push), log: log.child("push") });

  const refresher = setInterval(() => {
    if (calendar.clock(clock.now()).session !== "regular") return;
    void refreshAccount("interval");
  }, 5 * 60_000);
  refresher.unref();
  const stopWatcher = setInterval(() => {
    if (broker.status().state !== "connected") return;
    void gate.tick().catch(() => log.warn("protective stop watcher failed; reconciliation required"));
  }, 60_000);
  stopWatcher.unref();

  const servers = (config.BIND_HOST === undefined ? config.HOSTS : [config.BIND_HOST]).map((hostname) =>
    serve({ fetch: app.fetch, port: config.PORT, hostname }, (info) => {
      log.info("listening", { host: info.address, port: info.port });
    }),
  );

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal });
    clearInterval(refresher);
    clearInterval(stopWatcher);
    stopNotifier();
    suites.close();
    void sim.close();
    scheduler.stop();
    for (const server of servers) server.close();
    void tradingAgent.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  process.stderr.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
