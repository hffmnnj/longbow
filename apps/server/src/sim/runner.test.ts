import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmdirSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { DEFAULT_SETTINGS } from "@rh/shared";
import type { AccountSnapshot, Bar, CycleKind, OrderIntent, SimRun, SimRunConfigInput } from "@rh/shared";
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
    const firstClose = result.equity[0]!;
    // 0.5 × $100 held at the first close; the proxy carries that exposure into the next session's 10% gap.
    const expectedProxy = -10 * 50 / firstClose.equity;
    const saved = JSON.parse(readFileSync(join(dataDir, "sim", run.id, "run.json"), "utf8")) as SimRun;
    assert.ok(Math.abs((saved.metrics?.priorCloseExposureBenchmarkReturnPct ?? NaN) - expectedProxy) < 1e-9);
  } finally {
    await sim.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a historical paper replay credits a cash dividend on its ex-date and settles it on the pay date", async () => {
  const dataDir = mkdtempSync("/tmp/sim-dividend-");
  const priorDay = "2026-07-06";
  const exDate = "2026-07-07";
  const payDate = "2026-07-08";
  const symbol = "AAPL";
  const perShare = 2;
  const priorQuantity = 0.5;
  const exDateQuantity = 0.25;
  // Flat $100 sessions keep every mark unchanged, so each account difference
  // below is the dividend, a fill, or the pay-date settlement release.
  const flat: Bar[] = [];
  for (let at = Date.parse("2026-06-01T12:00:00Z"); at <= Date.parse("2026-07-10T12:00:00Z"); at += 86_400_000) {
    const date = new Date(at).toISOString().slice(0, 10);
    if (new Date(at).getUTCDay() % 6 === 0) continue;
    flat.push({ date, open: 100, high: 100, low: 100, close: 100, volume: 10_000_000 });
  }
  const buy = (quantity: number): OrderIntent => ({
    symbol, side: "buy", quantity, orderType: "limit", limitPrice: 100.05, timeInForce: "day",
    invalidationPrice: 95, timeStopDate: "2026-08-05", thesis: "Replay fixture for historical cash dividends.",
    probabilityWin: 0.7, expectedGainPct: 20, expectedLossPct: 10, estimatedCostPct: 0.2, evidence: ["synthetic paper market"],
  });
  const near = (actual: number, expected: number, label: string): void => {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
  };
  const accounts = new Map<string, AccountSnapshot>();
  const dividendDates: string[] = [];
  let paper: PaperBroker | undefined;
  const sim = createSimService({
    config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills,
    calendar: createNyseCalendar(),
    fetchBars: async () => flat,
    cashDividends: (date) => {
      dividendDates.push(date);
      return date === exDate ? [{ symbol, amountPerShare: perShare, payDate }] : [];
    },
    buildExtensions: ({ broker }) => { paper = broker; return []; },
    driver: async (run, ctx) => {
      assert.ok(paper !== undefined);
      if (run.progress.day === 1 && ctx.kind === "intraday" && run.progress.cycle === 2) {
        await ctx.submit(buy(priorQuantity));
        assert.deepEqual(paper.fills().map((fill) => [fill.side, fill.date]), [["buy", priorDay]]);
        return;
      }
      if (run.progress.day === 1 && ctx.kind === "intraday" && run.progress.cycle === 3) {
        accounts.set("priorClose", await paper.snapshot());
        return;
      }
      if (run.progress.day === 2 && ctx.kind === "pre_open") {
        accounts.set("exDatePreOpen", await paper.snapshot());
        return;
      }
      if (run.progress.day === 2 && ctx.kind === "intraday" && run.progress.cycle === 2) {
        accounts.set("exDate", await paper.snapshot());
        await ctx.submit(buy(exDateQuantity));
        accounts.set("exDateAfterBuy", await paper.snapshot());
        return;
      }
      if (run.progress.day === 3 && ctx.kind === "intraday" && run.progress.cycle === 2) accounts.set("payDate", await paper.snapshot());
    },
  });
  try {
    const run = await sim.start({ startDate: priorDay, days: 3, startingCash: 1200, cyclesPerDay: 3,
      watchlist: [symbol], execution: "ideal", risk: { earningsBlackoutDays: 0 } }, "user");
    const done = await waitForDone(sim, run.id);
    assert.equal(done.status, "done", done.error ?? "dividend replay did not finish");
    assert.ok(dividendDates.includes(exDate), "the replay must consult the supplied dividend source");
    const broker = paper;
    assert.ok(broker !== undefined, "the replay must build a paper broker");

    const priorClose = accounts.get("priorClose");
    const exDatePreOpen = accounts.get("exDatePreOpen");
    const exDateAccount = accounts.get("exDate");
    const afterExDateBuy = accounts.get("exDateAfterBuy");
    const payDateAccount = accounts.get("payDate");
    assert.ok(priorClose !== undefined && exDatePreOpen !== undefined && exDateAccount !== undefined &&
      afterExDateBuy !== undefined && payDateAccount !== undefined);
    const holdings = (account: AccountSnapshot) => account.positions.find((position) => position.symbol === symbol);
    const settledCash = (account: AccountSnapshot): number => {
      assert.ok(account.settledCash !== undefined, "the paper account must report settled cash");
      return account.settledCash;
    };
    const [entry, exDayEntry] = broker.fills();
    assert.ok(entry !== undefined && exDayEntry !== undefined);
    assert.deepEqual(broker.fills().map((fill) => fill.date), [priorDay, exDate]);

    // Before the ex-date the account holds only the entry fill; no dividend was credited early.
    assert.equal(holdings(priorClose)?.quantity, priorQuantity);
    near(priorClose.cash, 1200 - priorQuantity * entry.price - (entry.fees ?? 0), "prior-close cash");
    assert.equal(settledCash(priorClose), priorClose.cash);
    assert.equal(priorClose.buyingPower, priorClose.cash);

    // The ex-date pre-open mark is still cum-dividend: the prior close and the
    // new receivable must not be counted together before the ex-date's own open.
    assert.equal(holdings(exDatePreOpen)?.quantity, priorQuantity);
    assert.equal(exDatePreOpen.cash, priorClose.cash, "no dividend before the ex-date open");
    assert.equal(exDatePreOpen.equity, priorClose.equity, "no dividend in the pre-open equity mark");
    assert.equal(settledCash(exDatePreOpen), settledCash(priorClose));

    // By the first ex-date intraday cycle the prior-close shares have earned
    // cash that counts toward cash and equity but stays unsettled; the lot
    // mark is unchanged.
    const dividend = priorQuantity * perShare;
    near(exDateAccount.cash - priorClose.cash, dividend, "ex-date cash");
    near(exDateAccount.equity - priorClose.equity, dividend, "ex-date equity");
    assert.equal(settledCash(exDateAccount), settledCash(priorClose));
    assert.equal(exDateAccount.buyingPower, priorClose.buyingPower);
    assert.equal(holdings(exDateAccount)?.quantity, priorQuantity);
    assert.equal(holdings(exDateAccount)?.averageCost, holdings(priorClose)?.averageCost);

    // The ex-date purchase does not earn the dividend: the only entitlement
    // that can be released below is still the prior-close quantity.
    const buyCost = exDateQuantity * exDayEntry.price + (exDayEntry.fees ?? 0);
    assert.equal(holdings(afterExDateBuy)?.quantity, priorQuantity + exDateQuantity);
    near(afterExDateBuy.cash, exDateAccount.cash - buyCost, "ex-day purchase cash");
    near(settledCash(afterExDateBuy), settledCash(exDateAccount) - buyCost, "ex-day purchase settled cash");

    // The pay date releases exactly the prior-close entitlement into settled
    // cash and buying power without creating new cash.
    assert.equal(holdings(payDateAccount)?.quantity, priorQuantity + exDateQuantity);
    near(payDateAccount.cash, afterExDateBuy.cash, "pay-date cash");
    near(settledCash(payDateAccount), settledCash(afterExDateBuy) + dividend, "pay-date settled cash");
    near(payDateAccount.buyingPower, afterExDateBuy.buyingPower + dividend, "pay-date buying power");
  } finally {
    await sim.close();
    cleanReplayCoverageFixture(dataDir, sim);
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
    assert.deepEqual(lookups, [], "the injected tape supplies historical liquidity without a second feed");
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

test("historical execution, visible indicators and gate use one completed price tape", async (t) => {
  const unexpectedFetches: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: URL | Request | string) => {
    unexpectedFetches.push(String(input));
    throw new Error("historical fixture must use only its injected price tape");
  });
  const dataDir = mkdtempSync("/tmp/sim-execution-warmup-");
  const tradeDate = "2026-09-01";
  const sessions = regularSessionDates("2026-07-01", "2026-10-30");
  const tradeIndex = sessions.indexOf(tradeDate);
  assert.ok(tradeIndex >= 20, "the fixture needs 20 regular sessions before the trade date");
  const fetchCounts = new Map<string, number>();
  // Flat $100 bars: the latest 10 prior sessions trade 1M shares, the 10 before
  // them 4M, so the 20-session average dollar volume is $250M (5 bp half-spread)
  // while a window truncated to the latest 10 sees only $100M (15 bp).
  const barsFor = (symbol: string, from: string, to: string): Bar[] => {
    fetchCounts.set(symbol, (fetchCounts.get(symbol) ?? 0) + 1);
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
      assert.ok(paper !== undefined);
      const visible = await ctx.market.history("AAPL", "5y");
      assert.ok(visible.bars.length >= 30);
      assert.ok(visible.bars.every((bar) => bar.date <= ctx.asOf()));
      const driverBars = await ctx.bars("AAPL");
      assert.deepEqual(driverBars, visible.bars, "raw driver bars must match the point-in-time tape");
      assert.equal(driverBars.at(-1)?.date, ctx.asOf(), "the driver tape ends on the completed session");
      if (ctx.kind === "post_close") {
        assert.equal(ctx.asOf(), tradeDate);
        assert.ok(driverBars.some((bar) => bar.date === tradeDate), "post-close sees the final completed bar");
        assert.ok(!driverBars.some((bar) => bar.date === "2026-09-02"), "post-close stops at the final simulated session");
        return;
      }
      if (ctx.kind !== "intraday" || run.progress.cycle !== 1) return;
      assert.equal(ctx.asOf(), "2026-08-31");
      assert.ok(!driverBars.some((bar) => bar.date === tradeDate), "the incomplete trade date stays invisible");
      assert.equal(visible.bars.at(-1)?.date, "2026-08-31");
      assert.equal(await ctx.market.avgDollarVolume("AAPL", 20), 250_000_000);
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
    assert.deepEqual([...fetchCounts].sort(), [["AAPL", 1], ["SPY", 2]], "SPY preflight is separate, then symbols are loaded once per run");
    assert.deepEqual(unexpectedFetches, []);
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

test("historical driver bars stop at the last completed session and include the final close", async () => {
  const dataDir = mkdtempSync("/tmp/sim-driver-bars-");
  const replay = ["2026-09-01", "2026-09-02"];
  const sourceDates = regularSessionDates("2026-07-01", "2026-10-30");
  const sourceTape: Bar[] = [];
  const observations: { kind: CycleKind; asOf: string; last: string | undefined }[] = [];
  const sim = createSimService({
    config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills,
    calendar: futureSessionCalendar("2026-10-30"),
    fetchBars: async (symbol, from, to) => {
      const bars = sourceDates.filter((date) => date >= from && date <= to)
        .map((date) => ({ date, open: 100, high: 100, low: 100, close: 100, volume: 1_000_000 }));
      if (symbol === "AAPL") sourceTape.push(...bars);
      return bars;
    },
    driver: async (run, ctx) => {
      const cutoff = ctx.asOf();
      const bars = await ctx.bars("AAPL");
      observations.push({ kind: ctx.kind, asOf: cutoff, last: bars.at(-1)?.date });
      assert.ok(bars.length > 0, "the driver must see completed history");
      assert.ok(bars.every((bar) => bar.date <= cutoff), `driver saw a bar after asOf ${cutoff}`);
      assert.equal(bars.at(-1)?.date, cutoff, "the driver tape ends on the completed session");
      if (ctx.kind === "post_close") {
        assert.equal(cutoff, replay.at(-1));
        assert.ok(bars.some((bar) => bar.date === "2026-09-02"), "post-close sees the final completed bar");
        assert.ok(!bars.some((bar) => bar.date === "2026-09-03"), "post-close stops before the next session");
      } else {
        assert.ok(!bars.some((bar) => bar.date === run.currentDate), `the incomplete ${run.currentDate} session leaked`);
        assert.equal(cutoff, run.progress.day === 1 ? "2026-08-31" : "2026-09-01");
      }
    },
  });
  try {
    const run = await sim.start({ startDate: replay[0], days: replay.length, startingCash: 1200, cyclesPerDay: 2,
      watchlist: ["AAPL"] }, "user");
    const done = await waitForDone(sim, run.id);
    assert.equal(done.status, "done", done.error ?? "driver bar replay did not finish");
    // The injected tape really does continue past the replay, so the cut is the driver seam's.
    assert.ok(sourceTape.some((bar) => bar.date === "2026-09-03"));
    assert.ok(sourceTape.some((bar) => bar.date === "2026-10-29"));
    assert.deepEqual(observations.filter((entry) => entry.kind === "post_close"),
      [{ kind: "post_close", asOf: "2026-09-02", last: "2026-09-02" }]);
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

test("invalid SPY benchmark prices fail a historical replay instead of scoring unusable metrics", async () => {
  const cases = [
    { label: "zero first open", date: "2026-04-17", patch: (bar: Bar): Bar => ({ ...bar, open: 0 }) },
    { label: "negative final close", date: "2026-04-20", patch: (bar: Bar): Bar => ({ ...bar, close: -5 }) },
  ];
  for (const item of cases) {
    const dataDir = mkdtempSync("/tmp/sim-invalid-spy-price-");
    let cycles = 0;
    const sim = createSimService({
      config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills,
      calendar: createNyseCalendar(),
      fetchBars: async (symbol, from, to) => {
        const bars = fixtureBars(symbol, from, to);
        return symbol === "SPY" ? bars.map((bar) => (bar.date === item.date ? item.patch(bar) : bar)) : bars;
      },
      driver: async () => { cycles++; },
    });
    try {
      const run = await sim.start({ startDate: "2026-04-17", days: 2, startingCash: 1200, cyclesPerDay: 2 }, "user");
      const done = await waitForDone(sim, run.id);
      assert.equal(done.status, "failed", `${item.label}: ${done.error ?? "replay completed with a malformed benchmark"}`);
      assert.match(done.error ?? "", /Invalid replay benchmark price.*SPY.*2026-/, item.label);
      assert.equal(cycles, 0, `${item.label}: no strategy cycle may run against an invalid benchmark`);
      assert.deepEqual(done.equity, [], `${item.label}: no closing mark may be recorded`);
      assert.deepEqual(done.fills, []);
    } finally {
      await sim.close();
      cleanReplayCoverageFixture(dataDir, sim);
    }
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
  const calendar = createNyseCalendar();
  const sim = createSimService({ config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus: createEventBus(), market, skills,
    calendar,
    fetchBars: async (s, f, t) => fixtureBars(s, f, t).filter((bar) => calendar.clock(etInstant(bar.date, 12)).tradingDay === bar.date),
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
    assert.equal(done.unavailableWatchlist, undefined);
  } finally {
    await sim.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("blind and bootstrap reveal requested coverage omissions only after the run ends", async () => {
  const dataDir = mkdtempSync("/tmp/sim-watchlist-coverage-");
  const bus = createEventBus();
  const calendar = createNyseCalendar();
  const events: SimRun[] = [];
  bus.subscribe((event) => { if (event.type === "sim") events.push(event.run); });
  const sim = createSimService({
    config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus, market, skills, calendar,
    wallNow: () => etInstant("2026-10-23", 12),
    fetchBars: async (symbol, from, to) => ["AAPL", "SPY"].includes(symbol)
      ? fixtureBars(symbol, from, to).filter((bar) => calendar.clock(etInstant(bar.date, 12)).tradingDay === bar.date)
      : [],
    sectorSource: createStaticSectorDirectory({}),
    driver: async (run) => {
      assert.equal(run.unavailableWatchlist, undefined, "the paper trader must only receive the aliased market");
      assert.equal(sim.get(run.id)?.unavailableWatchlist, undefined);
      assert.equal((JSON.parse(readFileSync(join(dataDir, "sim", run.id, "run.json"), "utf8")) as SimRun).unavailableWatchlist, undefined);
    },
  });
  try {
    for (const mode of ["blind", "bootstrap", "historical"] as const) {
      const run = await sim.start({ mode, startDate: "2025-06-02", days: 2, startingCash: 1200, cyclesPerDay: 2, seed: 7,
        watchlist: ["AAPL", "MISSING", "XLK"] }, "user");
      assert.equal(run.unavailableWatchlist, undefined);
      const done = await waitForDone(sim, run.id);
      assert.equal(done.status, "done", done.error ?? "");
      const expected = mode === "historical" ? undefined : ["MISSING", "XLK"];
      assert.deepEqual(done.unavailableWatchlist, expected, "exclude unrequested reference ETFs");
      const runEvents = events.filter((event) => event.id === run.id);
      assert.ok(runEvents.some((event) => event.status === "running"));
      assert.ok(runEvents.filter((event) => event.status === "running" || event.status === "queued")
        .every((event) => event.unavailableWatchlist === undefined));
      const terminal = runEvents.find((event) => event.status === "done");
      assert.ok(terminal?.finishedAt !== undefined, "publish terminal results together");
      assert.deepEqual(terminal.unavailableWatchlist, expected);
      assert.deepEqual((JSON.parse(readFileSync(join(dataDir, "sim", run.id, "run.json"), "utf8")) as SimRun).unavailableWatchlist, expected);
    }
  } finally {
    await sim.close();
    cleanReplayCoverageFixture(dataDir, sim);
  }
});

test("stopping during scenario construction cannot publish a late ticker disclosure", async () => {
  const dataDir = mkdtempSync("/tmp/sim-stopped-coverage-");
  const bus = createEventBus();
  const loading = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const events: SimRun[] = [];
  bus.subscribe((event) => { if (event.type === "sim") events.push(event.run); });
  const sim = createSimService({
    config: { ...loadConfig(), DATA_DIR: dataDir }, log, bus, market, skills,
    calendar: createNyseCalendar(), wallNow: () => etInstant("2026-10-23", 12),
    fetchBars: async (symbol, from, to) => {
      if (symbol === "MISSING") { loading.resolve(); await release.promise; return []; }
      return fixtureBars(symbol, from, to);
    },
    sectorSource: createStaticSectorDirectory({}),
    driver: async () => assert.fail("a run stopped while loading should not reach the trader"),
  });
  try {
    const run = await sim.start({ mode: "bootstrap", days: 2, seed: 7, startingCash: 1200, cyclesPerDay: 2, watchlist: ["AAPL", "MISSING"] }, "user");
    await loading.promise;
    const stopped = await sim.stop(run.id);
    assert.equal(stopped?.status, "stopped");
    assert.equal(stopped?.unavailableWatchlist, undefined);
    release.resolve();
    await sim.close();
    assert.equal(sim.get(run.id)?.status, "stopped");
    assert.ok(events.every((event) => event.unavailableWatchlist === undefined && event.aliases === undefined));
  } finally {
    release.resolve();
    await sim.close();
    cleanReplayCoverageFixture(dataDir, sim);
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
      if (run.progress.day === 1 && run.progress.cycle === 1 && run.variant === "A") {
        // The build already used Nov 19. Moving the manual clock here makes the
        // still-queued B execute on Nov 20 while sharing the suite snapshot.
        firstRunFetches = fetches.length;
        wallNow = etInstant("2026-11-20", 12);
      }
      // The driver tape grows through the run; sample the full scored snapshot after the last close.
      if (ctx.kind === "post_close") fullBenchmark.set(run.variant ?? run.id, await ctx.bars(ctx.benchmark));
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
