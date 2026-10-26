import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  type JournalEntry,
  type OrderRecord,
  type Report,
  type ReportNarrative,
  type ServerEvent,
} from "@rh/shared";
import type { Broker, Clock, EventBus, Logger, MarketData, Notes, Store } from "../ports.ts";
import { createNyseCalendar } from "../risk/calendar.ts";
import { publishReport, ensureDailyReport, type ReportServiceDeps } from "./service.ts";

const log: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => log };
const calendar = createNyseCalendar();
const NOW = Date.parse("2026-10-26T20:00:00Z");

interface State {
  journals: JournalEntry[];
  orders: OrderRecord[];
  marks: { etDate: string; dayStart: number; dayHigh: number; dayLast: number }[];
  reports: Map<string, Report>;
}

function deps(state: State): ReportServiceDeps {
  const store: Store = {
    getSettings: () => structuredClone(DEFAULT_SETTINGS),
    patchSettings: (patch) => ({ ...structuredClone(DEFAULT_SETTINGS), ...patch, risk: { ...structuredClone(DEFAULT_SETTINGS.risk), ...patch.risk } }),
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
    updateOrder: () => {
      throw new Error("unknown");
    },
    getOrder: (id) => state.orders.find((o) => o.id === id),
    listOrders: (limit) => [...state.orders].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit),
    ordersSince: (since) => state.orders.filter((o) => o.createdAt >= since).sort((a, b) => a.createdAt - b.createdAt),
    markEquity: () => {},
    equityMarks: () => ({}),
    equitySeries: () => [...state.marks].sort((a, b) => (a.etDate < b.etDate ? -1 : 1)),
    saveReport: (report) => {
      state.reports.set(report.id, report);
    },
    report: (id) => state.reports.get(id),
    reports: (query) =>
      [...state.reports.values()]
        .filter((r) => query.kind === undefined || r.kind === query.kind)
        .sort((a, b) => b.at - a.at)
        .slice(0, query.limit)
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          at: r.at,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          headline: r.headline,
        })),
  };
  const market: MarketData = {
    history: async (symbol) => ({ symbol, bars: [], source: "fake", asOf: NOW }),
    nextEarnings: async () => undefined,
    avgDollarVolume: async () => undefined,
  };
  const broker: Broker = {
    status: () => ({ state: "disconnected", tools: [] }),
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
  };
  const notes: Notes = { list: async () => [], read: async () => undefined, write: async () => ({ path: "", size: 0, updatedAt: 0 }) };
  const clock: Clock = { now: () => NOW };
  const events: ServerEvent[] = [];
  const bus: EventBus = {
    publish: (event) => {
      events.push(event);
    },
    subscribe: () => () => {},
  };
  return { store, market, broker, getAccount: () => null, notes, calendar, clock, log, bus, currentCycleId: () => "post_close-1", _events: events } as ReportServiceDeps & {
    _events: ServerEvent[];
  };
}

function eventsOf(d: ReportServiceDeps): ServerEvent[] {
  return (d as unknown as { _events: ServerEvent[] })._events;
}

const dailyNarrative: ReportNarrative = {
  kind: "daily",
  headline: "Flat day, no entries.",
  summary: "No setups met the bar, so no entries.",
  sections: [{ title: "Market", body: "Sideways." }],
  lessons: [],
  nextSteps: ["Carry the watchlist into tomorrow."],
};

function state(): State {
  return { journals: [], orders: [], marks: [{ etDate: "2026-10-26", dayStart: 1000, dayHigh: 1000, dayLast: 1010 }], reports: new Map() };
}

describe("publishReport", () => {
  it("publishes_a_daily_report_with_server_figures_and_a_live_event", async () => {
    const d = deps(state());
    const { report, text } = await publishReport(d, dailyNarrative);
    assert.equal(report.id, "daily-2026-10-26");
    assert.equal(report.kind, "daily");
    assert.equal(report.pnl, 10);
    assert.equal(report.pnlPct, 1);
    assert.equal(report.cycleId, "post_close-1");
    const stored = d.store.report("daily-2026-10-26");
    assert.deepEqual(stored, report);
    assert.equal(eventsOf(d).length, 1);
    const event = eventsOf(d)[0];
    assert.equal(event?.type, "report");
    assert.equal((event as { report: { id: string } }).report.id, "daily-2026-10-26");
    assert.ok(!("simRunId" in (event as Record<string, unknown>)));
    assert.match(text, /daily-2026-10-26/);
    assert.match(text, /2026-10-26 to 2026-10-26/);
    assert.match(text, /\+\$10\.00/);
    assert.match(text, /0 trades closed/);
  });

  it("replaces_a_republished_period_instead_of_duplicating", async () => {
    const s = state();
    const d = deps(s);
    await publishReport(d, dailyNarrative);
    await publishReport(d, { ...dailyNarrative, headline: "Updated headline." });
    assert.equal(s.reports.size, 1);
    assert.equal(d.store.report("daily-2026-10-26")?.headline, "Updated headline.");
    assert.equal(d.store.report("daily-2026-10-26")?.narrative.summary, dailyNarrative.summary);
  });

  it("rejects_a_trade_report_without_symbol_or_grade", async () => {
    const d = deps(state());
    const noSymbol: ReportNarrative = {
      kind: "trade",
      headline: "Sold.",
      summary: "Sold.",
      grade: "B",
      gradeReason: "Followed the plan.",
      sections: [],
      lessons: [],
      nextSteps: [],
    };
    await assert.rejects(() => publishReport(d, noSymbol), /needs symbol/);
    const noGrade: ReportNarrative = { ...noSymbol, symbol: "NVDA" };
    delete (noGrade as Partial<ReportNarrative>).grade;
    await assert.rejects(() => publishReport(d, noGrade), /needs grade/);
    // Nothing stored, nothing published.
    assert.equal(d.store.report("trade-NVDA-0"), undefined);
    assert.equal(eventsOf(d).length, 0);
  });

  it("rejects_symbol_or_weekOf_on_the_wrong_kind", async () => {
    const d = deps(state());
    await assert.rejects(() => publishReport(d, { ...dailyNarrative, symbol: "NVDA" }), /Only trade reports take symbol/);
    await assert.rejects(() => publishReport(d, { ...dailyNarrative, weekOf: "2026-10-26" }), /Only weekly reports take weekOf/);
    assert.equal(eventsOf(d).length, 0);
  });
});

describe("ensureDailyReport safety net", () => {
  it("leaves_an_existing_agent_report_alone", async () => {
    const d = deps(state());
    await publishReport(d, dailyNarrative);
    const before = eventsOf(d).length;
    const kept = await ensureDailyReport(d, "2026-10-26");
    assert.equal(kept?.headline, dailyNarrative.headline);
    assert.equal(eventsOf(d).length, before);
  });

  it("publishes_a_minimal_report_from_the_post_close_review", async () => {
    const d = deps(state());
    d.store.addJournal({
      at: NOW,
      cycleId: "post_close_2026-10-26",
      action: "hold",
      summary: "Flat day, no entries. Awaiting breakout.",
      rationale: "No setups met the bar, so the protocol says hold.",
      evidence: [],
    });
    const created = await ensureDailyReport(d, "2026-10-26");
    assert.equal(created?.id, "daily-2026-10-26");
    assert.equal(created?.headline, "Flat day, no entries. Awaiting breakout.");
    assert.ok(created?.narrative.summary.includes("No setups met the bar"));
    assert.deepEqual(created?.narrative.sections, []);
    assert.equal(created?.grade, undefined);
    assert.equal(created?.pnl, 10);
    // Stored and announced like any other report.
    assert.deepEqual(d.store.report("daily-2026-10-26"), created);
    assert.equal(eventsOf(d).length, 1);
  });

  it("falls_back_to_a_placeholder_when_the_agent_never_journaled", async () => {
    const d = deps(state());
    const created = await ensureDailyReport(d, "2026-10-26");
    assert.equal(created?.headline, "No daily report from the agent today.");
    assert.equal(created?.narrative.summary, "No daily report from the agent today.");
    assert.equal(eventsOf(d).length, 1);
  });
});
