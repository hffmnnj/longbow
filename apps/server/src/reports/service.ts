import type { EventBus } from "../ports.ts";
import type { Report, ReportKind, ReportNarrative } from "@rh/shared";
import { buildDailyFacts, buildTradeFacts, buildWeeklyFacts, type ReportFactsDeps } from "./facts.ts";
import { dailyReportId, mondayOfWeek, summarizeReport, tradeReportId, weeklyReportId } from "./ids.ts";

export interface ReportServiceDeps extends ReportFactsDeps {
  bus: EventBus;
  currentCycleId: () => string | undefined;
}

function signed(value: number, digits = 2): string {
  return `${value < 0 ? "-" : "+"}$${Math.abs(value).toFixed(digits)}`;
}

function signedPct(value: number, digits = 2): string {
  return `${value < 0 ? "-" : "+"}${Math.abs(value).toFixed(digits)}%`;
}

/**
 * Validate kind-specific narrative rules and publish the report: build the
 * server-computed facts, store the full report (replacing any republish of
 * the same period), and emit the live report event. Throws a plain message
 * the tool returns to the agent.
 */
export async function publishReport(
  deps: ReportServiceDeps,
  narrative: ReportNarrative,
): Promise<{ report: Report; text: string }> {
  const kind: ReportKind = narrative.kind;
  if (kind === "trade") {
    if (narrative.symbol === undefined) throw new Error("A trade report needs symbol: the closed symbol it covers.");
    if (narrative.grade === undefined) throw new Error("A trade report needs grade: judge the decision quality, not the outcome.");
  } else {
    if (narrative.symbol !== undefined) throw new Error(`Only trade reports take symbol; this is a ${kind} report.`);
    if (kind === "daily" && narrative.weekOf !== undefined) throw new Error("Only weekly reports take weekOf; this is a daily report.");
    if (kind === "weekly" && narrative.weekOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(narrative.weekOf)) {
      throw new Error("weekOf must be an ET date YYYY-MM-DD (the Monday of the week covered).");
    }
  }

  const today = deps.calendar.etDate(deps.clock.now());
  const facts =
    kind === "daily"
      ? await buildDailyFacts(deps, today)
      : kind === "weekly"
        ? await buildWeeklyFacts(deps, narrative.weekOf ?? mondayOfWeek(today))
        : await buildTradeFacts(deps, narrative.symbol as string);
  const id =
    kind === "daily"
      ? dailyReportId(facts.periodStart)
      : kind === "weekly"
        ? weeklyReportId(facts.periodStart)
        : tradeReportId(narrative.symbol as string, facts.trade?.trade.closedAt ?? deps.clock.now());
  const report: Report = {
    id,
    kind,
    at: deps.clock.now(),
    ...(kind === "trade" ? { symbol: narrative.symbol as string } : {}),
    periodStart: facts.periodStart,
    periodEnd: facts.periodEnd,
    headline: narrative.headline,
    ...(narrative.grade === undefined ? {} : { grade: narrative.grade }),
    ...(facts.pnl === undefined ? {} : { pnl: facts.pnl }),
    ...(facts.pnlPct === undefined ? {} : { pnlPct: facts.pnlPct }),
    ...(deps.currentCycleId() === undefined ? {} : { cycleId: deps.currentCycleId() as string }),
    narrative,
    facts,
  };
  deps.store.saveReport(report);
  const summary = summarizeReport(report);
  deps.bus.publish({ type: "report", report: summary });
  return { report, text: resultText(summary, facts) };
}

function resultText(summary: ReturnType<typeof summarizeReport>, facts: Report["facts"]): string {
  const parts = [`Report ${summary.id} (${summary.periodStart} to ${summary.periodEnd})`];
  if (summary.pnl !== undefined) parts.push(`pnl ${signed(summary.pnl)}`);
  if (summary.pnlPct !== undefined) parts.push(`(${signedPct(summary.pnlPct)})`);
  if (facts.benchmarkPct !== undefined) parts.push(`benchmark ${signedPct(facts.benchmarkPct)}`);
  parts.push(`${facts.trades.length} trade${facts.trades.length === 1 ? "" : "s"} closed`);
  if (facts.winRatePct !== undefined) parts.push(`win rate ${facts.winRatePct.toFixed(1)}%`);
  return parts.join(", ") + ".";
}

const MAX_HEADLINE = 140;
const MAX_SUMMARY = 1200;

/**
 * Safety net: when a post_close cycle ends without a daily report for `date`,
 * publish one from the cycle's own review so the owner always gets the daily
 * numbers. Never throws; a facts failure still logs and returns undefined.
 */
export async function ensureDailyReport(deps: ReportServiceDeps, date: string): Promise<Report | undefined> {
  try {
    const id = dailyReportId(date);
    const existing = deps.store.report(id);
    if (existing !== undefined) return existing;
    const facts = await buildDailyFacts(deps, date);
    const review = deps.store.listJournal(50).find((entry) => entry.cycleId?.startsWith("post_close"));
    const narrative: ReportNarrative = {
      kind: "daily",
      headline: (review?.summary ?? "No daily report from the agent today.").slice(0, MAX_HEADLINE),
      summary: (review !== undefined ? `${review.summary}\n\n${review.rationale}` : "No daily report from the agent today.").slice(
        0,
        MAX_SUMMARY,
      ),
      sections: [],
      lessons: [],
      nextSteps: [],
    };
    const report: Report = {
      id,
      kind: "daily",
      at: deps.clock.now(),
      periodStart: facts.periodStart,
      periodEnd: facts.periodEnd,
      headline: narrative.headline,
      ...(facts.pnl === undefined ? {} : { pnl: facts.pnl }),
      ...(facts.pnlPct === undefined ? {} : { pnlPct: facts.pnlPct }),
      ...(deps.currentCycleId() === undefined ? {} : { cycleId: deps.currentCycleId() as string }),
      narrative,
      facts,
    };
    deps.store.saveReport(report);
    deps.bus.publish({ type: "report", report: summarizeReport(report) });
    return report;
  } catch (error) {
    deps.log.warn("daily report safety net failed", {
      date,
      error: error instanceof Error ? error.message : "unknown",
    });
    return undefined;
  }
}
