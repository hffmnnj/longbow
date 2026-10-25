import type { Report, ReportFacts, ReportKind, ReportSummary } from "@rh/shared";
import { isoDay, isoShort, pct, pctSigned, tone, usd, usdSigned } from "./format.ts";

/** Pure presentational helpers for the Reports surface. Everything here is unit-tested in reports.test.ts. */

export const KIND_LABEL: Record<ReportKind, string> = { daily: "Daily", weekly: "Weekly", trade: "Trade" };

const weekdayLong = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" });
const monthDay = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

function parsed(iso: string): Date | null {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const shortDate = (iso: string): string => {
  const d = parsed(iso);
  return d ? monthDay.format(d) : iso;
};

/** "Monday, Oct 26", "Week of Oct 26", or "Oct 6 – Oct 24". Raw input back when it is not a date. */
export function reportPeriodWords(kind: ReportKind, periodStart: string, periodEnd: string): string {
  if (kind === "daily") {
    const d = parsed(periodStart);
    return d ? `${weekdayLong.format(d)}, ${monthDay.format(d)}` : periodStart;
  }
  // A one-day span renders as a single date, whatever the kind.
  if (periodStart === periodEnd) return isoDay(periodStart);
  if (kind === "weekly") return `Week of ${shortDate(periodStart)}`;
  return `${shortDate(periodStart)} – ${shortDate(periodEnd)}`;
}

/** Short period for list rows: one date for daily reports, a range otherwise. */
export function reportPeriodShort(kind: ReportKind, periodStart: string, periodEnd: string): string {
  if (kind === "daily") return isoDay(periodStart);
  if (periodStart === periodEnd) return isoShort(periodStart);
  return `${isoShort(periodStart)} – ${isoShort(periodEnd)}`;
}

export interface Figure {
  key: string;
  label: string;
  value: string;
  sub?: string;
  tone: "gain" | "loss" | "flat";
}

/**
 * The figure strip for a report brief. Every figure with data is included;
 * an undefined figure is omitted rather than shown as zero. Trade reports
 * describe one position, so they show only the trade's own figures; the
 * day-level tallies below (trades closed, win rate, average R, heat) belong
 * to daily and weekly reports.
 */
export function figureStrip(f: ReportFacts): Figure[] {
  const out: Figure[] = [];
  if (f.pnl !== undefined) {
    out.push({
      key: "pnl",
      label: "P&L",
      value: usdSigned(f.pnl),
      sub: f.pnlPct !== undefined ? pctSigned(f.pnlPct) : undefined,
      tone: tone(f.pnl),
    });
  }
  if (f.benchmarkPct !== undefined) {
    const diff = (f.pnlPct ?? 0) - f.benchmarkPct;
    out.push({
      key: "spy",
      // SPY's own move; the caption carries the comparison, so the figure stays neutral.
      label: "SPY",
      value: pctSigned(f.benchmarkPct),
      sub:
        f.pnlPct !== undefined
          ? Math.abs(diff) < 0.005
            ? "matched SPY"
            : diff > 0
              ? `beat SPY by ${pct(Math.abs(diff))}`
              : `trailed SPY by ${pct(Math.abs(diff))}`
          : "same period",
      tone: "flat",
    });
  }
  const trade = f.trade?.trade;
  if (trade) return tradeFigures(out, trade.rMultiple, trade.holdingDays);
  if (f.trades.length > 0) {
    out.push({
      key: "trades",
      label: "Trades closed",
      value: String(f.trades.length),
      sub: f.winRatePct !== undefined ? `${pct(f.winRatePct)} won` : undefined,
      tone: "flat",
    });
  }
  if (f.winRatePct !== undefined) {
    out.push({ key: "winrate", label: "Win rate", value: pct(f.winRatePct), tone: "flat" });
  }
  if (f.avgR !== undefined) {
    out.push({
      key: "avgr",
      label: "Average R",
      value: `${f.avgR >= 0 ? "+" : "−"}${Math.abs(f.avgR).toFixed(2)}R`,
      sub: "per plan",
      tone: tone(f.avgR),
    });
  }
  if (f.heatPct !== undefined) {
    out.push({ key: "heat", label: "Heat", value: pct(f.heatPct), sub: "at risk to stops", tone: "flat" });
  }
  return out;
}

/** The trade's own R multiple and holding period, appended after P&L and SPY for a trade report. */
function tradeFigures(out: Figure[], rMultiple: number | undefined, holdingDays: number | undefined): Figure[] {
  if (rMultiple !== undefined) {
    out.push({
      key: "r",
      label: "R multiple",
      value: `${rMultiple >= 0 ? "+" : "−"}${Math.abs(rMultiple).toFixed(2)}R`,
      tone: tone(rMultiple),
    });
  }
  if (holdingDays !== undefined) {
    out.push({
      key: "holding",
      label: "Holding",
      value: `${holdingDays} day${holdingDays === 1 ? "" : "s"}`,
      tone: "flat",
    });
  }
  return out;
}

export interface PlanRow {
  label: string;
  planned: string;
  realized: string;
  /** Regulatory fees netted out of a realized P&L, dollars, when known and above zero. */
  fees?: number;
}

/** Plan-versus-outcome table for a trade report. Planned cells read "—" when the plan is missing. */
export function planOutcomeRows(r: Report): PlanRow[] {
  const t = r.facts.trade;
  if (!t) return [];
  const plan = t.plan;
  const tr = t.trade;
  const fees = tr.fees !== undefined && tr.fees > 0 ? tr.fees : undefined;
  if (!plan) {
    // No plan on record (for example a Robinhood-history import): show only
    // outcomes known from the fill itself, and never label one a stop-out.
    const rows: PlanRow[] = [
      {
        label: "Realized P&L",
        planned: "—",
        realized: `${usdSigned(tr.pnl)}${tr.pnlPct !== undefined ? ` (${pctSigned(tr.pnlPct)})` : ""}`,
        ...(fees !== undefined ? { fees } : {}),
      },
      { label: "Exit price", planned: "—", realized: usd(tr.exitPrice) },
    ];
    if (tr.holdingDays !== undefined) {
      rows.push({
        label: "Holding period",
        planned: "—",
        realized: `${tr.holdingDays} day${tr.holdingDays === 1 ? "" : "s"} held`,
      });
    }
    return rows;
  }
  const won = tr.pnl >= 0;
  return [
    {
      label: "Target gain",
      planned: plan ? `+${pct(plan.expectedGainPct)}` : "—",
      realized: `${usdSigned(tr.pnl)}${tr.pnlPct !== undefined ? ` (${pctSigned(tr.pnlPct)})` : ""}`,
      ...(fees !== undefined ? { fees } : {}),
    },
    {
      label: "Loss to stop",
      planned: plan ? pct(plan.expectedLossPct) : "—",
      realized: tr.rMultiple !== undefined ? `${tr.rMultiple >= 0 ? "+" : "−"}${Math.abs(tr.rMultiple).toFixed(1)}R` : "—",
    },
    {
      label: "Stated odds",
      planned: plan ? `${Math.round(plan.probabilityWin * 100)}%` : "—",
      realized: won ? "Won" : "Stopped out",
    },
    {
      label: "Stop",
      planned: plan ? usd(plan.invalidationPrice) : "—",
      realized: `Exited ${usd(tr.exitPrice)}`,
    },
    {
      label: "Time stop",
      planned: plan ? isoShort(plan.timeStopDate) : "—",
      realized: tr.holdingDays !== undefined ? `${tr.holdingDays} day${tr.holdingDays === 1 ? "" : "s"} held` : "—",
    },
  ];
}

/** Monday (UTC) of the week containing an ET date, as YYYY-MM-DD. */
export function mondayOf(iso: string): string | null {
  const d = parsed(iso);
  if (!d) return null;
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export interface ReportWeek {
  key: string;
  label: string;
  items: ReportSummary[];
}

/** Newest first, grouped by the week of the period start. Undated reports land in one group at the end. */
export function groupReportsByWeek(reports: readonly ReportSummary[]): ReportWeek[] {
  const order = new Map<string, number>();
  const groups = new Map<string, ReportSummary[]>();
  for (const r of reports) {
    const key = mondayOf(r.periodStart) ?? "undated";
    if (!groups.has(key)) {
      groups.set(key, []);
      order.set(key, order.size);
    }
    groups.get(key)!.push(r);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      label: key === "undated" ? "Undated" : `Week of ${shortDate(key)}`,
      items: items.slice().sort((a, b) => b.at - a.at),
    }))
    .sort((a, b) => {
      if (a.key === "undated") return 1;
      if (b.key === "undated") return -1;
      return b.key.localeCompare(a.key);
    });
}

/** One-line reading above the equity figure: "Up 1.00% vs SPY's +0.60% since Oct 26". */
export function periodReading(f: ReportFacts): string | undefined {
  if (f.pnlPct === undefined) return undefined;
  const dir = f.pnlPct >= 0 ? "Up" : "Down";
  const mine = pct(Math.abs(f.pnlPct));
  const since = `since ${isoShort(f.periodStart)}`;
  if (f.benchmarkPct === undefined) return `${dir} ${mine} ${since}`;
  return `${dir} ${mine} vs SPY's ${pctSigned(f.benchmarkPct)} ${since}`;
}

/** Toast copy for a newly published report. */
export function reportToast(r: ReportSummary): { title: string; body: string } {  if (r.kind === "daily") return { title: "Daily report ready", body: r.headline };
  if (r.kind === "weekly") return { title: "Weekly report ready", body: r.headline };
  return { title: `Trade report · ${r.symbol ?? "closed position"}`, body: r.headline };
}

export interface TradeMarkerDates {
  /** Bar date of (or just after) the entry. Absent when the entry date is unknown. */
  entry?: string;
  /** Bar date of (or just before) the exit. */
  exit: string;
  /** Bar date marking the time stop, when it falls inside the bar range. */
  timeStop?: string;
}

/**
 * Resolves entry, exit and time-stop dates onto actual bar dates so the
 * price-path chart can mark them. Falls back to the first/last bar when the
 * stamp sits outside the range. With no entry stamp there is no entry marker:
 * guessing the first bar would point at a day the position may not have existed.
 */
export function tradeMarkerDates(
  bars: readonly { date: string }[],
  openedAt: number | undefined,
  closedAt: number,
  timeStopDate?: string,
): TradeMarkerDates {
  const first = bars[0]?.date ?? "";
  const last = bars[bars.length - 1]?.date ?? "";
  const etDay = (ms: number): string =>
    new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const entryDay = openedAt !== undefined ? etDay(openedAt) : undefined;
  const exitDay = etDay(closedAt);
  return {
    entry: entryDay ? (bars.find((b) => b.date >= entryDay)?.date ?? first) : undefined,
    exit: [...bars].reverse().find((b) => b.date <= exitDay)?.date ?? last,
    timeStop: timeStopDate ? bars.find((b) => b.date >= timeStopDate)?.date : undefined,
  };
}
