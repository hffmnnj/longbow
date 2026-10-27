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
  type Report,
  type ReportKind,
  type ReportSummary,
  type ServerEvent,
  type Settings,
  type SettingsPatch,
} from "@rh/shared";
import { createOrderGate } from "./gate.ts";
import { createNyseCalendar } from "./calendar.ts";
import { watchStops } from "./stops.ts";
import type { Broker, Clock, EventBus, Logger, MarketData, Store } from "../ports.ts";
import type { SectorDirectory } from "../market/sectors.ts";

const NOW = Date.UTC(2026, 10, 2, 15, 5, 0);

function baseIntent(): OrderIntent {
  return {
    symbol: "AAPL",
    side: "buy",
    quantity: 3,
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
      systemOne: { ...this.settings.systemOne, ...patch.systemOne },
      crypto: { ...this.settings.crypto, ...patch.crypto },
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
  equitySeries(): { etDate: string; dayStart: number; dayHigh: number; dayLast: number }[] {
    return [...this.marks]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([etDate, equities]) => ({ etDate, dayStart: equities[0] ?? 0, dayHigh: Math.max(...equities), dayLast: equities.at(-1) ?? 0 }));
  }
  saveReport(_report: Report): void {}
  report(_id: string): Report | undefined {
    return undefined;
  }
  reports(_query: { kind?: ReportKind; limit: number }): ReportSummary[] {
    return [];
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

function setup(options?: {
  mode?: Settings["mode"];
  market?: MarketData | null;
  sectors?: SectorDirectory;
  systemOne?: Settings["systemOne"];
  entryReview?: Parameters<typeof createOrderGate>[0]["entryReview"];
}) {
  const store = new FakeStore();
  if (options?.mode !== undefined) store.settings = { ...store.settings, mode: options.mode };
  if (options?.systemOne !== undefined) store.settings = { ...store.settings, systemOne: options.systemOne };
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
    ...(options?.sectors === undefined ? {} : { sectors: options.sectors }),
    ...(options?.entryReview === undefined ? {} : { entryReview: options.entryReview }),
  });
  return { store, broker, gate, events, market, setNow: (t: number) => (now = t) };
}

function liveSetup() {
  const fixture = setup({ mode: "auto" });
  const executions: Array<{ intent: OrderIntent; refId: string }> = [];
  const cancellations: string[] = [];
  const broker = Object.assign(fixture.broker, {
    quotes: async (symbols: string[]) => Promise.all(symbols.map((s) => fixture.broker.quote(s))),
    cancelOrder: async (id: string) => { cancellations.push(id); },
    orderState: async (_id: string): Promise<Partial<OrderRecord>> => ({ status: "filled", filledQuantity: executions.at(-1)?.intent.quantity ?? 0, averageFillPrice: 139 }),
    executeStop: async (intent: OrderIntent, refId: string) => {
      const order = fixture.store.ordersSince(0).find((o) => o.status === "triggering");
      assert.ok(order, "the fire-once transition must be persisted before broker execution");
      executions.push({ intent, refId });
      return { brokerOrderId: "stop-broker-id", raw: "{}" };
    },
  });
  broker.snapshotValue.positions[0] = { symbol: "AAPL", quantity: 0.832971, sharesAvailableForSells: 0.832971, averageCost: 145, marketValue: 124.94565, unrealizedPnl: 0 };
  const stop = { ...baseIntent(), side: "sell" as const, quantity: 0.832971, orderType: "stop_limit" as const, limitPrice: 139.3, stopPrice: 140, invalidationPrice: 140, timeInForce: "gtc" as const };
  return { ...fixture, broker, executions, cancellations, stop };
}

describe("sector cap with broker positions that carry no sector", () => {
  it("counts held exposure through the sector directory", async () => {
    const resolved: string[][] = [];
    const sectors: SectorDirectory = {
      get: (symbol) => (symbol === "AAPL" || symbol === "NVDA" ? "Technology" : undefined),
      resolve: async (symbols) => {
        resolved.push([...symbols]);
      },
    };
    const { gate, broker, store } = setup({ mode: "auto", sectors });
    const cap = store.settings.risk.maxSectorPct;
    // Robinhood reports no sector; the held AAPL already fills the Technology allowance.
    broker.snapshotValue.positions[0] = { symbol: "AAPL", quantity: 400, averageCost: 145, marketValue: 100_000 * (cap / 100), unrealizedPnl: 0 };
    const order = await gate.submit({ ...baseIntent(), symbol: "NVDA" });
    const check = order.verdict.checks.find((c) => c.rule === "sector");
    assert.equal(check?.ok, false, JSON.stringify(check));
    assert.deepEqual(resolved[0], ["NVDA", "AAPL"]);
  });
});

describe("harness-held fractional protection", () => {
  it("stores approved fractional stops without sending a Robinhood review or placement", async () => {
    const { gate, broker, stop, events } = liveSetup();
    const order = await gate.submit(stop);
    assert.equal(order.status, "held", JSON.stringify(order.verdict));
    assert.equal(broker.placeCalls, 0); assert.equal(broker.reviewCalls, 0);
    assert.ok(events.some((e) => e.type === "journal" && e.entry.orderId === order.id));
  });
  it("claims before execution, sells min(quantity, available) once, and syncs the fill", async () => {
    const { gate, broker, store, stop, executions } = liveSetup();
    const order = await gate.submit(stop);
    assert.equal(order.status, "held");
    broker.snapshotValue.positions[0]!.sharesAvailableForSells = 0.205652;
    broker.quoteValue = { ...baseQuote(), bid: 138.99, ask: 139.01, last: 139 };
    await Promise.all([gate.tick(), gate.tick()]);
    assert.equal(executions.length, 1); assert.equal(executions[0]!.intent.quantity, 0.205652);
    assert.match(executions[0]!.refId, /^[a-f0-9-]{36}$/);
    assert.equal(store.getOrder(order.id)?.status, "filled"); assert.equal(store.getOrder(order.id)?.brokerOrderId, "stop-broker-id");
    assert.equal(store.getOrder(order.id)?.filledQuantity, 0.205652);
  });
  it("persists the fire-once claim across overlapping watcher invocations", async () => {
    const f = liveSetup();
    const order = await f.gate.submit(f.stop);
    f.broker.quoteValue = { ...baseQuote(), last: 139 };
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const entering = new Promise<void>((resolve) => { entered = resolve; });
    let count = 0;
    f.broker.executeStop = async () => { count++; entered(); await wait; return { brokerOrderId: "stop-id", raw: "{}" }; };
    const deps = { broker: f.broker, store: f.store, clock: { now: () => NOW }, calendar: createNyseCalendar(), bus: { publish: (_e: ServerEvent) => {}, subscribe: () => () => {} } };
    const first = watchStops(deps);
    await entering;
    assert.equal(f.store.getOrder(order.id)?.status, "triggering");
    await watchStops(deps);
    assert.equal(count, 1);
    release(); await first;
  });
  it("never triggers outside regular hours, above the stop, or under the kill switch", async () => {
    const f = liveSetup();
    await f.gate.submit(f.stop);
    await f.gate.tick(); assert.equal(f.executions.length, 0);
    f.broker.quoteValue = { ...baseQuote(), last: 139 };
    f.setNow(Date.UTC(2026, 10, 2, 22)); await f.gate.tick(); assert.equal(f.executions.length, 0);
    f.setNow(NOW); f.store.settings.killSwitch = true; await f.gate.tick(); assert.equal(f.executions.length, 0);
    f.store.settings.killSwitch = false; f.store.settings.drawdownHalted = true;
    await f.gate.tick(); assert.equal(f.executions.length, 1);
  });
  it("fails without selling unavailable shares and never retries an uncertain stop", async () => {
    const f = liveSetup(); const order = await f.gate.submit(f.stop);
    f.broker.quoteValue = { ...baseQuote(), last: 139 };
    f.broker.snapshotValue.positions[0]!.sharesAvailableForSells = 0;
    await f.gate.tick(); await f.gate.tick();
    assert.equal(f.executions.length, 0); assert.equal(f.store.getOrder(order.id)?.status, "failed");
    assert.match(f.store.getOrder(order.id)?.error ?? "", /No unreserved shares/);
  });
  it("cancels held stops locally and broker orders by saved broker id", async () => {
    const f = liveSetup(); const held = await f.gate.submit(f.stop);
    assert.equal((await f.gate.cancel(held.id)).status, "cancelled"); assert.deepEqual(f.cancellations, []);
    const submitted = f.store.addOrder({ createdAt: NOW, updatedAt: NOW, intent: baseIntent(), verdict: { approved: true, isExit: false, checks: [] }, status: "submitted", brokerOrderId: "real-broker-id" });
    f.broker.orderState = async () => ({ status: "cancelled", filledQuantity: 0 });
    assert.equal((await f.gate.cancel(submitted.id)).status, "cancelled"); assert.deepEqual(f.cancellations, ["real-broker-id"]);
  });
  it("cancels held protection automatically before a plain sell", async () => {
    const f = liveSetup(); const held = await f.gate.submit(f.stop);
    const sell = await f.gate.submit({ ...f.stop, orderType: "limit", limitPrice: 150, invalidationPrice: 160 });
    assert.equal(sell.status, "submitted", JSON.stringify(sell.verdict));
    assert.equal(f.store.getOrder(held.id)?.status, "cancelled"); assert.equal(f.broker.placeCalls, 1);
  });
});

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
    assert.equal(store.settings.drawdownHaltedMonth, "2026-11");
    assert.ok(store.patchCalls >= 1);
  });

  it("clears the drawdown halt itself when the ET month changes", async () => {
    const { gate, store, broker, setNow } = setup({ mode: "auto" });
    store.settings = { ...store.settings, drawdownHalted: true, drawdownHaltedMonth: "2026-11" };
    // Monday 2026-12-01 10:05 ET, in the regular session of the next month.
    const dec1 = Date.UTC(2026, 11, 1, 15, 5, 0);
    setNow(dec1);
    broker.quoteValue = { ...broker.quoteValue, at: dec1 };
    const order = await gate.submit(baseIntent());
    assert.equal(order.status, "submitted");
    assert.equal(store.settings.drawdownHalted, false);
    assert.equal(store.settings.drawdownHaltedMonth, "2026-11");

    // The halts() path clears a stale halt the same way.
    store.settings = { ...store.settings, drawdownHalted: true, drawdownHaltedMonth: "2026-11" };
    const halts = await gate.halts();
    assert.ok(!halts.includes("drawdown"));
    assert.equal(store.settings.drawdownHalted, false);
  });

  it("stamps a legacy halt without a month instead of clearing it", async () => {
    const { gate, store } = setup({ mode: "auto" });
    store.settings = { ...store.settings, drawdownHalted: true, drawdownHaltedMonth: undefined };
    const order = await gate.submit(baseIntent());
    assert.equal(order.status, "rejected_risk");
    assert.ok(order.verdict.checks.some((c) => c.rule === "drawdown" && !c.ok));
    assert.equal(store.settings.drawdownHalted, true);
    assert.equal(store.settings.drawdownHaltedMonth, "2026-11");
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

describe("identical-retry guard", () => {
  it("refuses an identical retry within 30 minutes without a new order and names the failed rules", async () => {
    const { gate, store, broker } = setup({ mode: "auto" });
    store.settings = { ...store.settings, killSwitch: true };
    const first = await gate.submit(baseIntent());
    assert.equal(first.status, "rejected_risk");
    assert.ok(first.verdict.checks.some((c) => c.rule === "kill_switch" && !c.ok));
    const snapshotCalls = broker.snapshotCalls;
    const retry = await gate.submit({ ...baseIntent() });
    assert.equal(retry.id, first.id);
    assert.equal(retry.status, "rejected_risk");
    assert.match(
      retry.error ?? "",
      /Identical to order order-1 rejected at \d{2}:\d{2} ET for kill_switch\. Change the input that failed instead of retrying\./,
    );
    assert.equal(store.orders.size, 1);
    assert.equal(broker.snapshotCalls, snapshotCalls);
  });

  it("evaluates a retry with a changed limit price normally", async () => {
    const { gate, store, broker } = setup({ mode: "auto" });
    store.settings = { ...store.settings, killSwitch: true };
    const first = await gate.submit(baseIntent());
    const changed = await gate.submit({ ...baseIntent(), limitPrice: 151 });
    assert.notEqual(changed.id, first.id);
    assert.equal(changed.status, "rejected_risk");
    assert.equal(changed.error, undefined);
    assert.equal(store.orders.size, 2);
    assert.equal(broker.snapshotCalls, 2);
  });

  it("treats a sub-cent price difference as the same order", async () => {
    const { gate, store, broker } = setup({ mode: "auto" });
    store.settings = { ...store.settings, killSwitch: true };
    const first = await gate.submit(baseIntent());
    const retry = await gate.submit({ ...baseIntent(), limitPrice: 150.004 });
    assert.equal(retry.id, first.id);
    assert.match(retry.error ?? "", /Identical to order order-1/);
    assert.equal(store.orders.size, 1);
    assert.equal(broker.snapshotCalls, 1);
  });

  it("evaluates an identical retry after 31 minutes normally", async () => {
    const { gate, store, broker, setNow } = setup({ mode: "auto" });
    store.settings = { ...store.settings, killSwitch: true };
    const first = await gate.submit(baseIntent());
    setNow(NOW + 31 * 60_000);
    const retry = await gate.submit({ ...baseIntent() });
    assert.notEqual(retry.id, first.id);
    assert.equal(retry.status, "rejected_risk");
    assert.equal(store.orders.size, 2);
    assert.equal(broker.snapshotCalls, 2);
  });

  it("blocks only the exact duplicate of a rejected exit", async () => {
    const { gate, store, broker } = setup({ mode: "auto" });
    store.settings = { ...store.settings, killSwitch: true };
    const exit = { ...baseIntent(), side: "sell" as const, quantity: 5, invalidationPrice: 160 };
    const first = await gate.submit(exit);
    assert.equal(first.status, "rejected_risk");
    const retry = await gate.submit({ ...exit });
    assert.equal(retry.id, first.id);
    assert.match(retry.error ?? "", /Identical to order/);
    assert.equal(store.orders.size, 1);
    const snapshotCalls = broker.snapshotCalls;
    const changedQty = await gate.submit({ ...exit, quantity: 6 });
    assert.notEqual(changedQty.id, first.id);
    assert.equal(broker.snapshotCalls, snapshotCalls + 1);
  });
});

describe("system one entry review", () => {
  const concern = async () => ({ rule: "system_one", ok: false, detail: "concern: supported 0.10" });
  const passing = async () => ({ rule: "system_one", ok: true, detail: "clear" });

  it("appends a passing system_one check and still places the order", async () => {
    const { gate, broker } = setup({ mode: "auto", entryReview: passing });
    const order = await gate.submit(baseIntent());
    assert.equal(order.status, "submitted");
    assert.equal(order.verdict.checks.at(-1)?.rule, "system_one");
    assert.equal(broker.placeCalls, 1);
  });

  it("rejects an engine-approved entry when the review fails its check, naming it", async () => {
    const { gate, broker } = setup({ mode: "auto", systemOne: { enabled: true, gate: "block" }, entryReview: concern });
    const order = await gate.submit(baseIntent());
    assert.equal(order.status, "rejected_risk");
    assert.equal(order.verdict.approved, false);
    assert.deepEqual(order.verdict.checks.filter((c) => !c.ok).map((c) => c.rule), ["system_one"]);
    assert.equal(broker.placeCalls, 0);
  });

  it("skips the review when disabled or when the gate is off", async () => {
    for (const systemOne of [{ enabled: false, gate: "block" as const }, { enabled: true, gate: "off" as const }]) {
      let calls = 0;
      const { gate } = setup({ mode: "auto", systemOne, entryReview: async () => { calls += 1; return concern(); } });
      const order = await gate.submit(baseIntent());
      assert.equal(order.status, "submitted");
      assert.equal(calls, 0);
    }
  });

  it("never reviews exits", async () => {
    let calls = 0;
    const { gate } = setup({ mode: "auto", systemOne: { enabled: true, gate: "block" }, entryReview: async () => { calls += 1; return concern(); } });
    const sell = { ...baseIntent(), side: "sell" as const, quantity: 2, invalidationPrice: 160 };
    const order = await gate.submit(sell);
    assert.equal(calls, 0);
    assert.ok(order.verdict.checks.every((c) => c.rule !== "system_one"));
  });

  it("fails open when the review throws", async () => {
    const { gate } = setup({ mode: "auto", systemOne: { enabled: true, gate: "block" }, entryReview: async () => { throw new Error("boom"); } });
    const order = await gate.submit(baseIntent());
    assert.equal(order.status, "submitted");
  });

  it("cannot approve an entry the engine rejected, and does not call the model for it", async () => {
    let calls = 0;
    const { gate } = setup({ mode: "auto", entryReview: async () => { calls += 1; return passing(); } });
    const order = await gate.submit({ ...baseIntent(), quantity: 100_000 });
    assert.equal(order.status, "rejected_risk");
    assert.equal(calls, 0);
  });
});

describe("crypto protection rests natively at Robinhood", () => {
  function cryptoSetup() {
    const f = liveSetup();
    f.broker.snapshotValue = { ...baseSnapshot(), equity: 1235, cash: 665, buyingPower: 665, cryptoBuyingPower: 665, settledCash: undefined,
      positions: [{ symbol: "BTC-USD", quantity: 0.0005, sharesAvailableForSells: 0.0005, averageCost: 80_000, marketValue: 40, unrealizedPnl: 0, sector: "Crypto" }] };
    f.broker.quoteValue = { ...baseQuote(), symbol: "BTC-USD", bid: 79_300, ask: 80_800, last: 80_050 };
    const base = { ...baseIntent(), symbol: "BTC-USD", side: "sell" as const, quantity: 0.0005, limitPrice: 79_400, invalidationPrice: 85_000, timeInForce: "gtc" as const,
      expectedGainPct: 15, expectedLossPct: 6, estimatedCostPct: 2, probabilityWin: 0.6, timeStopDate: "2026-11-20" };
    return { ...f, base };
  }

  it("sends a fractional crypto stop to the broker instead of holding it", async () => {
    const { gate, broker, base } = cryptoSetup();
    const order = await gate.submit({ ...base, orderType: "stop_limit", stopPrice: 79_000, limitPrice: 78_500 });
    assert.equal(order.status, "submitted", JSON.stringify(order.verdict.checks.filter((c) => !c.ok)));
    assert.equal(broker.placeCalls, 1);
  });

  it("submits above-cap BTC protective stops and full exits through the gate", async () => {
    for (const orderType of ["limit", "stop_limit"] as const) {
      const { gate, broker, store, base } = cryptoSetup();
      store.settings.crypto.maxOrderNotionalUsd = 40;
      broker.snapshotValue.positions[0] = { symbol: "BTC-USD", quantity: 0.0006, sharesAvailableForSells: 0.0006, averageCost: 80_000, marketValue: 48, unrealizedPnl: 0 };
      const intent = orderType === "limit"
        ? { ...base, quantity: 0.0006, orderType }
        : { ...base, quantity: 0.0006, orderType, stopPrice: 79_000, limitPrice: 78_500 };
      const order = await gate.submit(intent);
      assert.equal(order.status, "submitted", JSON.stringify(order.verdict.checks.filter((c) => !c.ok)));
      assert.equal(order.verdict.isExit, true);
      assert.equal(order.verdict.maxQuantity, undefined);
      assert.equal(broker.reviewCalls, 1);
      assert.equal(broker.placeCalls, 1);
      assert.equal(broker.lastPlaced?.quantity, 0.0006);
    }
  });

  it("cancels the resting crypto stop before an exit by limit", async () => {
    const { gate, broker, cancellations, base } = cryptoSetup();
    const stop = await gate.submit({ ...base, orderType: "stop_limit", stopPrice: 79_000, limitPrice: 78_500 });
    const exit = await gate.submit({ ...base, orderType: "limit" });
    assert.equal(exit.status, "submitted", JSON.stringify(exit.verdict.checks.filter((c) => !c.ok)));
    assert.deepEqual(cancellations, [stop.id].map(() => stop.brokerOrderId));
    assert.equal(broker.placeCalls, 2);
  });
});
