import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmdirSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { DEFAULT_SETTINGS } from "@rh/shared";
import type { Bar, CycleKind, OrderIntent, SimRun, SimRunConfigInput } from "@rh/shared";
import { createSimService, type SimDriverContext } from "./runner.ts";
import { createSuiteService } from "./suite.ts";
import type { PaperBroker } from "./broker.ts";
import { etInstant } from "./path.ts";
import { createStaticSectorDirectory } from "./scenario-market.ts";
import { createMarketExtension } from "../market/tools.ts";
import { mountSimRoutes } from "../http/sim-routes.ts";
import { createEventBus } from "../events.ts";
import { createNyseCalendar } from "../risk/calendar.ts";
import { loadConfig } from "../config.ts";
import type { Logger, MarketCalendar, MarketData, SkillLibrary } from "../ports.ts";

const log: Logger = { info() {}, warn() {}, error() {}, child() { return this; } };
const market: MarketData = { async history(symbol) { return { symbol, asOf: 0, source: "fixture", bars: [] }; }, async nextEarnings() { return undefined; }, async avgDollarVolume() { return undefined; } };
const skills: SkillLibrary = { list: () => [], get: () => undefined, readFile: async () => "" };

test("restart marks interrupted runs failed, retains results, and never seeds credentials", async () => {
  const dataDir = mkdtempSync("/tmp/sim-test-");
  const runDir = join(dataDir, "sim", "old-run");
  mkdirSync(runDir, { recursive: true });
  const run: SimRun = { id: "old-run", createdAt: 1, startedBy: "user", config: { startDate: "2026-07-01", days: 1, startingCash: 1200, cyclesPerDay: 2, mode: "historical", execution: "ideal", model: "main" },
    status: "running", progress: { day: 1, days: 1, cycle: 1, cyclesPerDay: 2 }, equity: [], fills: [], positions: [] };
  writeFileSync(join(runDir, "run.json"), JSON.stringify(run));
  writeFileSync(join(runDir, "messages.json"), JSON.stringify([{ id: "1", at: 1, role: "assistant", text: "Saved replay" }]));
  const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills, calendar: createNyseCalendar() });
  try {
    assert.equal(sim.get(run.id)?.status, "failed");
    assert.equal(sim.get(run.id)?.error, "interrupted by restart");
    assert.equal(JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")).status, "failed");
    assert.deepEqual((await sim.messages(run.id, 200)).map((m) => m.text), ["Saved replay"]);
    await assert.rejects(sim.messages(run.id, 1, "../../credentials"), /Unknown conversation/);
    assert.equal(existsSync(join(dataDir, "credentials")), false);
    assert.equal(existsSync(join(dataDir, "app.sqlite")), false);
    const copy = sim.get(run.id)!; copy.status = "done";
    assert.equal(sim.get(run.id)?.status, "failed");
  } finally {
    await sim.close();
    unlinkSync(join(runDir, "run.json")); unlinkSync(join(runDir, "messages.json")); rmdirSync(runDir); rmdirSync(join(dataDir, "sim")); rmdirSync(dataDir);
  }
});

test("simulation HTTP validates configuration, reports missing runs, and caps transcript limits", async () => {
  const dataDir = mkdtempSync("/tmp/sim-http-test-");
  const runDir = join(dataDir, "sim", "done-run"); mkdirSync(runDir, { recursive: true });
  const run: SimRun = { id: "done-run", createdAt: 1, startedBy: "user", config: { startDate: "2026-07-01", days: 1, startingCash: 1200, cyclesPerDay: 2, mode: "historical", execution: "ideal", model: "main" },
    status: "done", progress: { day: 1, days: 1, cycle: 2, cyclesPerDay: 2 }, equity: [], fills: [], positions: [] };
  writeFileSync(join(runDir, "run.json"), JSON.stringify(run));
  const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills, calendar: createNyseCalendar() });
  const app = new Hono(); mountSimRoutes(app, { sim, log });
  try {
    assert.equal((await app.request("/api/sim/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ days: 0 }) })).status, 400);
    assert.equal((await app.request("/api/sim/runs", { method: "POST", body: "{" })).status, 400);
    assert.equal((await app.request("/api/sim/runs/missing")).status, 404);
    assert.equal((await app.request("/api/sim/runs/done-run/messages?limit=999999")).status, 400);
    assert.deepEqual(await (await app.request("/api/sim/runs/done-run/journal")).json(), []);
    assert.deepEqual(await (await app.request("/api/sim/runs/done-run/orders")).json(), []);
    assert.equal(((await (await app.request("/api/sim/runs")).json()) as SimRun[])[0]!.id, "done-run");
    const future = { ...run.config, startDate: "2099-01-01" };
    const response = await app.request("/api/sim/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(future) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Simulation must start in the past" });
  } finally {
    await sim.close(); unlinkSync(join(runDir, "run.json")); rmdirSync(runDir); rmdirSync(join(dataDir, "sim")); rmdirSync(dataDir);
  }
});

// ---------------------------------------------------------------------------
// Simulation modes, concurrency, and the scenario market (test seams: the
// driver replaces the TradingAgent, fetchBars replaces Nasdaq, sectorSource
// replaces SEC lookups).

function symbolSeed(symbol: string): number {
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Deterministic weekday bars for any symbol over any range; a pure function of the date. */
function fixtureBars(symbol: string, from: string, to: string): Bar[] {
  const seed = symbolSeed(symbol);
  const base = 40 + (seed % 200);
  const t0 = Date.parse("2016-10-24T12:00:00Z");
  const out: Bar[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); ; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (date > to) break;
    const day = new Date(t).getUTCDay();
    if (day === 0 || day === 6) continue;
    const n = Math.round((t - t0) / 86_400_000);
    const close = base + n * 0.05 + Math.sin(n / 7 + seed) * 2;
    const open = close * (1 + 0.001 * Math.sin(n / 5 + seed));
    out.push({ date, open, high: Math.max(open, close) * 1.002, low: Math.min(open, close) * 0.998, close,
      volume: 1_000_000 + (seed % 500_000) + n * 100 });
  }
  return out;
}

/**
 * The runner checks a historical start date and its fetched window against
 * the wall clock. This fixture session is later than the host date, so
 * wall-clock reads resolve to `wallDate` while every simulated instant keeps
 * the real New York mapping.
 */
function futureSessionCalendar(wallDate: string): MarketCalendar {
  const base = createNyseCalendar();
  const startedAt = Date.now();
  const wallInstant = etInstant(wallDate, 12);
  const isWallRead = (now: number): boolean => Math.abs(now - startedAt) < 2 * 60_000;
  return {
    clock: (now) => base.clock(isWallRead(now) ? wallInstant : now),
    etDate: (now) => (isWallRead(now) ? wallDate : base.etDate(now)),
    tradingDaysBetween: (from, to) => base.tradingDaysBetween(from, to),
  };
}

async function waitForDone(sim: { get(id: string): SimRun | undefined }, id: string): Promise<SimRun> {
  const start = Date.now();
  for (;;) {
    const run = sim.get(id);
    if (run === undefined) throw new Error(`run ${id} vanished`);
    if (run.status === "done" || run.status === "failed" || run.status === "stopped") return run;
    if (Date.now() - start > 30_000) throw new Error(`timed out waiting for ${id} (${run.status})`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("queued suite siblings retain the same base risk limits even if settings change mid-suite", async () => {
  const dataDir = mkdtempSync("/tmp/sim-suite-settings-");
  const bus = createEventBus();
  const now = () => Date.parse("2026-10-23T16:00:00Z");
  const baseSettings = structuredClone(DEFAULT_SETTINGS);
  baseSettings.watchlist = ["SPY"];
  baseSettings.risk.maxEntriesPerDay = 1;
  const sim = createSimService({
    config: { ...loadConfig(), DATA_DIR: dataDir, SIM_CONCURRENCY: 1 }, log, bus, market, skills,
    calendar: createNyseCalendar(), wallNow: now, settings: () => baseSettings,
    fetchBars: async (symbol, from, to) => fixtureBars(symbol, from, to).map((bar) => ({
      ...bar, open: 100, high: 100, low: 100, close: 100, volume: 10_000_000,
    })),
    sectorSource: createStaticSectorDirectory({}),
    driver: async (run, ctx) => {
      if (ctx.kind !== "intraday" || run.progress.day !== 1 || run.progress.cycle !== 1) return;
      if (run.variant === "A") baseSettings.risk.maxEntriesPerDay = 0;
      const price = (await ctx.bars(ctx.benchmark))[0]!.close; // Synthetic tape is flat.
      const review = new Date(etInstant(run.currentDate!, 12) + 30 * 86_400_000).toISOString().slice(0, 10);
      await ctx.submit({
        symbol: ctx.benchmark, side: "buy", quantity: 0.5, orderType: "limit", limitPrice: price * 1.0009,
        timeInForce: "day", invalidationPrice: price * 0.9, timeStopDate: review,
        thesis: "A model-free paper gate fixture.", probabilityWin: 0.7, expectedGainPct: 20,
        expectedLossPct: 10, estimatedCostPct: 0.2, evidence: ["synthetic paper market"],
      });
    },
  });
  const suites = createSuiteService({ runner: sim, bus, log, dataDir, now });
  try {
    const suite = await suites.start({
      name: "Same settings for both runs", bootstrapRuns: 1, bootstrapDays: 5,
      startingCash: 1200, execution: "ideal", variants: [{ label: "A" }, { label: "B" }],
    }, "user");
    const results = await Promise.all(suite.runs.map((run) => waitForDone(sim, run.runId)));
    assert.deepEqual(results.map((run) => run.status), ["done", "done"]);
    assert.equal(suites.get(suite.id)?.comparison?.pairs, 1, "the scenario is identical");
    const entries = suite.runs.map(({ runId }) => sim.orders(runId)[0]?.verdict.checks.find((check) => check.rule === "entries_per_day")?.ok);
    assert.deepEqual(entries, [true, true], "B must not inherit the mid-suite limit of zero");
    assert.deepEqual(results.map((run) => run.fills.length), [1, 1], JSON.stringify(suite.runs.map(({ runId }) =>
      sim.orders(runId)[0]?.verdict.checks.filter((check) => !check.ok))));
    assert.equal(baseSettings.risk.maxEntriesPerDay, 0, "the change is external to the paper runs");

    const fresh = await suites.start({
      name: "New settings, explicit override", bootstrapRuns: 1, bootstrapDays: 5, startingCash: 1200, execution: "ideal",
      variants: [{ label: "Baseline" }, { label: "Explicit override", risk: { maxEntriesPerDay: 1 } }],
    }, "user");
    const freshResults = await Promise.all(fresh.runs.map((run) => waitForDone(sim, run.runId)));
    assert.deepEqual(freshResults.map((run) => run.status), ["done", "done"]);
    assert.deepEqual(freshResults.map((run) => run.fills.length), [0, 1]);
    assert.deepEqual(fresh.runs.map(({ runId }) => sim.orders(runId)[0]?.verdict.checks.find((check) => check.rule === "entries_per_day")?.ok), [false, true]);
  } finally {
    suites.close();
    await sim.close();
    const suiteDir = join(dataDir, "sim", "suites");
    for (const filename of readdirSync(suiteDir)) unlinkSync(join(suiteDir, filename));
    rmdirSync(suiteDir);
    cleanReplayCoverageFixture(dataDir, sim);
  }
});

test("a missing scored cycle stops replay before the close, but analysis is best effort", async () => {
  for (const outcome of ["timeout", "unanswered", "post-close-timeout"] as const) {
    const dataDir = mkdtempSync("/tmp/sim-cycle-outcome-");
    const cycles: string[] = [];
    const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills,
      calendar: createNyseCalendar(),
      fetchBars: async (s, f, t) => fixtureBars(s, f, t),
      driver: async (_run, ctx) => {
        cycles.push(ctx.kind);
        return outcome === "post-close-timeout" ? (ctx.kind === "post_close" ? "timeout" : undefined) : outcome;
      } });
    try {
      const run = await sim.start({ startDate: "2026-09-01", days: 1, startingCash: 1200, cyclesPerDay: 2 }, "user");
      const result = await waitForDone(sim, run.id);
      if (outcome === "post-close-timeout") {
        assert.equal(result.status, "done");
        assert.deepEqual(cycles, ["intraday", "intraday", "post_close"]);
        assert.deepEqual(result.equity.map((point) => point.date), ["2026-09-01"]);
      } else {
        assert.equal(result.status, "failed");
        assert.match(result.error ?? "", new RegExp(`intraday.*2026-09-01.*${outcome}`));
        assert.deepEqual(cycles, ["intraday"]);
        assert.deepEqual(result.equity, []);
        assert.ok(result.metrics, "partial diagnostics must remain available");
      }
    } finally {
      await sim.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
});

test("a fractional protective stop exits on the first simulated quote after a gap below its limit", async () => {
  const dataDir = mkdtempSync("/tmp/sim-held-stop-");
  const dates = ["2026-07-02", "2026-07-06", "2026-07-07"];
  const bars = dates.map((date, i) => {
    const price = i < 2 ? 100 : 90;
    return { date, open: price, high: price, low: price, close: price, volume: 10_000_000 };
  });
  const entry: OrderIntent = {
    symbol: "SPY", side: "buy", quantity: 0.5, orderType: "limit", limitPrice: 100.05, timeInForce: "day",
    invalidationPrice: 95, timeStopDate: "2026-07-20", thesis: "Replay fixture for a protective gap exit.",
    probabilityWin: 0.6, expectedGainPct: 10, expectedLossPct: 5, estimatedCostPct: 0.1, evidence: ["fixture quote"],
  };
  let paper: PaperBroker;
  let protectionId: string | undefined;
  const sim = createSimService({
    config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills, calendar: createNyseCalendar(),
    fetchBars: async () => bars,
    buildExtensions: ({ broker }) => { paper = broker; return []; },
    driver: async (run, ctx) => {
      if (ctx.kind !== "intraday" || run.progress.day !== 1) return;
      if (run.progress.cycle === 1) {
        const db = new DatabaseSync(join(dataDir, "sim", run.id, "app.sqlite"), { readOnly: true });
        try {
          assert.equal(db.prepare("SELECT day_start FROM equity_marks WHERE et_date = ?").get(dates[1]!)?.day_start, 1200,
            "a model-free cycle must have the same starting equity mark as an agent cycle");
        } finally {
          db.close();
        }
        const order = await paper.placeOrder(entry);
        assert.equal((await paper.orderState(order.brokerOrderId)).status, "submitted");
        assert.deepEqual(paper.fills(), []);
        assert.deepEqual((await paper.snapshot()).positions, []);
        return;
      }
      assert.equal(paper.fills()[0]?.at, etInstant(dates[1]!, 10, 16));
      const stop = await ctx.submit({ ...entry, side: "sell", orderType: "stop_limit", stopPrice: 95, limitPrice: 94.5, timeInForce: "gtc" });
      assert.equal(stop.status, "held");
      assert.equal(paper.orders().length, 1, "protection must not rest as a venue order");
      protectionId = stop.id;
    },
  });
  try {
    const run = await sim.start({ startDate: dates[1]!, days: 2, startingCash: 1200, cyclesPerDay: 2, execution: "realistic" }, "user");
    const result = await waitForDone(sim, run.id);
    assert.equal(result.status, "done", result.error ?? "paper replay did not finish");
    assert.deepEqual(result.positions, []);
    const sells = result.fills.filter((f) => f.side === "sell");
    assert.equal(sells.length, 1);
    assert.equal(sells[0]!.quantity, 0.5);
    assert.equal(sells[0]!.at, etInstant(dates[2]!, 9, 30));
    assert.ok(sells[0]!.price < 90 && sells[0]!.price > 89);
    assert.equal(sim.orders(run.id).find((o) => o.id === protectionId)?.status, "filled");
  } finally {
    await sim.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("historical admission requires earnings coverage unless explicitly omitted for the paper run", async (t) => {
  const dataDir = mkdtempSync("/tmp/sim-earnings-coverage-");
  const date = "2026-09-01";
  const bars = fixtureBars("AAPL", "2026-07-01", date).map((bar) => ({
    ...bar, open: 100, high: 100, low: 100, close: 100, volume: 10_000_000,
  }));
  const lookups: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: URL | Request | string) => {
    const url = String(input);
    lookups.push(url);
    return new URL(url).pathname.endsWith("/historical")
      ? Response.json({ data: { tradesTable: { rows: bars } } })
      : Response.json({ data: { rows: [] } });
  });
  const entry: OrderIntent = {
    symbol: "AAPL", side: "buy", quantity: 0.5, orderType: "limit", limitPrice: 100.05, timeInForce: "day",
    invalidationPrice: 95, timeStopDate: "2026-09-21", thesis: "Replay fixture for point-in-time earnings admission.",
    probabilityWin: 0.7, expectedGainPct: 12, expectedLossPct: 5, estimatedCostPct: 0.1, evidence: ["fixture quote"],
  };
  const sim = createSimService({
    config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills, calendar: createNyseCalendar(),
    fetchBars: async () => bars,
    driver: async (run, ctx) => {
      if (ctx.kind === "intraday" && run.progress.cycle === 1) await ctx.submit(entry);
    },
  });
  try {
    for (const omitBlackout of [false, true]) {
      const run = await sim.start({ startDate: date, days: 1, startingCash: 1200, cyclesPerDay: 2,
        watchlist: ["AAPL"], execution: "realistic",
        ...(omitBlackout ? { risk: { earningsBlackoutDays: 0 } } : {}) }, "user");
      const result = await waitForDone(sim, run.id);
      assert.equal(result.status, "done", result.error ?? "paper replay did not finish");
      const [order] = sim.orders(run.id);
      assert.ok(order);
      const failures = order.verdict?.checks.filter((check) => !check.ok);
      assert.deepEqual(failures?.map((check) => check.rule), omitBlackout ? [] : ["earnings_blackout"]);
      if (!omitBlackout) assert.match(failures?.[0]?.detail ?? "", /point-in-time earnings schedule unavailable/);
      assert.equal(result.fills.length, omitBlackout ? 1 : 0);
    }
    assert.ok(lookups.length > 0, "volume was not exercised");
    assert.ok(lookups.every((url) => new URL(url).pathname.endsWith("/historical")), lookups.join("\n"));
  } finally {
    await sim.close();
    cleanReplayCoverageFixture(dataDir, sim);
  }
});

test("a historical early-close paper session stops cycles at the 13:00 close", async () => {
  const dataDir = mkdtempSync("/tmp/sim-early-close-");
  const date = "2026-12-24";
  const cycles: { kind: CycleKind; at: number; asOf: string }[] = [];
  let paper: PaperBroker | undefined;
  const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills,
    calendar: futureSessionCalendar("2026-12-31"),
    fetchBars: async (s, f, t) => fixtureBars(s, f, t),
    buildExtensions: ({ broker }) => { paper = broker; return []; },
    driver: async (_run, ctx) => {
      assert.ok(paper !== undefined);
      const quote = await paper.quote(ctx.symbols[0]!);
      cycles.push({ kind: ctx.kind, at: quote.at, asOf: ctx.asOf() });
    } });
  try {
    const run = await sim.start({ startDate: date, days: 1, startingCash: 1200, cyclesPerDay: 4 }, "user");
    const done = await waitForDone(sim, run.id);
    assert.equal(done.status, "done", done.error ?? "early-close replay did not finish");
    assert.deepEqual(cycles.map((cycle) => cycle.kind), ["pre_open", "intraday", "intraday", "intraday", "post_close"]);
    assert.deepEqual(cycles.map((cycle) => cycle.at),
      [etInstant(date, 9), etInstant(date, 10, 15), etInstant(date, 11, 30), etInstant(date, 12, 30), etInstant(date, 13, 10)]);
    assert.deepEqual(cycles.map((cycle) => cycle.asOf), ["2026-12-23", "2026-12-23", "2026-12-23", "2026-12-23", date]);
    assert.deepEqual(done.equity.map((point) => point.date), [date]);
  } finally {
    await sim.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

function cleanReplayCoverageFixture(dataDir: string, sim: ReturnType<typeof createSimService>): void {
  const root = join(dataDir, "sim");
  for (const run of sim.list()) {
    const runDir = join(root, run.id);
    for (const name of ["run.json", "journal.json", "orders.json", "app.sqlite", "app.sqlite-wal", "app.sqlite-shm", "market-fingerprint.json"]) {
      const path = join(runDir, name);
      if (existsSync(path)) unlinkSync(path);
    }
    const workspace = join(runDir, "workspace");
    const readme = join(workspace, "README.md");
    if (existsSync(readme)) unlinkSync(readme);
    if (existsSync(workspace)) rmdirSync(workspace);
    const cache = join(runDir, "cache");
    const marketCache = join(cache, "market");
    if (existsSync(marketCache)) {
      for (const entry of readdirSync(marketCache)) unlinkSync(join(marketCache, entry));
      rmdirSync(marketCache);
      rmdirSync(cache);
    }
    rmdirSync(runDir);
  }
  rmdirSync(root);
  rmdirSync(dataDir);
}

/** Regular NYSE sessions in [from, to]; weekends and holidays come from the exchange calendar. */
function regularSessionDates(from: string, to: string): string[] {
  const calendar = createNyseCalendar();
  const dates: string[] = [];
  for (let at = Date.parse(`${from}T12:00:00Z`); ; at += 86_400_000) {
    const date = new Date(at).toISOString().slice(0, 10);
    if (date > to) break;
    if (calendar.clock(etInstant(date, 12)).tradingDay === date) dates.push(date);
  }
  return dates;
}

test("historical execution warmup quotes from the full 20-session average dollar volume", async () => {
  const dataDir = mkdtempSync("/tmp/sim-execution-warmup-");
  const tradeDate = "2026-09-01";
  const sessions = regularSessionDates("2026-07-01", "2026-10-30");
  const tradeIndex = sessions.indexOf(tradeDate);
  assert.ok(tradeIndex >= 20, "the fixture needs 20 regular sessions before the trade date");
  const fetchedSymbols = new Set<string>();
  // Flat $100 bars: the latest 10 prior sessions trade 1M shares, the 10 before
  // them 4M, so the 20-session average dollar volume is $250M (5 bp half-spread)
  // while a window truncated to the latest 10 sees only $100M (15 bp).
  const barsFor = (symbol: string, from: string, to: string): Bar[] => {
    fetchedSymbols.add(symbol);
    assert.ok(symbol === "SPY" || symbol === "AAPL", `unexpected history request for ${symbol}`);
    return sessions.filter((date) => date >= from && date <= to).map((date) => {
      const prior = tradeIndex - sessions.indexOf(date);
      const volume = prior >= 11 && prior <= 20 ? 4_000_000 : 1_000_000;
      return { date, open: 100, high: 100, low: 100, close: 100, volume };
    });
  };
  let paper: PaperBroker | undefined;
  const quotes: { symbol: string; at: number; last: number; ask: number }[] = [];
  const sim = createSimService({
    config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills, calendar: createNyseCalendar(),
    fetchBars: async (symbol, from, to) => barsFor(symbol, from, to),
    buildExtensions: ({ broker }) => { paper = broker; return []; },
    driver: async (run, ctx) => {
      if (ctx.kind !== "intraday" || run.progress.cycle !== 1) return;
      for (const symbol of ["SPY", ...ctx.symbols]) {
        const quote = await paper!.quote(symbol);
        quotes.push({ symbol, at: quote.at, last: quote.last, ask: quote.ask });
      }
    },
  });
  try {
    const run = await sim.start({ startDate: tradeDate, days: 1, startingCash: 1200, cyclesPerDay: 2,
      watchlist: ["AAPL"], execution: "realistic" }, "user");
    const done = await waitForDone(sim, run.id);
    assert.equal(done.status, "done", done.error ?? "execution warmup replay did not finish");
    assert.deepEqual(done.equity.map((point) => point.date), [tradeDate]);
    assert.deepEqual([...fetchedSymbols].sort(), ["AAPL", "SPY"], "every symbol must source history from the deterministic fixture");
    assert.deepEqual(quotes.map((quote) => quote.symbol), ["SPY", "AAPL"]);
    for (const quote of quotes) {
      assert.equal(quote.at, etInstant(tradeDate, 10, 15));
      assert.equal(quote.last, 100);
      assert.equal(quote.ask, 100.05,
        `${quote.symbol} ask must use the 20-session $250M average dollar volume, not the truncated 10-session $100M`);
    }
    assert.deepEqual(sim.orders(run.id), [], "measuring execution quotes must not submit an order");
    assert.deepEqual(done.fills, []);
  } finally {
    await sim.close();
    cleanReplayCoverageFixture(dataDir, sim);
  }
});

test("missing SPY history rejects a historical replay instead of shifting to the next session", async () => {
  const dataDir = mkdtempSync("/tmp/sim-missing-spy-history-");
  const missing = "2026-04-20"; // Monday after Friday 2026-04-17; a regular NYSE session.
  let cycles = 0;
  const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills,
    calendar: createNyseCalendar(),
    fetchBars: async (symbol, from, to) => {
      const bars = fixtureBars(symbol, from, to);
      return symbol === "SPY" ? bars.filter((bar) => bar.date !== missing) : bars;
    },
    driver: async () => { cycles++; } });
  try {
    assert.ok(fixtureBars("AAA", missing, missing).some((bar) => bar.date === missing),
      "another symbol must keep a bar for the session SPY omits");
    await assert.rejects(
      sim.start({ startDate: "2026-04-17", days: 2, startingCash: 1200, cyclesPerDay: 2 }, "user"),
      /Missing SPY bar for scheduled replay session 2026-04-20/);
    assert.equal(cycles, 0, "the replay must not reach a driver cycle with a skipped session");
    assert.deepEqual(sim.list(), [], "a rejected preflight must not create a run");
  } finally {
    await sim.close();
    cleanReplayCoverageFixture(dataDir, sim);
  }
});

test("a replay refuses a missing SPY session that appears only after preflight", async () => {
  const dataDir = mkdtempSync("/tmp/sim-tape-changed-");
  let fetches = 0;
  const sim = createSimService({
    config: { ...loadConfig(), DATA_DIR: dataDir },
    log, bus: createEventBus(), market, skills, calendar: createNyseCalendar(),
    fetchBars: async (symbol, from, to) => {
      assert.equal(symbol, "SPY");
      const bars = fixtureBars(symbol, from, to);
      return ++fetches === 1 ? bars : bars.filter((bar) => bar.date !== "2026-04-20");
    },
    driver: async () => { assert.fail("must not execute a scored cycle"); },
  });
  try {
    const run = await sim.start({ startDate: "2026-04-17", days: 2, startingCash: 1200, cyclesPerDay: 2 }, "user");
    const result = await waitForDone(sim, run.id);
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /Missing SPY bar for scheduled replay session 2026-04-20/);
    assert.deepEqual(result.equity, []);
    assert.deepEqual(result.fills, []);
    assert.equal(existsSync(join(dataDir, "sim", run.id, "app.sqlite")), false);
  } finally {
    await sim.close();
    cleanReplayCoverageFixture(dataDir, sim);
  }
});

test("missing SPY history rejects a blind replay whose source window skips the session", async () => {
  const dataDir = mkdtempSync("/tmp/sim-missing-spy-blind-");
  const missing = "2026-04-20";
  let cycles = 0;
  const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills,
    calendar: createNyseCalendar(),
    fetchBars: async (symbol, from, to) => {
      const bars = fixtureBars(symbol, from, to);
      return symbol === "SPY" ? bars.filter((bar) => bar.date !== missing) : bars;
    },
    driver: async () => { cycles++; },
    sectorSource: createStaticSectorDirectory({}) });
  try {
    await assert.rejects(
      sim.start({ mode: "blind", startDate: "2026-04-17", days: 2, startingCash: 1200,
        cyclesPerDay: 2, watchlist: ["AAA"] }, "user"),
      /Missing SPY bar for scheduled replay session 2026-04-20/);
    assert.equal(cycles, 0, "the blind build must not start a shifted replay");
    assert.deepEqual(sim.list(), [], "a rejected preflight must not create a run");
  } finally {
    await sim.close();
    cleanReplayCoverageFixture(dataDir, sim);
  }
});

test("a known exchange closure without a bar is not a missing replay session", async () => {
  const dataDir = mkdtempSync("/tmp/sim-closure-gap-");
  const closure = "2026-04-03"; // Good Friday: the exchange is closed, so source bars omit it.
  const cycles: { date: string | undefined; kind: CycleKind }[] = [];
  const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills,
    calendar: createNyseCalendar(),
    fetchBars: async (symbol, from, to) => fixtureBars(symbol, from, to).filter((bar) => bar.date !== closure),
    driver: async (run, ctx) => { cycles.push({ date: run.currentDate, kind: ctx.kind }); } });
  try {
    const run = await sim.start({ startDate: "2026-04-01", days: 3, startingCash: 1200, cyclesPerDay: 2 }, "user");
    const done = await waitForDone(sim, run.id);
    assert.equal(done.status, "done", done.error ?? "closure replay did not finish");
    assert.deepEqual(done.equity.map((point) => point.date), ["2026-04-01", "2026-04-02", "2026-04-06"],
      "the replay must span the closure rather than treat it as a session");
    assert.deepEqual([...new Set(cycles.map((cycle) => cycle.date))], ["2026-04-01", "2026-04-02", "2026-04-06"]);
  } finally {
    await sim.close();
    cleanReplayCoverageFixture(dataDir, sim);
  }
});

test("resolves scenario config and records seed, suite, variant, and aliases", async () => {
  const dataDir = mkdtempSync("/tmp/sim-scenario-test-");
  const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills,
    calendar: createNyseCalendar(),
    fetchBars: async (s, f, t) => fixtureBars(s, f, t),
    driver: async () => {},
    sectorSource: createStaticSectorDirectory({}) });
  try {
    await assert.rejects(sim.start({ scenario: "no-such-regime", startingCash: 1200, cyclesPerDay: 2 } as unknown as SimRunConfigInput, "user"), /Unknown scenario/);
    const run = await sim.start({ scenario: "covid-crash-2020", mode: "blind", startingCash: 1200, cyclesPerDay: 2 } as unknown as SimRunConfigInput, "user", { suiteId: "s1", variant: "A" });
    assert.equal(run.config.startDate, "2020-02-03");
    assert.equal(run.config.days, 40);
    assert.equal(typeof run.seed, "number");
    assert.equal(run.suiteId, "s1");
    assert.equal(run.variant, "A");
    const done = await waitForDone(sim, run.id);
    assert.equal(done.status, "done");
    assert.equal(done.aliases?.["MKT"], "SPY");
    assert.equal(done.calendar?.sourceStart, "2020-02-03");
    assert.ok(done.aliases !== undefined && Object.keys(done.aliases).length >= 13);
  } finally {
    await sim.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("starts a bootstrap run without a start date", async () => {
  const dataDir = mkdtempSync("/tmp/sim-bootstrap-test-");
  const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills,
    calendar: createNyseCalendar(),
    fetchBars: async (s, f, t) => fixtureBars(s, f, t),
    driver: async () => {},
    sectorSource: createStaticSectorDirectory({}) });
  try {
    const run = await sim.start({ mode: "bootstrap", days: 5, seed: 7, startingCash: 1200, cyclesPerDay: 2 }, "user", { suiteId: "s1", variant: "A" });
    assert.equal(run.config.startDate, undefined);
    const done = await waitForDone(sim, run.id);
    assert.equal(done.status, "done", done.error ?? "");
    assert.equal(done.aliases?.["MKT"], "SPY");
  } finally {
    await sim.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("suite bootstrap runs share one source cutoff when a queued run executes on a later ET date", async () => {
  const dataDir = mkdtempSync("/tmp/sim-suite-cutoff-");
  const suiteCreatedAt = etInstant("2026-11-19", 9);
  let wallNow = etInstant("2026-11-19", 12);
  const fetches: { symbol: string; from: string; to: string; bars: Bar[] }[] = [];
  const fullBenchmark = new Map<string, Bar[]>();
  let firstRunFetches = -1;
  const sim = createSimService({
    config: { ...loadConfig(), DATA_DIR: dataDir, SIM_CONCURRENCY: 1 }, log, bus: createEventBus(), market, skills,
    calendar: createNyseCalendar(),
    // Production reads the wall clock for the transport end date and start
    // eligibility; the test pins both runs to a suite created on Nov 19.
    wallNow: () => wallNow,
    fetchBars: async (symbol, from, to) => {
      const bars = fixtureBars(symbol, from, to);
      fetches.push({ symbol, from, to, bars });
      return bars;
    },
    sectorSource: createStaticSectorDirectory({}),
    driver: async (run, ctx) => {
      if (run.progress.day !== 1 || run.progress.cycle !== 1) return;
      fullBenchmark.set(run.variant ?? run.id, await ctx.bars(ctx.benchmark));
      if (run.variant === "A") {
        // The build already used Nov 19. Moving the manual clock here makes the
        // still-queued B execute on Nov 20 while sharing the suite snapshot.
        firstRunFetches = fetches.length;
        wallNow = etInstant("2026-11-20", 12);
      }
    },
  });
  try {
    const config = { mode: "bootstrap" as const, days: 3, seed: 7, startingCash: 1200, cyclesPerDay: 2 as const, watchlist: ["AAA"] };
    const options = { suiteId: "suite-pinned", suiteCreatedAt };
    const a = await sim.start({ ...config, name: "Cutoff A" }, "user", { ...options, variant: "A" });
    const b = await sim.start({ ...config, name: "Cutoff B" }, "user", { ...options, variant: "B" });
    assert.equal(sim.get(b.id)?.status, "queued", "the second run must wait for the single concurrency slot");
    const doneA = await waitForDone(sim, a.id);
    const doneB = await waitForDone(sim, b.id);
    assert.equal(doneA.status, "done", doneA.error ?? "the first suite bootstrap run did not finish");
    assert.equal(doneB.status, "done", doneB.error ?? "the queued suite bootstrap run did not finish");
    assert.ok(firstRunFetches > 0, "the first run must have fetched before the queued run started");
    const aFetches = fetches.slice(0, firstRunFetches);
    const bFetches = fetches.slice(firstRunFetches);
    assert.deepEqual([...new Set(aFetches.map((entry) => entry.symbol))].sort(),
      [...new Set(bFetches.map((entry) => entry.symbol))].sort());
    assert.ok(aFetches.every((entry) => entry.to === "2026-11-19"), "the first run transports through its own ET date");
    assert.ok(bFetches.every((entry) => entry.to === "2026-11-20"), "the queued run still transports through the real execution day");
    assert.ok([...aFetches, ...bFetches].every((entry) => entry.from === "2016-10-24"));
    const aSpy = aFetches.find((entry) => entry.symbol === "SPY")!;
    const bSpy = bFetches.find((entry) => entry.symbol === "SPY")!;
    assert.ok(aSpy.bars.some((bar) => bar.date === "2026-11-19"), "Nov 19 is in the first run's transport window");
    assert.ok(bSpy.bars.some((bar) => bar.date === "2026-11-20"), "Nov 20 is in the queued run's transport window");
    const aBenchmark = fullBenchmark.get("A");
    const bBenchmark = fullBenchmark.get("B");
    assert.ok(aBenchmark !== undefined && bBenchmark !== undefined);
    assert.deepEqual(bBenchmark, aBenchmark,
      "a queued run must rebuild the suite's Nov 18 eligible snapshot rather than sampling the extra execution day");
    assert.deepEqual(doneB.calendar, doneA.calendar, "the shared snapshot produces the same synthetic calendar");
    assert.deepEqual(doneB.aliases, doneA.aliases, "the shared snapshot produces the same alias map");
    assert.deepEqual(doneB.equity.map((point) => point.benchmark), doneA.equity.map((point) => point.benchmark));
    const aFingerprint = sim.marketFingerprint(a.id);
    const bFingerprint = sim.marketFingerprint(b.id);
    assert.ok(aFingerprint !== undefined, "the first suite run must persist an internal market marker");
    assert.ok(bFingerprint !== undefined, "the queued suite run must persist an internal market marker");
    assert.match(aFingerprint, /^scenario-v1:[0-9a-f]{64}$/);
    assert.equal(bFingerprint, aFingerprint,
      "both runs must hash the same pinned market snapshot despite their different transport dates");
    assert.equal(JSON.parse(readFileSync(join(dataDir, "sim", a.id, "market-fingerprint.json"), "utf8")), aFingerprint);
    assert.equal(JSON.parse(readFileSync(join(dataDir, "sim", b.id, "market-fingerprint.json"), "utf8")), bFingerprint);
  } finally {
    await sim.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("agent-started runs block each other but suite runs do not count", async () => {
  const dataDir = mkdtempSync("/tmp/sim-agent-test-");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills,
    calendar: createNyseCalendar(),
    fetchBars: async (s, f, t) => fixtureBars(s, f, t),
    driver: async () => { await gate; },
    sectorSource: createStaticSectorDirectory({}) });
  try {
    const base = { startDate: "2026-09-01", days: 1, startingCash: 1200, cyclesPerDay: 2 as const };
    const first = await sim.start(base, "agent");
    await assert.rejects(sim.start(base, "agent"), /already active/);
    const suiteRun = await sim.start(base, "agent", { suiteId: "suite-1", variant: "A" });
    assert.equal(suiteRun.suiteId, "suite-1");
    release();
    assert.equal((await waitForDone(sim, first.id)).status, "done");
    assert.equal((await waitForDone(sim, suiteRun.id)).status, "done");
  } finally {
    release();
    await sim.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("the pool runs at most SIM_CONCURRENCY runs at once", async () => {
  const dataDir = mkdtempSync("/tmp/sim-pool-test-");
  let current = 0;
  let max = 0;
  const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir, SIM_CONCURRENCY: 1 }, log, bus: createEventBus(),
    market, skills, calendar: createNyseCalendar(),
    fetchBars: async (s, f, t) => fixtureBars(s, f, t),
    driver: async () => { current++; max = Math.max(max, current); await new Promise((r) => setTimeout(r, 50)); current--; },
    sectorSource: createStaticSectorDirectory({}) });
  try {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await sim.start({ startDate: "2026-09-01", days: 1, startingCash: 1200, cyclesPerDay: 2 }, "user")).id);
    }
    for (const id of ids) assert.equal((await waitForDone(sim, id)).status, "done");
    assert.equal(max, 1);
  } finally {
    await sim.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("blind history never reaches the current simulated day", async () => {
  const dataDir = mkdtempSync("/tmp/sim-lookahead-test-");
  const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills,
    calendar: createNyseCalendar(),
    fetchBars: async (s, f, t) => fixtureBars(s, f, t),
    driver: async (run: SimRun, ctx: SimDriverContext) => {
      const cutoff = ctx.asOf();
      assert.ok(cutoff <= run.currentDate!, `asOf ${cutoff} beyond ${run.currentDate}`);
      if (ctx.kind !== "post_close") assert.ok(cutoff < run.currentDate!, `asOf ${cutoff} reached ${run.currentDate}`);
      for (const symbol of ctx.symbols) {
        const history = await ctx.market.history(symbol, "5y");
        assert.ok(history.bars.every((b) => b.date <= cutoff), `${symbol} leaked past ${cutoff}`);
      }
      assert.equal(await ctx.market.nextEarnings(ctx.symbols[0]!), undefined);
    },
    sectorSource: createStaticSectorDirectory({}) });
  try {
    const run = await sim.start({ mode: "blind", startDate: "2020-03-02", days: 2, startingCash: 1200,
      cyclesPerDay: 2, watchlist: ["AAA"] }, "user");
    const done = await waitForDone(sim, run.id);
    assert.equal(done.status, "done");
  } finally {
    await sim.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("SIM_CONCURRENCY clamps to 1..4 and defaults to 2", () => {
  assert.equal(loadConfig({}).SIM_CONCURRENCY, 2);
  assert.equal(loadConfig({ SIM_CONCURRENCY: "3" }).SIM_CONCURRENCY, 3);
  assert.equal(loadConfig({ SIM_CONCURRENCY: "99" }).SIM_CONCURRENCY, 2);
  assert.equal(loadConfig({ SIM_CONCURRENCY: "0" }).SIM_CONCURRENCY, 2);
  assert.equal(loadConfig({ SIM_CONCURRENCY: "nope" }).SIM_CONCURRENCY, 2);
});

test("pricesOnly registers three tools reading the injected market", async () => {
  const dataDir = mkdtempSync("/tmp/sim-prices-test-");
  try {
    const bars = fixtureBars("AAA", "2024-01-01", "2026-10-23");
    const stub: MarketData = {
      history: async (symbol, range) => ({ symbol, bars: range === "5y" ? bars : bars.slice(-21), source: "stub", asOf: 0 }),
      nextEarnings: async () => { throw new Error("must not be called"); },
      avgDollarVolume: async () => 1,
    };
    const ext = createMarketExtension({ market: stub, dataDir, log, clock: { now: () => Date.now() },
      asOf: () => "2026-10-23", pricesOnly: true });
    assert.deepEqual(ext.tools?.map((t) => t.name).sort(), ["market_compare", "market_indicators", "market_price_history"]);
    const indicators = ext.tools?.find((t) => t.name === "market_indicators");
    assert.ok(indicators);
    const result = await indicators.execute({ symbol: "AAA", range: "1m" }, {} as never, {} as never) as {
      structuredOutput: { close: number | null };
    };
    assert.equal(result.structuredOutput.close, bars.at(-1)!.close);
    const full = createMarketExtension({ market: stub, dataDir, log, clock: { now: () => Date.now() } });
    assert.equal(full.tools?.length, 9);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
