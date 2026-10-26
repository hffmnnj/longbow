import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type AccountSnapshot, type OrderRecord, type PriceHistory } from "@rh/shared";
import type { Broker, Clock, Logger, MarketCalendar, MarketData, Notes, Store } from "../ports.ts";
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
    patchSettings: (patch) => ({ ...structuredClone(DEFAULT_SETTINGS), ...patch, risk: { ...DEFAULT_SETTINGS.risk, ...patch.risk } }),
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
    assert.equal((await service.performance()).exposure[0]?.stopPrice, undefined);
  });
});
