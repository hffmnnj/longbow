import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createNyseCalendar } from "../risk/calendar.ts";
import {
  dailyReportId,
  etAddDays,
  isLastTradingDayOfWeek,
  isReportKind,
  isTradingDay,
  mondayOfWeek,
  summarizeReport,
  tradeReportId,
  weekDates,
  weeklyReportId,
} from "./ids.ts";

const calendar = createNyseCalendar();

describe("report ids", () => {
  it("are_deterministic_per_period", () => {
    assert.equal(dailyReportId("2026-10-26"), "daily-2026-10-26");
    assert.equal(weeklyReportId("2026-10-26"), "weekly-2026-10-26");
    assert.equal(tradeReportId("NVDA", 1_700_000_000_000), "trade-NVDA-1700000000000");
  });
});

describe("ET week helpers", () => {
  it("monday_of_week_starts_on_monday", () => {
    // 2026-10-26 is a Monday.
    assert.equal(mondayOfWeek("2026-10-26"), "2026-10-26");
    assert.equal(mondayOfWeek("2026-10-28"), "2026-10-26");
    assert.equal(mondayOfWeek("2026-11-01"), "2026-10-26");
    assert.equal(mondayOfWeek("2026-10-25"), "2026-10-19");
  });

  it("add_days_crosses_months", () => {
    assert.equal(etAddDays("2026-10-31", 2), "2026-11-02");
    assert.equal(etAddDays("2026-10-26", -7), "2026-10-19");
  });

  it("week_dates_span_monday_to_sunday", () => {
    assert.deepEqual(weekDates("2026-10-28"), [
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });

  it("detects_trading_days_through_the_calendar", () => {
    assert.equal(isTradingDay(calendar, "2026-10-26"), true);
    assert.equal(isTradingDay(calendar, "2026-10-31"), false);
    // Thanksgiving 2026 is a full closure.
    assert.equal(isTradingDay(calendar, "2026-11-26"), false);
    assert.equal(isTradingDay(calendar, "2026-11-27"), true);
  });

  it("last_trading_day_of_week_skips_weekends_and_holidays", () => {
    // Ordinary week: Friday is last, Monday is not.
    assert.equal(isLastTradingDayOfWeek(calendar, "2026-10-30"), true);
    assert.equal(isLastTradingDayOfWeek(calendar, "2026-10-26"), false);
    // Thanksgiving week: Friday still trades, so Wednesday is not last.
    assert.equal(isLastTradingDayOfWeek(calendar, "2026-11-25"), false);
    assert.equal(isLastTradingDayOfWeek(calendar, "2026-11-27"), true);
    // A Saturday is past the week's last session: nothing later trades.
    assert.equal(isLastTradingDayOfWeek(calendar, "2026-10-31"), true);
  });
});

describe("summarizeReport", () => {
  it("keeps_the_summary_shape_with_and_without_optionals", () => {
    const full = summarizeReport({
      id: "daily-2026-10-26",
      kind: "daily",
      at: 1,
      periodStart: "2026-10-26",
      periodEnd: "2026-10-26",
      headline: "Flat.",
      grade: "B",
      pnl: 1.5,
      pnlPct: 0.1,
      narrative: {
        kind: "daily",
        headline: "Flat.",
        summary: "Flat.",
        sections: [],
        lessons: [],
        nextSteps: [],
      },
      facts: {
        periodStart: "2026-10-26",
        periodEnd: "2026-10-26",
        equityCurve: [],
        trades: [],
        realizedPnl: 0,
        orders: { submitted: 0, filled: 0, rejected: 0, cancelled: 0, failed: 0 },
        positions: [],
        decisions: [],
      },
    });
    assert.equal(full.grade, "B");
    assert.equal(full.pnl, 1.5);
    const minimal = summarizeReport({
      id: "daily-2026-10-27",
      kind: "daily",
      at: 1,
      periodStart: "2026-10-27",
      periodEnd: "2026-10-27",
      headline: "Flat.",
      narrative: { kind: "daily", headline: "Flat.", summary: "Flat.", sections: [], lessons: [], nextSteps: [] },
      facts: {
        periodStart: "2026-10-27",
        periodEnd: "2026-10-27",
        equityCurve: [],
        trades: [],
        realizedPnl: 0,
        orders: { submitted: 0, filled: 0, rejected: 0, cancelled: 0, failed: 0 },
        positions: [],
        decisions: [],
      },
    });
    assert.ok(!("grade" in minimal) && !("pnl" in minimal) && !("pnlPct" in minimal) && !("symbol" in minimal));
  });

  it("guards_the_kind_filter", () => {
    assert.equal(isReportKind("daily"), true);
    assert.equal(isReportKind("weekly"), true);
    assert.equal(isReportKind("trade"), true);
    assert.equal(isReportKind("monthly"), false);
    assert.equal(isReportKind(undefined), false);
  });
});
