import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { Report, ServerEvent } from "@rh/shared";
import type { ReportServiceDeps } from "./service.ts";
import { createReportExtension } from "./extension.ts";
import type { Store } from "../ports.ts";
import { DEFAULT_SETTINGS } from "@rh/shared";

function serviceDeps(): ReportServiceDeps & { events: ServerEvent[]; reports: Map<string, Report> } {
  const events: ServerEvent[] = [];
  const reports = new Map<string, Report>();
  const store = {
    getSettings: () => structuredClone(DEFAULT_SETTINGS),
    patchSettings: (patch: Parameters<Store["patchSettings"]>[0]) => ({
      ...structuredClone(DEFAULT_SETTINGS),
      ...patch,
      risk: { ...structuredClone(DEFAULT_SETTINGS.risk), ...patch.risk },
      systemOne: { ...DEFAULT_SETTINGS.systemOne, ...patch.systemOne },
    }),
    addJournal: (entry: Parameters<Store["addJournal"]>[0]) => ({ ...entry, id: "j1" }),
    listJournal: () => [],
    addOrder: (order: Parameters<Store["addOrder"]>[0]) => ({ ...order, id: "o1" }),
    updateOrder: (id: string) => {
      throw new Error(`unknown ${id}`);
    },
    getOrder: () => undefined,
    listOrders: () => [],
    ordersSince: () => [],
    markEquity: () => {},
    equityMarks: () => ({}),
    equitySeries: () => [],
    saveReport: (report: Report) => {
      reports.set(report.id, report);
    },
    report: (id: string) => reports.get(id),
    reports: () => [],
  } satisfies Store;
  return {
    store,
    market: {
      history: async (symbol: string) => ({ symbol, bars: [], source: "fake", asOf: 0 }),
      nextEarnings: async () => undefined,
      avgDollarVolume: async () => undefined,
    },
    broker: {
      status: () => ({ state: "disconnected" as const, tools: [] }),
      beginConnect: async () => "",
      completeConnect: async () => {},
      disconnect: async () => {},
      snapshot: async () => {
        throw new Error("not connected");
      },
      quote: async (symbol: string) => ({ symbol, bid: 99, ask: 101, last: 100, at: 0 }),
      reviewOrder: async () => "",
      placeOrder: async () => ({ brokerOrderId: "b1", raw: "" }),
      onChange: () => () => {},
    },
    getAccount: () => null,
    notes: { list: async () => [], read: async () => undefined, write: async () => ({ path: "", size: 0, updatedAt: 0 }) },
    calendar: {
      clock: (now: number) => ({ now, session: "closed" as const, isOpen: false, tradingDay: "2026-10-26", nextOpen: now, nextClose: now, earlyClose: false }),
      etDate: () => "2026-10-26",
      tradingDaysBetween: () => 0,
    },
    clock: { now: () => Date.parse("2026-10-26T20:00:00Z") },
    log: { info: () => {}, warn: () => {}, error: () => {}, child: () => { throw new Error("no child"); } },
    bus: {
      publish: (event: ServerEvent) => {
        events.push(event);
      },
      subscribe: () => () => {},
    },
    currentCycleId: () => "post_close-1",
    events,
    reports,
  };
}

const base = {
  headline: "Flat day, no entries.",
  summary: "No setups met the bar, so no entries.",
  sections: [],
  lessons: [],
  nextSteps: [],
};

const api = {} as never;
const context = { abortSignal: new AbortController().signal } as never;

function tool(deps: ReportServiceDeps): ToolRegistration {
  const ext = createReportExtension(deps);
  assert.equal(ext.name, "reports");
  const found = (ext.tools ?? []).find((t) => (t as { name: string }).name === "publish_report");
  assert.ok(found, "expected publish_report tool");
  return found as unknown as ToolRegistration;
}

describe("publish_report", () => {
  it("publishes_a_daily_report_and_returns_figures_for_the_agent_to_quote", async () => {
    const d = serviceDeps();
    const result = await tool(d).execute({ kind: "daily", ...base }, api, context);
    assert.ok(!result.isError);
    const text = result.output?.map((part) => (part as { text?: string }).text ?? "").join("\n") ?? "";
    assert.match(text, /daily-2026-10-26/);
    assert.match(text, /0 trades closed/);
    assert.equal(d.reports.size, 1);
    assert.equal(d.events.length, 1);
    assert.equal(d.events[0]?.type, "report");
  });

  it("rejects_a_trade_report_without_symbol", async () => {
    const d = serviceDeps();
    const result = await tool(d).execute({ kind: "trade", grade: "B", gradeReason: "Held the plan.", ...base }, api, context);
    assert.equal(result.isError, true);
    const text = result.output?.map((part) => (part as { text?: string }).text ?? "").join("\n") ?? "";
    assert.match(text, /symbol/);
    assert.equal(d.reports.size, 0);
  });

  it("rejects_a_trade_report_without_grade", async () => {
    const d = serviceDeps();
    const result = await tool(d).execute({ kind: "trade", symbol: "NVDA", ...base }, api, context);
    assert.equal(result.isError, true);
    assert.match(
      result.output?.map((part) => (part as { text?: string }).text ?? "").join("\n") ?? "",
      /grade/,
    );
    assert.equal(d.reports.size, 0);
  });

  it("rejects_symbol_on_a_daily_report", async () => {
    const d = serviceDeps();
    const result = await tool(d).execute({ kind: "daily", symbol: "NVDA", ...base }, api, context);
    assert.equal(result.isError, true);
    assert.match(
      result.output?.map((part) => (part as { text?: string }).text ?? "").join("\n") ?? "",
      /Only trade reports take symbol/,
    );
  });

  it("rejects_weekOf_on_a_daily_report", async () => {
    const d = serviceDeps();
    const result = await tool(d).execute({ kind: "weekly", weekOf: "2026-10-26", ...base }, api, context);
    assert.ok(!result.isError, "a weekly report accepts weekOf");
    const bad = await tool(d).execute({ kind: "daily", weekOf: "2026-10-26", ...base }, api, context);
    assert.equal(bad.isError, true);
    assert.match(
      bad.output?.map((part) => (part as { text?: string }).text ?? "").join("\n") ?? "",
      /Only weekly reports take weekOf/,
    );
  });

  it("reports_a_missing_closed_trade_as_an_agent_error", async () => {
    const d = serviceDeps();
    const result = await tool(d).execute(
      { kind: "trade", symbol: "NVDA", grade: "B", gradeReason: "Held the plan.", ...base },
      api,
      context,
    );
    assert.equal(result.isError, true);
    assert.match(
      result.output?.map((part) => (part as { text?: string }).text ?? "").join("\n") ?? "",
      /No closed trade for NVDA/,
    );
  });
});
