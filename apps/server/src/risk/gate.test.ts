import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  type AccountSnapshot,
  type BrokerStatus,
  type HistoryRange,
  type JournalEntry,
  type OrderIntent,
  type OrderRecord,
  type PriceHistory,
  type Quote,
  type ServerEvent,
  type Settings,
  type SettingsPatch,
} from "@rh/shared";
import { createOrderGate } from "./gate.ts";
import { createNyseCalendar } from "./calendar.ts";
import type { Broker, Clock, EventBus, Logger, MarketData, Store } from "../ports.ts";

const NOW = Date.UTC(2026, 10, 2, 15, 5, 0);

function baseIntent(): OrderIntent {
  return {
    symbol: "AAPL",
    side: "buy",
    quantity: 10,
    orderType: "limit",
    limitPrice: 150,
    timeInForce: "day",
    invalidationPrice: 140,
    timeStopDate: "2026-12-02",
    thesis: "breakout above resistance on strong volume",
    probabilityWin: 0.6,
    expectedGainPct: 10,
    expectedLossPct: 5,
    estimatedCostPct: 0.5,
    evidence: ["robinhood quote showed tight spread this morning"],
  };
}

function baseSnapshot(): AccountSnapshot {
  return {
    at: NOW,
    equity: 100_000,
    cash: 50_000,
    buyingPower: 50_000,
    settledCash: 50_000,
    positions: [
      { symbol: "AAPL", quantity: 20, averageCost: 145, marketValue: 3000, unrealizedPnl: 100, sector: "Technology" },
    ],
  };
}

function baseQuote(): Quote {
  return { symbol: "AAPL", bid: 149.95, ask: 150.05, last: 150, at: NOW };
}

class FakeStore implements Store {
  settings: Settings = structuredClone(DEFAULT_SETTINGS);
  orders = new Map<string, OrderRecord>();
  seq = 0;
  marks = new Map<string, number[]>();
  patchCalls = 0;

  getSettings(): Settings {
    return this.settings;
  }
  patchSettings(patch: SettingsPatch): Settings {
    this.patchCalls += 1;
    this.settings = {
      ...this.settings,
      ...patch,
      risk: { ...this.settings.risk, ...patch.risk },
    };
    return this.settings;
  }
  addJournal(entry: Omit<JournalEntry, "id">): JournalEntry {
    return { ...entry, id: "j1" };
  }
  listJournal(_limit: number): JournalEntry[] {
    return [];
  }
  addOrder(order: Omit<OrderRecord, "id">): OrderRecord {
    this.seq += 1;
    const record = { ...order, id: `order-${this.seq}` };
    this.orders.set(record.id, record);
    return record;
  }
  updateOrder(id: string, patch: Partial<Omit<OrderRecord, "id" | "createdAt">>): OrderRecord {
    const existing = this.orders.get(id);
    if (!existing) throw new Error(`unknown ${id}`);
    const updated = { ...existing, ...patch };
    this.orders.set(id, updated);
    return updated;
  }
  getOrder(id: string): OrderRecord | undefined {
    return this.orders.get(id);
  }
  listOrders(limit: number): OrderRecord[] {
    return [...this.orders.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
  ordersSince(since: number): OrderRecord[] {
    return [...this.orders.values()]
      .filter((o) => o.createdAt >= since)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  markEquity(_at: number, etDate: string, equity: number): void {
    this.marks.set(etDate, [...(this.marks.get(etDate) ?? []), equity]);
  }
  equityMarks(etDate: string): { dayStart?: number; monthPeak?: number } {
    const day = this.marks.get(etDate);
    const month = etDate.slice(0, 7);
    let peak: number | undefined;
    for (const [date, equities] of this.marks) {
      if (date.startsWith(month)) peak = Math.max(peak ?? -Infinity, ...equities);
    }
    return {
      ...(day?.[0] === undefined ? {} : { dayStart: day[0] }),
      ...(peak === undefined ? {} : { monthPeak: peak }),
    };
  }
}

class FakeBroker implements Broker {
  snapshotValue: AccountSnapshot = baseSnapshot();
  snapshotError?: string;
  quoteValue: Quote = baseQuote();
  statusState: BrokerStatus["state"] = "connected";
  snapshotCalls = 0;
  quoteCalls = 0;
  reviewCalls = 0;
  placeCalls = 0;
  lastPlaced?: OrderIntent;

  status(): BrokerStatus {
    return { state: this.statusState, tools: [] };
  }
  async beginConnect(): Promise<string> {
    return "https://example.test/connect";
  }
  async completeConnect(_params: URLSearchParams): Promise<void> {}
  async disconnect(): Promise<void> {}
  async snapshot(): Promise<AccountSnapshot> {
    this.snapshotCalls += 1;
    if (this.snapshotError !== undefined) throw new Error(this.snapshotError);
    return this.snapshotValue;
  }
  async quote(symbol: string): Promise<Quote> {
    this.quoteCalls += 1;
    return { ...this.quoteValue, symbol };
  }
  async reviewOrder(_intent: OrderIntent): Promise<string> {
    this.reviewCalls += 1;
    return "review: no warnings";
  }
  async placeOrder(intent: OrderIntent): Promise<{ brokerOrderId: string; raw: string }> {
    this.placeCalls += 1;
    this.lastPlaced = intent;
    return { brokerOrderId: `b${this.placeCalls}`, raw: "{}" };
  }
  onChange(_listener: () => void): () => void {
    return () => {};
  }
}

class FakeMarketData implements MarketData {
  earningsValue: string | undefined = undefined;
  earningsError?: string;
  volumeValue: number | undefined = 50_000_000;
  volumeError?: string;

  async history(symbol: string, _range: HistoryRange): Promise<PriceHistory> {
    return { symbol, bars: [], source: "fake", asOf: NOW };
  }
  async nextEarnings(_symbol: string): Promise<string | undefined> {
    if (this.earningsError !== undefined) throw new Error(this.earningsError);
    return this.earningsValue;
  }
  async avgDollarVolume(_symbol: string, _days: number): Promise<number | undefined> {
    if (this.volumeError !== undefined) throw new Error(this.volumeError);
    return this.volumeValue;
  }
}

function setup(options?: { mode?: Settings["mode"]; market?: MarketData | null }) {
  const store = new FakeStore();
  if (options?.mode !== undefined) store.settings = { ...store.settings, mode: options.mode };
  const broker = new FakeBroker();
  const market = options?.market === undefined ? new FakeMarketData() : options.market;
  let now = NOW;
  const clock: Clock = { now: () => now };
  const events: ServerEvent[] = [];
  const bus: EventBus = {
    publish: (event: ServerEvent) => {
      events.push(event);
    },
    subscribe: () => () => {},
  };
  const log: Logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => log,
  };
  const gate = createOrderGate({
    store,
    broker,
    calendar: createNyseCalendar(),
    clock,
    bus,
    log,
    ...(market === null ? {} : { market }),
  });
  return { store, broker, gate, events, market, setNow: (t: number) => (now = t) };
}

describe("order gate", () => {
  it("places an approved order exactly once in auto mode", async () => {
    const { gate, broker, events } = setup({ mode: "auto" });
    const order = await gate.submit(baseIntent(), "cycle-1");
    assert.equal(order.status, "submitted");
    assert.equal(order.brokerOrderId, "b1");
    assert.equal(order.cycleId, "cycle-1");
    assert.equal(broker.reviewCalls, 1);
    assert.equal(broker.placeCalls, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "order");
  });

  it("queues risk-approved orders for a human in approve mode", async () => {
    const { gate, broker } = setup({ mode: "approve" });
    const pending = await gate.submit(baseIntent());
    assert.equal(pending.status, "pending_approval");
    assert.equal(broker.placeCalls, 0);
    const order = await gate.approve(pending.id);
    assert.equal(order.status, "submitted");
    assert.equal(order.brokerOrderId, "b1");
    assert.equal(broker.placeCalls, 1);
  });

  it("rejects a stale approval when the recheck no longer passes", async () => {
    const { gate, broker, store } = setup({ mode: "approve" });
    store.markEquity(NOW, "2026-11-02", 99_500);
    store.markEquity(NOW, "2026-11-01", 101_000);
    const pending = await gate.submit(baseIntent());
    assert.equal(pending.status, "pending_approval");
    broker.snapshotValue = { ...baseSnapshot(), equity: 90_000 };
    const order = await gate.approve(pending.id);
    assert.equal(order.status, "rejected_risk");
    assert.equal(broker.placeCalls, 0);
  });

  it("rejects orders while the kill switch is engaged", async () => {
    const { gate, store, broker } = setup({ mode: "auto" });
    store.settings = { ...store.settings, killSwitch: true };
    const order = await gate.submit(baseIntent());
    assert.equal(order.status, "rejected_risk");
    assert.ok(order.verdict.checks.some((c) => c.rule === "kill_switch" && !c.ok));
    assert.equal(broker.placeCalls, 0);
  });

  it("stores a failed order when the snapshot throws", async () => {
    const { gate, broker } = setup({ mode: "auto" });
    broker.snapshotError = "robinhood offline";
    const order = await gate.submit(baseIntent());
    assert.equal(order.status, "failed");
    assert.match(order.error ?? "", /robinhood offline/);
    assert.equal(broker.placeCalls, 0);
  });

  it("serializes concurrent submits so only one passes the daily entry cap", async () => {
    const { gate, broker, store } = setup({ mode: "auto" });
    store.settings = {
      ...store.settings,
      risk: { ...store.settings.risk, maxEntriesPerDay: 1 },
    };
    const [first, second] = await Promise.all([gate.submit(baseIntent()), gate.submit(baseIntent())]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, ["rejected_risk", "submitted"]);
    assert.equal(broker.placeCalls, 1);
  });

  it("throws when approving an order that is not pending", async () => {
    const { gate } = setup({ mode: "auto" });
    const submitted = await gate.submit(baseIntent());
    assert.equal(submitted.status, "submitted");
    await assert.rejects(() => gate.approve(submitted.id), /not pending approval/);
  });

  it("expires a pending order when approved the next day", async () => {
    const { gate, broker, setNow } = setup({ mode: "approve" });
    const pending = await gate.submit(baseIntent());
    setNow(NOW + 24 * 3_600_000);
    const order = await gate.approve(pending.id);
    assert.equal(order.status, "expired");
    assert.equal(broker.placeCalls, 0);
  });

  it("persists the drawdown latch when the breaker trips", async () => {
    const { gate, store, broker } = setup({ mode: "auto" });
    store.markEquity(NOW, "2026-11-02", 99_500);
    store.markEquity(NOW, "2026-11-01", 101_000);
    broker.snapshotValue = { ...baseSnapshot(), equity: 90_000 };
    const order = await gate.submit(baseIntent());
    assert.equal(order.status, "rejected_risk");
    assert.ok(order.verdict.checks.some((c) => c.rule === "drawdown" && !c.ok));
    assert.equal(store.settings.drawdownHalted, true);
    assert.ok(store.patchCalls >= 1);
  });

  it("records a user rejection with its reason", async () => {
    const { gate } = setup({ mode: "approve" });
    const pending = await gate.submit(baseIntent());
    const order = await gate.reject(pending.id, "thesis changed");
    assert.equal(order.status, "rejected_user");
    assert.equal(order.error, "thesis changed");
  });

  it("stores a rejected_risk order when market data throws", async () => {
    const failing = new FakeMarketData();
    failing.earningsError = "earnings feed down";
    const { gate, broker } = setup({ mode: "auto", market: failing });
    const order = await gate.submit(baseIntent());
    assert.equal(order.status, "rejected_risk");
    assert.ok(order.verdict.checks.some((c) => c.rule === "earnings_blackout" && !c.ok));
    assert.equal(broker.placeCalls, 0);
  });

  it("halts on the kill switch without calling the broker", async () => {
    const { gate, store, broker } = setup();
    store.settings = { ...store.settings, killSwitch: true };
    const halts = await gate.halts();
    assert.ok(halts.includes("kill_switch"));
    assert.equal(broker.snapshotCalls, 0);
    assert.equal(broker.quoteCalls, 0);
  });
});
