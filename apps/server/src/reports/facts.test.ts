import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SETTINGS,
  type AccountSnapshot,
  type BrokerStatus,
  type JournalEntry,
  type OrderIntent,
  type OrderRecord,
  type PriceHistory,
  type Report,
} from "@rh/shared";
import type { Broker, Clock, Logger, MarketData, Store } from "../ports.ts";
import { createMarketData } from "../market/market-data.ts";
import { createNyseCalendar } from "../risk/calendar.ts";
import { buildDailyFacts, buildTradeFacts, buildWeeklyFacts, type ReportFactsDeps } from "./facts.ts";
import { etAddDays } from "./ids.ts";
import type { PnlTrade } from "../robinhood/mapping.ts";

const log: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => log };
const calendar = createNyseCalendar();

/** Mid-morning ET on the date: safely inside its epoch bounds. */
const etMorning = (date: string): number => Date.parse(`${date}T15:30:00Z`);

function baseIntent(symbol: string, side: "buy" | "sell", price: number): OrderIntent {
  return {
    symbol,
    side,
    quantity: 10,
    orderType: "limit",
    limitPrice: price,
    timeInForce: "day",
    invalidationPrice: 90,
    timeStopDate: "2026-12-31",
    thesis: "Breakout above resistance on strong volume, holding for a measured move.",
    probabilityWin: 0.6,
    expectedGainPct: 10,
    expectedLossPct: 5,
    estimatedCostPct: 0.1,
    evidence: ["rh_quote showed a tight spread this morning"],
  };
}

function filledOrder(
  seq: number,
  symbol: string,
  side: "buy" | "sell",
  price: number,
  at: number,
  status: OrderRecord["status"] = "filled",
): OrderRecord {
  return {
    id: `o${seq}`,
    createdAt: at,
    updatedAt: at,
    intent: baseIntent(symbol, side, price),
    verdict: { approved: true, isExit: side === "sell", checks: [] },
    status,
    filledQuantity: 10,
    averageFillPrice: price,
  };
}

function bar(date: string, close: number): PriceHistory["bars"][number] {
  return { date, open: close - 1, high: close + 1, low: close - 2, close, volume: 1_000_000 };
}

function barsFrom(start: string, closes: number[]): PriceHistory["bars"] {
  return closes.map((close, i) => bar(etAddDays(start, i), close));
}

interface FakeMarketOptions {
  histories?: Map<string, PriceHistory["bars"]>;
  failing?: Set<string>;
}

function fakeMarket(options: FakeMarketOptions = {}): MarketData {
  return {
    history: async (symbol) => {
      if (options.failing?.has(symbol) ?? false) throw new Error(`${symbol} feed down`);
      const bars = options.histories?.get(symbol) ?? [];
      return { symbol, bars, source: "fake", asOf: Date.now() };
    },
    nextEarnings: async () => undefined,
    avgDollarVolume: async () => undefined,
  };
}

function fakeBroker(state: BrokerStatus["state"], trades: PnlTrade[] = [], stops: { symbol: string; stopPrice: number }[] = []): Broker {
  return {
    status: () => ({ state, tools: [] }),
    beginConnect: async () => "",
    completeConnect: async () => {},
    disconnect: async () => {},
    snapshot: async () => {
      throw new Error("not connected");
    },
    quote: async (symbol) => ({ symbol, bid: 99, ask: 101, last: 100, at: 0 }),
    reviewOrder: async () => "",
    placeOrder: async () => ({ brokerOrderId: "b1", raw: "" }),
    onChange: () => () => {},
    tradeHistory: async () => [...trades],
    openStopOrders: async () => [...stops],
  };
}

interface FakeStoreState {
  orders: OrderRecord[];
  journals: JournalEntry[];
  marks: { etDate: string; dayStart: number; dayHigh: number; dayLast: number }[];
  reports: Report[];
}

function fakeStore(state: FakeStoreState): Store {
  return {
    getSettings: () => structuredClone(DEFAULT_SETTINGS),
    patchSettings: (patch) => ({ ...structuredClone(DEFAULT_SETTINGS), ...patch, risk: { ...structuredClone(DEFAULT_SETTINGS.risk), ...patch.risk }, systemOne: { ...DEFAULT_SETTINGS.systemOne, ...patch.systemOne }, crypto: { ...DEFAULT_SETTINGS.crypto, ...patch.crypto } }),
    addJournal: (entry) => {
      const full = { ...entry, id: `j${state.journals.length + 1}` };
      state.journals.push(full);
      return full;
    },
    listJournal: (limit) => [...state.journals].sort((a, b) => b.at - a.at).slice(0, limit),
    addOrder: (order) => {
      const full = { ...order, id: `o${state.orders.length + 1}` };
      state.orders.push(full);
      return full;
    },
    updateOrder: (id) => {
      throw new Error(`unknown ${id}`);
    },
    getOrder: (id) => state.orders.find((o) => o.id === id),
    listOrders: (limit) => [...state.orders].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit),
    ordersSince: (since) => state.orders.filter((o) => o.createdAt >= since).sort((a, b) => a.createdAt - b.createdAt),
    markEquity: () => {},
    equityMarks: () => ({}),
    equitySeries: () => [...state.marks].sort((a, b) => (a.etDate < b.etDate ? -1 : 1)),
    saveReport: (report) => {
      const index = state.reports.findIndex((r) => r.id === report.id);
      if (index >= 0) state.reports[index] = report;
      else state.reports.push(report);
    },
    report: (id) => state.reports.find((r) => r.id === id),
    reports: () => [],
  };
}

function deps(overrides: Partial<ReportFactsDeps> & { orders?: OrderRecord[]; journals?: JournalEntry[]; state?: FakeStoreState } = {}): {
  deps: ReportFactsDeps;
  state: FakeStoreState;
} {
  const { orders, journals, state: given, ...rest } = overrides;
  const state: FakeStoreState = given ?? { orders: orders ?? [], journals: journals ?? [], marks: [], reports: [] };
  const clock: Clock = { now: () => Date.parse("2026-10-27T14:00:00Z") };
  const full: ReportFactsDeps = {
    store: fakeStore(state),
    market: fakeMarket(),
    broker: fakeBroker("disconnected"),
    getAccount: () => null,
    notes: { list: async () => [], read: async () => undefined, write: async () => ({ path: "", size: 0, updatedAt: 0 }) },
    calendar,
    clock,
    log,
    ...rest,
  };
  return { deps: full, state };
}

describe("daily facts", () => {
  it("pnl_comes_from_the_day_marks_and_benchmark_from_spy", async () => {
    const { deps: d, state } = deps({
      market: fakeMarket({ histories: new Map([["SPY", [bar("2026-10-23", 500), bar("2026-10-26", 505)]]]) }),
    });
    state.marks.push({ etDate: "2026-10-26", dayStart: 1000, dayHigh: 1030, dayLast: 1020 });
    const facts = await buildDailyFacts(d, "2026-10-26");
    assert.equal(facts.periodStart, "2026-10-26");
    assert.equal(facts.periodEnd, "2026-10-26");
    assert.equal(facts.startEquity, 1000);
    assert.equal(facts.endEquity, 1020);
    assert.equal(facts.pnl, 20);
    assert.equal(facts.pnlPct, 2);
    assert.deepEqual(facts.equityCurve, [{ date: "2026-10-26", equity: 1020 }]);
    assert.ok(Math.abs((facts.benchmarkPct ?? 0) - 1) < 1e-9);
  });

  it("benchmark_is_omitted_when_market_data_fails_but_pnl_survives", async () => {
    const { deps: d, state } = deps({ market: fakeMarket({ failing: new Set(["SPY"]) }) });
    state.marks.push({ etDate: "2026-10-26", dayStart: 1000, dayHigh: 1000, dayLast: 990 });
    const facts = await buildDailyFacts(d, "2026-10-26");
    assert.equal(facts.benchmarkPct, undefined);
    assert.equal(facts.pnl, -10);
    assert.equal(facts.pnlPct, -1);
  });

  it("counts_trades_decisions_and_orders_for_the_day", async () => {
    const buy = filledOrder(1, "NVDA", "buy", 100, etMorning("2026-10-26") - 3600_000);
    const sell = filledOrder(2, "NVDA", "sell", 105, etMorning("2026-10-26"));
    const otherDay = filledOrder(3, "AAPL", "buy", 200, etMorning("2026-10-23"));
    const cancelled = { ...filledOrder(4, "MSFT", "buy", 50, etMorning("2026-10-26")), status: "cancelled" as const, filledQuantity: undefined, averageFillPrice: undefined };
    const rejected = { ...filledOrder(5, "TSLA", "buy", 50, etMorning("2026-10-26")), status: "rejected_risk" as const, filledQuantity: undefined, averageFillPrice: undefined };
    const failed = { ...filledOrder(6, "AMD", "buy", 50, etMorning("2026-10-26")), status: "failed" as const, filledQuantity: undefined, averageFillPrice: undefined, error: "broker down" };
    const pending = { ...filledOrder(7, "INTC", "buy", 50, etMorning("2026-10-26")), status: "pending_approval" as const, filledQuantity: undefined, averageFillPrice: undefined };
    const held = { ...filledOrder(8, "NVDA", "sell", 90, etMorning("2026-10-26")), status: "held" as const, filledQuantity: undefined, averageFillPrice: undefined };
    const journals: JournalEntry[] = [
      { id: "j1", at: etMorning("2026-10-26"), action: "sell", symbol: "NVDA", summary: "Exited NVDA.", rationale: "Time stop.", evidence: [] },
      { id: "j2", at: etMorning("2026-10-26") - 1000, action: "hold", summary: "Morning.", rationale: "Waiting.", evidence: [] },
      { id: "j3", at: etMorning("2026-10-23"), action: "buy", summary: "Old.", rationale: "Old day.", evidence: [] },
    ];
    const { deps: d } = deps({ orders: [buy, sell, otherDay, cancelled, rejected, failed, pending, held], journals });
    const facts = await buildDailyFacts(d, "2026-10-26");
    assert.equal(facts.trades.length, 1);
    assert.equal(facts.trades[0]?.symbol, "NVDA");
    // $50 gross minus the 3¢ SEC fee on the $1,050 sale.
    assert.equal(facts.realizedPnl, 49.97);
    assert.equal(facts.winRatePct, 100);
    // The open AAPL buy is not a closed trade; pending and held orders are not outcomes.
    assert.deepEqual(facts.orders, { submitted: 0, filled: 2, rejected: 1, cancelled: 1, failed: 1 });
    assert.deepEqual(facts.decisions.map((e) => e.id), ["j1", "j2"]);
  });

  it("uses_broker_realizations_once_and_keeps_separate_same_symbol_exits", async () => {
    const exit = etMorning("2026-10-26");
    const buy = filledOrder(1, "NVDA", "buy", 100, exit - 3600_000);
    const sell = filledOrder(2, "NVDA", "sell", 95, exit + 12_908);
    // The broker reports the local exit in two lots and also has a nearby
    // manual exit. The local row uses the average price and observation time.
    const first = { symbol: "NVDA", closedAt: exit, quantity: 4, exitPrice: 94.75, pnl: -21 };
    const second = { symbol: "NVDA", closedAt: exit + 1000, quantity: 6, exitPrice: 95.17, pnl: -29 };
    const manual = { symbol: "NVDA", closedAt: exit + 2000, quantity: 1, exitPrice: 95.10, pnl: 4 };
    const { deps: d } = deps({ orders: [buy, sell], broker: fakeBroker("connected", [manual, second, first]) });

    const facts = await buildDailyFacts(d, "2026-10-26");

    assert.equal(facts.realizedPnl, -46);
    assert.deepEqual(facts.trades, [first, second, manual].map((trade) => ({ ...trade, source: "robinhood" })));
    assert.equal(facts.avgR, undefined);
  });

  for (const outcome of ["empty", "failing"] as const) {
    it(`uses_harness_realizations_when_connected_broker_history_is_${outcome}`, async () => {
      const exit = etMorning("2026-10-26");
      const broker = fakeBroker("connected");
      if (outcome === "failing") broker.tradeHistory = async () => { throw new Error("history unavailable"); };
      const { deps: d } = deps({
        orders: [filledOrder(1, "NVDA", "buy", 100, exit - 3600_000), filledOrder(2, "NVDA", "sell", 105, exit)],
        broker,
      });

      const facts = await buildDailyFacts(d, "2026-10-26");

      assert.equal(facts.realizedPnl, 49.97);
      assert.deepEqual(facts.trades.map((trade) => trade.source), ["harness"]);
      assert.equal(facts.avgR, 0.4997);
    });
  }

  it("keeps_at_most_20_decisions_newest_first", async () => {
    const journals: JournalEntry[] = Array.from({ length: 22 }, (_, i) => ({
      id: `j${i}`,
      at: etMorning("2026-10-26") + i * 1000,
      action: "hold" as const,
      summary: `Note ${i}.`,
      rationale: "Steady.",
      evidence: [],
    }));
    const { deps: d } = deps({ journals });
    const facts = await buildDailyFacts(d, "2026-10-26");
    assert.equal(facts.decisions.length, 20);
    assert.equal(facts.decisions[0]?.id, "j21");
  });
});

describe("weekly facts", () => {
  const fridayClock: Clock = { now: () => Date.parse("2026-10-30T20:00:00Z") };
  const wednesdayClock: Clock = { now: () => Date.parse("2026-10-28T20:00:00Z") };

  it("covers_monday_through_friday_with_week_pnl", async () => {
    const { deps: d, state } = deps({
      clock: fridayClock,
      market: fakeMarket({ histories: new Map([["SPY", [bar("2026-10-23", 500), bar("2026-10-30", 510)]]]) }),
    });
    for (const [date, equity] of [["2026-10-26", 1000], ["2026-10-27", 1010], ["2026-10-28", 1005], ["2026-10-29", 1090], ["2026-10-30", 1100]] as const) {
      state.marks.push({ etDate: date, dayStart: equity, dayHigh: equity, dayLast: equity });
    }
    const facts = await buildWeeklyFacts(d, "2026-10-28");
    assert.equal(facts.periodStart, "2026-10-26");
    assert.equal(facts.periodEnd, "2026-10-30");
    assert.equal(facts.startEquity, 1000);
    assert.equal(facts.endEquity, 1100);
    assert.equal(facts.pnl, 100);
    assert.equal(facts.pnlPct, 10);
    assert.equal(facts.equityCurve.length, 5);
    assert.ok(Math.abs((facts.benchmarkPct ?? 0) - 2) < 1e-9);
  });

  it("clamps_the_period_to_today_midweek", async () => {
    const { deps: d, state } = deps({ clock: wednesdayClock });
    for (const [date, equity] of [["2026-10-26", 1000], ["2026-10-27", 1010], ["2026-10-28", 1020]] as const) {
      state.marks.push({ etDate: date, dayStart: equity, dayHigh: equity, dayLast: equity });
    }
    const facts = await buildWeeklyFacts(d, "2026-10-26");
    assert.equal(facts.periodStart, "2026-10-26");
    assert.equal(facts.periodEnd, "2026-10-28");
    assert.equal(facts.endEquity, 1020);
  });
});

describe("benchmark freshness", () => {
  it("fetches the closing bar despite an intraday cache and does not cache a missing close", async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), "report-close-"));
    const cacheDir = join(dataDir, "cache", "market");
    t.after(async () => {
      for (const name of await readdir(cacheDir)) await unlink(join(cacheDir, name));
      await rmdir(cacheDir);
      await rmdir(join(dataDir, "cache"));
      await rmdir(dataDir);
    });
    let now = Date.parse("2026-11-20T20:45:00Z");
    const clock: Clock = { now: () => now };
    let hasFridayClose = false;
    let historyReads = 0;
    const market = createMarketData({
      dataDir,
      clock,
      log,
      fetchImpl: async () => {
        historyReads++;
        const row = (date: string, close: string) => ({ date, open: close, high: close, low: close, close, volume: "1000" });
        return Response.json({ data: { tradesTable: { rows: [
          ...(hasFridayClose ? [row("11/20/2026", "90")] : []),
          row("11/19/2026", "100"),
          row("11/13/2026", "75"),
        ] } } });
      },
    });
    const { deps: d } = deps({ market, clock });
    const afternoon = await market.history("SPY", "1y");
    assert.equal(afternoon.bars.at(-1)?.date, "2026-11-19");
    assert.equal((await buildDailyFacts(d, "2026-11-20")).benchmarkPct, undefined);
    assert.equal(historyReads, 1, "do not request the official close while the session is open");

    now = Date.parse("2026-11-20T21:10:00Z");
    assert.equal((await buildDailyFacts(d, "2026-11-20")).benchmarkPct, undefined);
    assert.equal(historyReads, 2, "do not reuse a history read before the regular close");

    hasFridayClose = true;
    const daily = await buildDailyFacts(d, "2026-11-20");
    assert.ok(Math.abs((daily.benchmarkPct ?? NaN) - (-10)) < 1e-9);
    const weekly = await buildWeeklyFacts(d, "2026-11-16");
    assert.ok(Math.abs((weekly.benchmarkPct ?? NaN) - 20) < 1e-9);
    assert.equal(historyReads, 3, "recheck a missing close, then share the confirmed bar");
    assert.equal((await market.history("SPY", "1y")).bars.at(-1)?.date, "2026-11-19", "leave the ordinary market-data cache unchanged");
  });

  interface BenchmarkCase {
    name: string;
    kind: "daily" | "weekly";
    reportDate: string;
    clock?: Clock;
    bars: PriceHistory["bars"];
    expected: number | undefined;
  }

  const friday = (date: string): Clock => ({ now: () => Date.parse(`${date}T20:00:00Z`) });
  const cases: BenchmarkCase[] = [
    {
      name: "daily omits the benchmark when the period's own close has not arrived",
      kind: "daily",
      reportDate: "2026-10-26",
      // The old close-on-or-before lookup matched 2026-10-23 for both ends and reported 0%.
      bars: [bar("2026-10-22", 500), bar("2026-10-23", 505)],
      expected: undefined,
    },
    {
      name: "weekly omits the benchmark instead of stopping at the latest stale bar",
      kind: "weekly",
      reportDate: "2026-10-28",
      clock: friday("2026-10-30"),
      bars: [bar("2026-10-23", 500), bar("2026-10-28", 505)],
      expected: undefined,
    },
    {
      name: "omits the benchmark when the baseline anchor has no bar even though an older one exists",
      kind: "daily",
      reportDate: "2026-10-26",
      bars: [bar("2026-10-22", 500), bar("2026-10-26", 505)],
      expected: undefined,
    },
    {
      name: "uses the close before Thanksgiving for a Friday-after-holiday period start",
      kind: "daily",
      reportDate: "2026-11-27",
      clock: { now: () => Date.parse("2026-11-27T18:00:00Z") }, // 13:00 ET early close
      bars: [bar("2026-11-25", 600), bar("2026-11-27", 612)],
      expected: (612 / 600 - 1) * 100,
    },
    {
      name: "uses Friday's close for a weekend period end and keeps a real 0%",
      kind: "daily",
      reportDate: "2026-11-29",
      clock: { now: () => Date.parse("2026-11-29T20:00:00Z") },
      bars: [bar("2026-11-25", 600), bar("2026-11-27", 606)],
      expected: 0,
    },
    {
      name: "keeps a genuine flat benchmark instead of treating 0 as unavailable",
      kind: "daily",
      reportDate: "2026-10-26",
      bars: [bar("2026-10-23", 500), bar("2026-10-26", 500)],
      expected: 0,
    },
  ];

  it("requires_exact_anchor_closes_and_preserves_real_flat_results", async () => {
    for (const c of cases) {
      const { deps: d } = deps({ clock: c.clock ?? { now: () => Date.parse("2026-10-27T14:00:00Z") }, market: fakeMarket({ histories: new Map([["SPY", c.bars]]) }) });
      const facts = c.kind === "weekly" ? await buildWeeklyFacts(d, c.reportDate) : await buildDailyFacts(d, c.reportDate);
      if (c.expected === undefined) {
        assert.equal(facts.benchmarkPct, undefined, c.name);
      } else {
        assert.notEqual(facts.benchmarkPct, undefined, c.name);
        assert.ok(Math.abs((facts.benchmarkPct ?? NaN) - c.expected) < 1e-9, `${c.name}: ${facts.benchmarkPct}`);
      }
    }
  });
});

describe("trade selection", () => {
  it("prefers_the_newest_harness_trade_over_a_newer_robinhood_one", async () => {
    const buy = filledOrder(1, "NVDA", "buy", 100, etMorning("2026-10-26") - 7200_000);
    const sell = filledOrder(2, "NVDA", "sell", 110, etMorning("2026-10-26") - 3600_000);
    const rh: PnlTrade = { symbol: "NVDA", closedAt: etMorning("2026-10-26"), quantity: 5, exitPrice: 200, pnl: 25 };
    const { deps: d } = deps({ orders: [buy, sell], broker: fakeBroker("connected", [rh]) });
    const facts = await buildTradeFacts(d, "NVDA");
    assert.equal(facts.trade?.trade.source, "harness");
    assert.equal(facts.trade?.trade.closedAt, sell.updatedAt);
    assert.equal(facts.trade?.trade.pnl, 100);
    assert.equal(facts.trade?.trade.rMultiple, 1);
    assert.equal(facts.trade?.plan?.thesis, buy.intent.thesis);
    assert.equal(facts.trade?.entryOrderId, "o1");
    assert.equal(facts.trade?.exitOrderId, "o2");
    assert.equal(facts.periodStart, "2026-10-26");
    assert.equal(facts.periodEnd, "2026-10-26");
  });

  it("falls_back_to_robinhood_history_without_entry_detail", async () => {
    // Sixty consecutive dates ending on the 2026-10-23 exit.
    const bars = barsFrom("2026-08-25", Array.from({ length: 60 }, (_, i) => 150 + i));
    const rh: PnlTrade = { symbol: "VRT", closedAt: etMorning("2026-10-23"), quantity: 5, exitPrice: 210, pnl: 25 };
    const { deps: d } = deps({
      broker: fakeBroker("connected", [rh]),
      market: fakeMarket({ histories: new Map([["VRT", bars], ["SPY", [bar("2026-10-22", 500), bar("2026-10-23", 505)]]]) }),
    });
    const facts = await buildTradeFacts(d, "VRT");
    assert.equal(facts.trade?.trade.source, "robinhood");
    assert.equal(facts.trade?.trade.pnl, 25);
    assert.equal(facts.pnl, 25, "a trade report's headline P&L is the trade's own");
    assert.equal(facts.trade?.plan, undefined);
    assert.equal(facts.trade?.entryOrderId, undefined);
    assert.equal(facts.periodStart, "2026-10-23");
    assert.equal(facts.periodEnd, "2026-10-23");
    // 20 trading days before the exit bar through the exit bar itself.
    assert.equal(facts.trade?.bars.length, 21);
    assert.equal(facts.trade?.bars.at(-1)?.date, "2026-10-23");
  });

  it("throws_when_no_closed_trade_exists", async () => {
    const { deps: d } = deps({ orders: [filledOrder(1, "NVDA", "buy", 100, etMorning("2026-10-26"))] });
    await assert.rejects(() => buildTradeFacts(d, "NVDA"), /No closed trade for NVDA/);
  });

  it("windows_bars_from_20_days_before_entry_to_5_after_exit", async () => {
    const start = "2026-08-03";
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const entryDate = etAddDays(start, 30);
    const exitDate = etAddDays(start, 40);
    const buy = filledOrder(1, "NVDA", "buy", 100, etMorning(entryDate));
    const sell = filledOrder(2, "NVDA", "sell", 140, etMorning(exitDate));
    const { deps: d } = deps({
      orders: [buy, sell],
      market: fakeMarket({ histories: new Map([["NVDA", barsFrom(start, closes)]]) }),
      clock: { now: () => Date.parse("2026-10-27T14:00:00Z") },
    });
    const facts = await buildTradeFacts(d, "NVDA");
    assert.equal(facts.periodStart, entryDate);
    assert.equal(facts.periodEnd, exitDate);
    assert.equal(facts.trade?.bars.length, 36);
    assert.equal(facts.trade?.bars[0]?.date, etAddDays(start, 10));
    assert.equal(facts.trade?.bars.at(-1)?.date, etAddDays(start, 45));
  });

  it("leaves_bars_empty_when_history_fails", async () => {
    const buy = filledOrder(1, "NVDA", "buy", 100, etMorning("2026-10-26") - 3600_000);
    const sell = filledOrder(2, "NVDA", "sell", 110, etMorning("2026-10-26"));
    const { deps: d } = deps({ orders: [buy, sell], market: fakeMarket({ failing: new Set(["NVDA", "SPY"]) }) });
    const facts = await buildTradeFacts(d, "NVDA");
    assert.deepEqual(facts.trade?.bars, []);
    assert.equal(facts.trade?.trade.pnl, 100);
  });
});

describe("positions and heat", () => {
  const account = (positions: AccountSnapshot["positions"]): AccountSnapshot => ({
    at: etMorning("2026-10-26"),
    equity: 2000,
    cash: 1000,
    buyingPower: 1000,
    positions,
  });
  const position = { symbol: "NVDA", quantity: 10, averageCost: 95, marketValue: 1000, unrealizedPnl: 50, sector: "Technology" };

  it("uses_the_newest_held_stop_first", async () => {
    const oldStop = { ...filledOrder(1, "NVDA", "sell", 85, etMorning("2026-10-26") - 7200_000), status: "held" as const, filledQuantity: undefined, averageFillPrice: undefined };
    oldStop.intent = { ...oldStop.intent, orderType: "stop_limit", stopPrice: 85 };
    const newStop = { ...filledOrder(2, "NVDA", "sell", 90, etMorning("2026-10-26") - 3600_000), status: "held" as const, filledQuantity: undefined, averageFillPrice: undefined };
    newStop.intent = { ...newStop.intent, orderType: "stop_limit", stopPrice: 90 };
    const { deps: d } = deps({ orders: [oldStop, newStop], getAccount: () => account([position]) });
    const facts = await buildDailyFacts(d, "2026-10-26");
    assert.equal(facts.positions[0]?.weightPct, 50);
    assert.equal(facts.positions[0]?.sector, "Technology");
    // (1000 - 90*10) / 2000 * 100 = 5.
    assert.equal(facts.heatPct, 5);
  });

  it("falls_back_to_robinhood_then_thesis_stops", async () => {
    const rh = deps({ broker: fakeBroker("connected", [], [{ symbol: "NVDA", stopPrice: 95 }]), getAccount: () => account([position]) });
    assert.equal((await buildDailyFacts(rh.deps, "2026-10-26")).heatPct, 2.5);

    const thesis = deps({
      getAccount: () => account([position]),
      notes: {
        list: async () => [],
        read: async () => ({ path: "theses/NVDA.md", content: "Invalidation $80 on a daily close.", updatedAt: 0 }),
        write: async () => ({ path: "", size: 0, updatedAt: 0 }),
      },
    });
    assert.equal((await buildDailyFacts(thesis.deps, "2026-10-26")).heatPct, 10);
  });

  it("reports_zero_heat_when_no_stop_is_stated", async () => {
    const { deps: d } = deps({ getAccount: () => account([position]) });
    const facts = await buildDailyFacts(d, "2026-10-26");
    assert.equal(facts.heatPct, 0);
    assert.equal(facts.positions.length, 1);
  });
});
