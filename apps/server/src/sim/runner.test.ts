import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import type { Bar, SimRun, SimRunConfigInput } from "@rh/shared";
import { createSimService, type SimDriverContext } from "./runner.ts";
import { createStaticSectorDirectory } from "./scenario-market.ts";
import { createMarketExtension } from "../market/tools.ts";
import { mountSimRoutes } from "../http/sim-routes.ts";
import { createEventBus } from "../events.ts";
import { createNyseCalendar } from "../risk/calendar.ts";
import { loadConfig } from "../config.ts";
import type { Logger, MarketData, SkillLibrary } from "../ports.ts";

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
