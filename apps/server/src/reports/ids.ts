import type { MarketCalendar, Store } from "../ports.ts";
import type { Report, ReportKind, ReportSummary } from "@rh/shared";

/**
 * Deterministic report ids, so republishing a period replaces the old row
 * instead of duplicating it. ET dates are YYYY-MM-DD in America/New_York.
 */

export function dailyReportId(date: string): string {
  return `daily-${date}`;
}

export function weeklyReportId(monday: string): string {
  return `weekly-${monday}`;
}

export function tradeReportId(symbol: string, closedAt: number): string {
  return `trade-${symbol}-${closedAt}`;
}

export type ReportStore = Pick<Store, "report" | "reports" | "saveReport">;

function parseEtDate(date: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`bad ET date: ${date}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** ET date `n` days after `date` (negative goes back). */
export function etAddDays(date: string, n: number): string {
  const { y, m, d } = parseEtDate(date);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  const mo = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");
  return `${t.getUTCFullYear()}-${mo}-${day}`;
}

/** Monday (ET) of the ISO week containing `date`. Weeks start on Monday. */
export function mondayOfWeek(date: string): string {
  // Noon UTC is morning ET on the same ET date, so the UTC weekday is the ET weekday.
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  // Sunday (0) belongs to the week starting 6 days earlier; otherwise back up to Monday.
  return etAddDays(date, weekday === 0 ? -6 : 1 - weekday);
}

/** True when NYSE trades on `date`: probe midday and see if the calendar names it. */
export function isTradingDay(calendar: MarketCalendar, date: string): boolean {
  return calendar.clock(Date.parse(`${date}T12:00:00Z`)).tradingDay === date;
}

/**
 * True when no trading day later in this date's Monday-to-Sunday week trades
 * after it. Computed from the market calendar, so holidays and early closes
 * behave like the scheduler does.
 */
export function isLastTradingDayOfWeek(calendar: MarketCalendar, date: string): boolean {
  const monday = mondayOfWeek(date);
  for (let offset = 0; offset < 7; offset++) {
    const day = etAddDays(monday, offset);
    if (day <= date) continue;
    if (isTradingDay(calendar, day)) return false;
  }
  return true;
}

/** The Monday-to-Sunday ET dates of the week containing `date`. */
export function weekDates(date: string): string[] {
  const monday = mondayOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => etAddDays(monday, i));
}

export function summarizeReport(report: Report): ReportSummary {
  return {
    id: report.id,
    kind: report.kind,
    at: report.at,
    ...(report.symbol === undefined ? {} : { symbol: report.symbol }),
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    headline: report.headline,
    ...(report.grade === undefined ? {} : { grade: report.grade }),
    ...(report.pnl === undefined ? {} : { pnl: report.pnl }),
    ...(report.pnlPct === undefined ? {} : { pnlPct: report.pnlPct }),
  };
}

export function isReportKind(value: unknown): value is ReportKind {
  return value === "daily" || value === "weekly" || value === "trade";
}
