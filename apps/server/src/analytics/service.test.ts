import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type AccountSnapshot, type OrderRecord, type PriceHistory } from "@rh/shared";
import type { Broker, Clock, Logger, MarketCalendar, MarketData, Notes, Store } from "../ports.ts";
import { createNyseCalendar } from "../risk/calendar.ts";
import { createAnalyticsService } from "./service.ts";

const NOW = new Date("2026-10-26T14:00:00Z").getTime();
const clock: Clock = { now: () => NOW };
const log: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => log };

function bars(symbol: string, lastClose: number, count = 260): PriceHistory {
  const out: PriceHistory["bars"] = [];
  for (let i = 0; i < count; i++) {
    const close = lastClose - (count - 1 - i) * 0.5;
    out.push({
      date: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
      open: close - 1,
      high: close + 1,
      low: close - 2,
      close,
      volume: 1_000_000,
    });
  }
  // Unique ascending dates ending at fixed ET dates.
  const base = new Date("2025-10-24T12:00:00Z").getTime() - (count - 1) * 86_400_000;
  return {
    symbol,
    bars: out.map((b, i) => ({ ...b, date: new Date(base + i * 86_400_000).toISOString().slice(0, 10) })),
    source: "test",
    asOf: NOW,
  };
}

const market: MarketData = {
  history: async (symbol) => bars(symbol, 100),
  nextEarnings: async () => undefined,
  avgDollarVolume: async () => undefined,
};

const calendar: MarketCalendar = {
  clock: (now) => ({ now, session: "regular", isOpen: true, tradingDay: "2026-10-26", nextOpen: now, nextClose: now, earlyClose: false }),
  etDate: () => "2026-10-26",
  tradingDaysBetween: () => 0,
};

function orderRecord(symbol: string, status: OrderRecord["status"], stopPrice?: number): OrderRecord {
  return {
    id: `order-${symbol}-${status}`,
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    intent: {
      symbol,
      side: "sell",
      quantity: 1,
      orderType: "stop_limit",
      limitPrice: 90,
      ...(stopPrice === undefined ? {} : { stopPrice }),
      timeInForce: "gtc",
      invalidationPrice: 80,
      timeStopDate: "2026-12-31",
      thesis: "A sufficiently long thesis statement for the intent schema.",
      probabilityWin: 0.5,
      expectedGainPct: 5,
      expectedLossPct: 2,
      estimatedCostPct: 0.05,
      evidence: ["price above average"],
    },
    verdict: { approved: true, isExit: true, checks: [] },
    status,
  };
}

function fakeStore(orders: OrderRecord[]): Store {
  return {
    getSettings: () => structuredClone(DEFAULT_SETTINGS),
    patchSettings: (patch) => ({ ...structuredClone(DEFAULT_SETTINGS), ...patch, risk: { ...DEFAULT_SETTINGS.risk, ...patch.risk }, systemOne: { ...DEFAULT_SETTINGS.systemOne, ...patch.systemOne }, crypto: { ...DEFAULT_SETTINGS.crypto, ...patch.crypto } }),
    addJournal: (entry) => ({ ...entry, id: "j1" }),
    listJournal: () => [],
    addOrder: (o) => ({ ...o, id: "o1" }),
    updateOrder: (id) => {
      throw new Error(`unknown ${id}`);
    },
    getOrder: () => undefined,
    listOrders: () => [...orders],
    ordersSince: () => [...orders],
    markEquity: () => {},
    equityMarks: () => ({}),
    equitySeries: () => [],
    saveReport: () => {},
    report: () => undefined,
    reports: () => [],
  };
}

function fakeBroker(stops: { symbol: string; stopPrice: number }[]): Broker {
  return {
    status: () => ({ state: "connected", tools: [] }),
    beginConnect: async () => "",
    completeConnect: async () => {},
    disconnect: async () => {},
    snapshot: async () => {
      throw new Error("not connected");
    },
    quote: async (symbol) => ({ symbol, bid: 99, ask: 101, last: 100, at: NOW }),
    reviewOrder: async () => "",
    placeOrder: async () => ({ brokerOrderId: "b1", raw: "" }),
    onChange: () => () => {},
    openStopOrders: async () => stops,
  };
}

function account(): AccountSnapshot {
  return {
    at: NOW,
    equity: 1000,
    cash: 100,
    buyingPower: 100,
    positions: [{ symbol: "AAPL", quantity: 9, averageCost: 90, marketValue: 900, unrealizedPnl: 90, sector: "Technology" }],
  };
}

describe("equity benchmark dates", () => {
  const apr17 = "2026-04-17";
  const apr20 = "2026-04-20";
  const apr21 = "2026-04-21";

  function equity(dates: string[], prices: Record<string, number>) {
    return createAnalyticsService({
      store: {
        ...fakeStore([]),
        equitySeries: () => dates.map((etDate, i) => ({ etDate, dayStart: 1000, dayHigh: 1000 + 10 * i, dayLast: 1000 + 10 * i })),
      },
      market: {
        ...market,
        history: async (symbol) => ({
          symbol,
          bars: Object.entries(prices).map(([date, close]) => ({ date, close, open: close, high: close, low: close, volume: 1 })),
          source: "test",
          asOf: NOW,
        }),
      },
      broker: fakeBroker([]),
      getAccount: () => null,
      notes: { list: async () => [], read: async () => undefined, write: async () => ({ path: "", size: 0, updatedAt: 0 }) },
      calendar: createNyseCalendar(),
      clock,
      log,
      dataDir: "/tmp/analytics-test",
    }).equity("1y");
  }

  it("does not substitute an earlier close for a missing session or change the comparison interval", async () => {
    const tape = { [apr17]: 100, [apr21]: 105 };
    const interior = await equity([apr17, apr20, apr21], tape);
    assert.deepEqual(interior.points.map((p) => p.benchmark), [1000, undefined, 1050]);
    assert.ok(Math.abs((interior.benchmarkReturnPct ?? NaN) - 5) < 1e-9);

    const missingEnd = await equity([apr17, apr21, "2026-04-22"], tape);
    assert.equal(missingEnd.points.at(-1)?.benchmark, undefined);
    assert.equal(missingEnd.benchmarkReturnPct, undefined);
    assert.ok(Math.abs((missingEnd.returnPct ?? NaN) - 2) < 1e-9);

    const missingStart = await equity([apr20, apr21, "2026-04-22"], { ...tape, "2026-04-22": 103 });
    assert.deepEqual(missingStart.points.map((p) => p.benchmark), [undefined, undefined, undefined]);
    assert.equal(missingStart.benchmarkReturnPct, undefined);
  });

  it("carries a closed day's last scheduled session, but does not bridge a missing session", async () => {
    // Good Friday 2026 is closed and the last regular session is Thursday.
    const goodFriday = await equity(["2026-04-02", "2026-04-03", "2026-04-04"], { "2026-04-02": 100 });
    assert.deepEqual(goodFriday.points.map((p) => p.benchmark), [1000, 1000, 1000]);
    assert.equal(goodFriday.benchmarkReturnPct, 0);

    const missingFriday = await equity(["2026-04-16", "2026-04-18"], { "2026-04-16": 100 });
    assert.deepEqual(missingFriday.points.map((p) => p.benchmark), [1000, undefined]);
    assert.equal(missingFriday.benchmarkReturnPct, undefined);
  });
});

describe("stop resolution order", () => {
  it("prefers the held stop over Robinhood and thesis stops", async () => {
    const service = createAnalyticsService({
      store: fakeStore([orderRecord("AAPL", "held", 88)]),
      market,
      broker: fakeBroker([{ symbol: "AAPL", stopPrice: 85 }]),
      getAccount: account,
      notes: { list: async () => [], read: async () => ({ path: "theses/AAPL.md", content: "Invalidation $80.", updatedAt: NOW }), write: async () => ({ path: "", size: 0, updatedAt: 0 }) } satisfies Notes,
      calendar,
      clock,
      log,
      dataDir: "/tmp/analytics-test",
    });
    const summary = await service.performance();
    assert.equal(summary.exposure[0]?.stopPrice, 88);
    assert.equal(summary.heatPct, 10.8);
  });

  it("falls back to the Robinhood stop, then the thesis invalidation", async () => {
    const thesis: Notes = {
      list: async () => [],
      read: async () => ({ path: "theses/AAPL.md", content: "Stop at 82 on a daily close.", updatedAt: NOW }),
      write: async () => ({ path: "", size: 0, updatedAt: 0 }),
    };
    const withRh = createAnalyticsService({
      store: fakeStore([]),
      market,
      broker: fakeBroker([{ symbol: "AAPL", stopPrice: 85 }]),
      getAccount: account,
      notes: thesis,
      calendar,
      clock,
      log,
      dataDir: "/tmp/analytics-test",
    });
    assert.equal((await withRh.performance()).exposure[0]?.stopPrice, 85);

    const thesisOnly = createAnalyticsService({
      store: fakeStore([]),
      market,
      broker: fakeBroker([]),
      getAccount: account,
      notes: thesis,
      calendar,
      clock,
      log,
      dataDir: "/tmp/analytics-test",
    });
    const exposure = (await thesisOnly.performance()).exposure[0];
    assert.equal(exposure?.stopPrice, 82);
    // (900 - 82*9) / 1000 * 100 = 16.2
    assert.ok(Math.abs((exposure?.riskToStopPct ?? 0) - 16.2) < 1e-9);
  });

  it("leaves the stop absent when nothing states one", async () => {
    const service = createAnalyticsService({
      store: fakeStore([]),
      market,
      broker: fakeBroker([]),
      getAccount: account,
      notes: { list: async () => [], read: async () => undefined, write: async () => ({ path: "", size: 0, updatedAt: 0 }) },
      calendar,
      clock,
      log,
      dataDir: "/tmp/analytics-test",
    });
    const summary = await service.performance();
    assert.equal(summary.exposure[0]?.stopPrice, undefined);
    assert.equal(summary.heatPct, undefined);
  });
});
