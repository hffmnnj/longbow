import { describe, expect, it } from "vitest";
import type { Report, ReportFacts, ReportSummary } from "@rh/shared";
import { applyEvent, emptyState } from "./reducer.ts";
import {
  figureStrip,
  groupReportsByWeek,
  planOutcomeRows,
  periodReading,
  reportPeriodShort,
  reportPeriodWords,
  reportToast,
  tradeMarkerDates,
} from "./reports.ts";

const summary = (over: Partial<ReportSummary>): ReportSummary => ({
  id: "r",
  kind: "daily",
  at: 1,
  periodStart: "2026-10-26",
  periodEnd: "2026-10-26",
  headline: "Flat tape",
  ...over,
});

const facts = (over: Partial<ReportFacts>): ReportFacts => ({
  periodStart: "2026-10-26",
  periodEnd: "2026-10-26",
  equityCurve: [],
  trades: [],
  realizedPnl: 0,
  orders: { submitted: 0, filled: 0, rejected: 0, cancelled: 0, failed: 0 },
  positions: [],
  decisions: [],
  ...over,
});

describe("reportPeriodWords", () => {
  it("names the weekday for a daily report", () => {
    expect(reportPeriodWords("daily", "2026-10-26", "2026-10-26")).toBe("Monday, Oct 26");
  });

  it("names the week for a weekly report", () => {
    expect(reportPeriodWords("weekly", "2026-10-26", "2026-10-30")).toBe("Week of Oct 26");
  });

  it("spans the entry to the exit for a trade report", () => {
    expect(reportPeriodWords("trade", "2026-10-06", "2026-10-24")).toBe("Oct 6 – Oct 24");
  });

  it("renders a one-day span as a single date for every kind", () => {
    expect(reportPeriodWords("trade", "2026-09-28", "2026-09-28")).toBe("Mon, Sep 28");
    expect(reportPeriodWords("weekly", "2026-10-26", "2026-10-26")).toBe("Mon, Oct 26");
    expect(reportPeriodWords("daily", "2026-10-26", "2026-10-26")).toBe("Monday, Oct 26");
    expect(reportPeriodShort("trade", "2026-09-28", "2026-09-28")).toBe("Sep 28");
    expect(reportPeriodShort("weekly", "2026-10-26", "2026-10-26")).toBe("Oct 26");
  });

  it("falls back to the raw input when the date is not parseable", () => {
    expect(reportPeriodWords("daily", "soon", "soon")).toBe("soon");
    expect(reportPeriodShort("daily", "soon", "soon")).toBe("soon");
  });
});

describe("figureStrip", () => {
  it("omits undefined figures rather than showing zero", () => {
    const figs = figureStrip(facts({}));
    expect(figs).toEqual([]);
  });

  it("spells out the difference to SPY in both directions", () => {
    const beat = figureStrip(facts({ pnl: 100, pnlPct: 0.4, benchmarkPct: 0.1 }));
    expect(beat.find((f) => f.key === "pnl")?.sub).toBe("+0.40%");
    expect(beat.find((f) => f.key === "spy")?.sub).toBe("beat SPY by 0.30%");
    const trailed = figureStrip(facts({ pnl: -50, pnlPct: -0.2, benchmarkPct: 0.1 }));
    expect(trailed.find((f) => f.key === "spy")?.sub).toBe("trailed SPY by 0.30%");
    const matched = figureStrip(facts({ pnl: 1, pnlPct: 0.1, benchmarkPct: 0.101 }));
    expect(matched.find((f) => f.key === "spy")?.sub).toBe("matched SPY");
  });

  it("keeps trades, win rate, R and heat when present", () => {
    const figs = figureStrip(
      facts({
        trades: [
          { symbol: "MSFT", closedAt: 1, quantity: 1, exitPrice: 2, pnl: 3, source: "harness" },
          { symbol: "XLK", closedAt: 2, quantity: 1, exitPrice: 2, pnl: -1, source: "harness" },
        ],
        winRatePct: 50,
        avgR: 1.2,
        heatPct: 0.62,
      }),
    );
    expect(figs.map((f) => f.key)).toEqual(["trades", "winrate", "avgr", "heat"]);
    expect(figs.find((f) => f.key === "trades")).toMatchObject({ value: "2", sub: "50.00% won" });
    expect(figs.find((f) => f.key === "avgr")?.value).toBe("+1.20R");
  });

  it("shows only the trade's own figures on a trade report", () => {
    const figs = figureStrip(
      facts({
        pnl: -6.73,
        pnlPct: -2.5,
        benchmarkPct: -0.74,
        trades: [
          { symbol: "VRT", closedAt: 1, quantity: 1, exitPrice: 2, pnl: -6.73, source: "robinhood" },
          { symbol: "CEG", closedAt: 2, quantity: 1, exitPrice: 2, pnl: -8.21, source: "robinhood" },
        ],
        realizedPnl: -14.94,
        winRatePct: 0,
        avgR: -0.5,
        heatPct: 2.14,
        trade: {
          trade: {
            symbol: "VRT",
            closedAt: 1,
            quantity: 1,
            exitPrice: 2,
            pnl: -6.73,
            rMultiple: -1,
            holdingDays: 6,
            source: "robinhood",
          },
          bars: [],
        },
      }),
    );
    expect(figs.map((f) => f.key)).toEqual(["pnl", "spy", "r", "holding"]);
    expect(figs.find((f) => f.key === "pnl")).toMatchObject({ value: "−$6.73", sub: "−2.50%" });
    expect(figs.find((f) => f.key === "r")).toMatchObject({ value: "−1.00R", label: "R multiple" });
    expect(figs.find((f) => f.key === "holding")).toMatchObject({ value: "6 days" });
  });

  it("omits the trade's R and holding figures when the plan is unknown", () => {
    const figs = figureStrip(
      facts({
        pnl: -6.73,
        benchmarkPct: -0.74,
        winRatePct: 0,
        heatPct: 2.14,
        trade: {
          trade: { symbol: "VRT", closedAt: 1, quantity: 1, exitPrice: 2, pnl: -6.73, source: "robinhood" },
          bars: [],
        },
      }),
    );
    expect(figs.map((f) => f.key)).toEqual(["pnl", "spy"]);
  });
});

describe("planOutcomeRows", () => {
  type TradeSection = NonNullable<Report["facts"]["trade"]>;
  const tradeReport = (t?: Omit<TradeSection, "bars">): Report => ({
    ...summary({ kind: "trade", symbol: "NVDA" }),
    narrative: {
      kind: "trade",
      headline: "Stopped out",
      summary: "s",
      sections: [],
      lessons: [],
      nextSteps: [],
    },
    facts: facts(t ? { trade: { ...t, bars: [] } } : {}),
  });

  it("returns no rows when the report carries no trade section", () => {
    const rows = planOutcomeRows(tradeReport(undefined));
    expect(rows).toHaveLength(0);
  });

  it("returns the five plan-versus-outcome rows for a planned trade", () => {
    const r = tradeReport({
      trade: {
        symbol: "NVDA",
        closedAt: 2,
        quantity: 12,
        entryPrice: 118.4,
        exitPrice: 111.6,
        pnl: -81.6,
        pnlPct: -5.74,
        rMultiple: -1,
        holdingDays: 6,
        source: "harness",
      },
      plan: {
        thesis: "t",
        invalidationPrice: 112,
        timeStopDate: "2026-11-13",
        probabilityWin: 0.64,
        expectedGainPct: 8.2,
        expectedLossPct: 5.4,
      },
    });
    const rows = planOutcomeRows(r);
    expect(rows.map((x) => x.label)).toEqual(["Target gain", "Loss to stop", "Stated odds", "Stop", "Time stop"]);
    expect(rows[0]).toMatchObject({ planned: "+8.20%", realized: "−$81.60 (−5.74%)" });
    expect(rows[1]).toMatchObject({ planned: "5.40%", realized: "−1.0R" });
    expect(rows[2]).toMatchObject({ planned: "64%", realized: "Stopped out" });
    expect(rows[3]).toMatchObject({ planned: "$112.00", realized: "Exited $111.60" });
    expect(rows[4]).toMatchObject({ planned: "Nov 13", realized: "6 days held" });
  });

  it("shows only known outcomes with no stop-out claim when the entry carried no plan", () => {
    const r = tradeReport({
      trade: {
        symbol: "XLE",
        closedAt: 2,
        quantity: 25,
        entryPrice: 92.1,
        exitPrice: 91.62,
        pnl: -12,
        source: "robinhood",
      },
    });
    const rows = planOutcomeRows(r);
    expect(rows.map((x) => x.label)).toEqual(["Realized P&L", "Exit price"]);
    expect(rows[0]).toMatchObject({ planned: "—", realized: "−$12.00" });
    expect(rows[1]).toMatchObject({ planned: "—", realized: "$91.62" });
    expect(rows.some((x) => /stop/i.test(x.realized))).toBe(false);
  });

  it("adds the holding period when it is known and there is no plan", () => {
    const r = tradeReport({
      trade: {
        symbol: "VRT",
        closedAt: 2,
        quantity: 1,
        exitPrice: 253.25,
        pnl: -6.73,
        holdingDays: 6,
        source: "robinhood",
      },
    });
    const rows = planOutcomeRows(r);
    expect(rows.map((x) => x.label)).toEqual(["Realized P&L", "Exit price", "Holding period"]);
    expect(rows[2]).toMatchObject({ planned: "—", realized: "6 days held" });
  });
});

describe("groupReportsByWeek", () => {
  it("groups by the week of the period start, newest week first", () => {
    const groups = groupReportsByWeek([
      summary({ id: "b", at: 2, periodStart: "2026-10-20", periodEnd: "2026-10-20" }),
      summary({ id: "a", at: 3, kind: "weekly", periodStart: "2026-10-26", periodEnd: "2026-10-30" }),
      summary({ id: "c", at: 1, kind: "trade", symbol: "NVDA", periodStart: "2026-10-27", periodEnd: "2026-11-02" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Week of Oct 26", "Week of Oct 19"]);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("collects undated reports in a group at the end", () => {
    const groups = groupReportsByWeek([summary({ id: "x", periodStart: "never" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Undated");
  });
});

describe("periodReading", () => {
  it("reads the period move against SPY", () => {
    expect(periodReading(facts({ pnlPct: 1, benchmarkPct: 0.6, periodStart: "2026-10-26" }))).toBe(
      "Up 1.00% vs SPY's +0.60% since Oct 26",
    );
    expect(periodReading(facts({ pnlPct: -0.2, periodStart: "2026-10-26" }))).toBe("Down 0.20% since Oct 26");
    expect(periodReading(facts({}))).toBeUndefined();
  });
});

describe("reportToast", () => {
  it("names the kind, and the symbol for trade reports", () => {
    expect(reportToast(summary({ kind: "daily", headline: "h" })).title).toBe("Daily report ready");
    expect(reportToast(summary({ kind: "weekly", headline: "h" })).title).toBe("Weekly report ready");
    expect(reportToast(summary({ kind: "trade", symbol: "NVDA", headline: "h" })).title).toBe("Trade report · NVDA");
  });
});

describe("tradeMarkerDates", () => {
  const bars = [{ date: "2026-10-01" }, { date: "2026-10-02" }, { date: "2026-10-05" }, { date: "2026-10-06" }];
  const ms = (iso: string) => Date.parse(`${iso}T14:00:00-04:00`);

  it("resolves entry, exit and the time stop onto bar dates", () => {
    expect(tradeMarkerDates(bars, ms("2026-10-01"), ms("2026-10-06"), "2026-10-05")).toEqual({
      entry: "2026-10-01",
      exit: "2026-10-06",
      timeStop: "2026-10-05",
    });
  });

  it("clamps stamps outside the bar range and drops a time stop past the last bar", () => {
    expect(tradeMarkerDates(bars, ms("2026-09-20"), ms("2026-11-01"), "2026-11-01")).toEqual({
      entry: "2026-10-01",
      exit: "2026-10-06",
      timeStop: undefined,
    });
  });

  it("omits the entry marker when the entry date is unknown", () => {
    expect(tradeMarkerDates(bars, undefined, ms("2026-10-06"))).toEqual({
      entry: undefined,
      exit: "2026-10-06",
      timeStop: undefined,
    });
  });
});

describe("report live events", () => {
  it("upserts reports newest first and updates in place", () => {
    let s = emptyState();
    s = applyEvent(s, { type: "report", report: summary({ id: "a", at: 1, headline: "old" }) });
    s = applyEvent(s, { type: "report", report: summary({ id: "b", at: 2 }) });
    s = applyEvent(s, { type: "report", report: summary({ id: "a", at: 1, headline: "new" }) });
    expect(s.reports.map((r) => r.id)).toEqual(["b", "a"]);
    expect(s.reports[1]?.headline).toBe("new");
  });

  it("ignores simulation report events like every other sim event", () => {
    let s = emptyState();
    s = applyEvent(s, { type: "report", report: summary({ id: "a", at: 1 }), simRunId: "sim-1" });
    expect(s.reports).toEqual([]);
  });
});
