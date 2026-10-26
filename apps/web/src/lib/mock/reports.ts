import type { Bar, ClosedTrade, Report, ReportSummary } from "@rh/shared";
import { mockHistory } from "./data.ts";

/**
 * Dev-only report fixtures (VITE_MOCK_API=1). They match the Reports types in
 * @rh/shared exactly, so the UI works now and switches to real data when the
 * endpoints land. Nothing here is reachable from production bundles.
 */

const DAY = 86_400_000;
const etFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etWeekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });

const etDate = (ms: number): string => etFmt.format(ms);
const isWeekday = (ms: number): boolean => {
  const d = etWeekday.format(ms);
  return d !== "Sat" && d !== "Sun";
};

/** `count` trading days ending on the most recent one, oldest first. */
function tradingSpan(count: number): string[] {
  const out: string[] = [];
  let ms = Date.now();
  while (!isWeekday(ms)) ms -= DAY;
  while (out.length < count) {
    if (isWeekday(ms)) out.unshift(etDate(ms));
    ms -= DAY;
  }
  return out;
}

/** Mid-afternoon ET as epoch ms, for a bar date. */
const afternoon = (iso: string): number => Date.parse(`${iso}T18:35:00Z`);

const r2 = (v: number): number => Math.round(v * 100) / 100;

interface Built {
  summary: ReportSummary;
  report: Report;
}

function toSummary(r: Report): ReportSummary {
  const { narrative: _n, facts: _f, cycleId: _c, ...summary } = r;
  return summary;
}

function dailyReport(id: string, at: number, period: string, prev: string, trade: ClosedTrade | null): Built {
  const equity = trade ? 25_431.77 : 25_398.12;
  const start = trade ? 25_413.45 : 25_413.77;
  const pnl = r2(equity - start);
  const pnlPct = r2((pnl / start) * 100);
  const report: Report = {
    id,
    kind: "daily",
    at,
    periodStart: period,
    periodEnd: period,
    headline: trade
      ? "Flat tape; the only action was an energy exit into weakness"
      : "Nothing to do on a flat, low-volume tape",
    pnl,
    pnlPct,
    narrative: {
      kind: "daily",
      headline: trade
        ? "Flat tape; the only action was an energy exit into weakness"
        : "Nothing to do on a flat, low-volume tape",
      summary: trade
        ? "The account drifted with a flat market and closed one position. Energy kept leaking lower, so the XLE exit went through in the afternoon and cash now sits near a fifth of equity."
        : "No setups cleared the bar on a quiet day, so nothing was opened or closed. The book ended about where it started and every stop stayed intact.",
      sections: trade
        ? [
            { title: "What worked", body: "The XLE exit went through near the highs of its afternoon slide, before the crude curve weakened further overnight. Spreads stayed under 5 bps all day." },
            { title: "What didn't", body: "Nothing new qualified. Two tech names briefly triggered the pullback screen and failed it on volume within the hour." },
            { title: "Market", body: "Breadth was flat and the VIX barely moved. No calendar events until Thursday, so the book can stay patient." },
          ]
        : [
            { title: "Why nothing traded", body: "The pullback screen flagged two tech names and both failed on volume within the hour. Forcing either would have meant paying up past the entry window rules." },
            { title: "Market", body: "Flat breadth, VIX near 15, nothing on the calendar until Thursday. Cash earns its place on days like this." },
          ],
      lessons: ["A failed screen is an answer, not an invitation to lower the bar."],
      nextSteps: ["Re-check the two tech names at the next cycle", "Exit XLE only if it is still held"],
    },
    facts: {
      periodStart: period,
      periodEnd: period,
      startEquity: start,
      endEquity: equity,
      pnl,
      pnlPct,
      benchmarkPct: trade ? 0.12 : 0.08,
      equityCurve: [
        { date: prev, equity: start },
        { date: period, equity },
      ],
      trades: trade ? [trade] : [],
      realizedPnl: trade ? trade.pnl : 0,
      orders: trade
        ? { submitted: 1, filled: 1, rejected: 0, cancelled: 0, failed: 0 }
        : { submitted: 0, filled: 0, rejected: 0, cancelled: 0, failed: 0 },
      positions: [
        { symbol: "NVDA", weightPct: 6.34, unrealizedPnl: 191.99, sector: "Technology" },
        { symbol: "XLE", weightPct: 9.0, unrealizedPnl: -12.0, sector: "Energy" },
        { symbol: "JPM", weightPct: 8.23, unrealizedPnl: 42.15, sector: "Financials" },
      ],
      heatPct: 0.62,
      decisions: trade
        ? [
            { id: "rep-d-j1", at: afternoon(period), action: "sell", symbol: "XLE", summary: "Exit XLE: crude curve weakening, 50 day lost" },
            { id: "rep-d-j2", at: afternoon(period) - 3 * 3_600_000, action: "hold", symbol: "NVDA", summary: "Hold NVDA, thesis intact above 112" },
          ]
        : [{ id: "rep-d-j3", at: afternoon(period), action: "none", summary: "No actionable setups; screens failed on volume" }],
    },
  };
  return { summary: toSummary(report), report };
}

function weeklyReport(id: string, at: number, span: readonly string[]): Built {
  const marks = [25_180.4, 25_266.1, 25_210.8, 25_344.2, 25_431.77];
  const start = marks[0]!;
  const end = marks[marks.length - 1]!;
  const pnl = r2(end - start);
  const trades: ClosedTrade[] = [
    {
      symbol: "MSFT",
      openedAt: afternoon(span[0]!) - 11 * DAY,
      closedAt: afternoon(span[1]!),
      quantity: 2,
      entryPrice: 401.5,
      exitPrice: 457.7,
      pnl: 112.4,
      pnlPct: 14.0,
      rMultiple: 1.9,
      holdingDays: 11,
      probabilityWin: 0.58,
      source: "harness",
    },
    {
      symbol: "XLK",
      closedAt: afternoon(span[2]!),
      quantity: 5,
      entryPrice: 233.1,
      exitPrice: 223.44,
      pnl: -48.3,
      pnlPct: -4.14,
      rMultiple: -0.9,
      holdingDays: 3,
      probabilityWin: 0.68,
      source: "harness",
    },
    {
      symbol: "XLE",
      closedAt: afternoon(span[3]!),
      quantity: 25,
      entryPrice: 92.1,
      exitPrice: 91.62,
      pnl: -12.0,
      pnlPct: -0.52,
      holdingDays: 7,
      source: "robinhood",
    },
  ];
  const report: Report = {
    id,
    kind: "weekly",
    at,
    periodStart: span[0]!,
    periodEnd: span[span.length - 1]!,
    headline: "A winning week on one clean tech exit, despite two small stops",
    pnl,
    pnlPct: r2((pnl / start) * 100),
    grade: "B",
    narrative: {
      kind: "weekly",
      weekOf: span[0]!,
      headline: "A winning week on one clean tech exit, despite two small stops",
      summary:
        "One of three closed trades paid for the other two: the MSFT drift exit covered the XLK chase and the old XLE history cleanly. The book finished the week near its highs with every remaining stop intact.",
      grade: "B",
      gradeReason: "Sized within risk and honored every stop; the XLK entry chased a faded breakout.",
      sections: [
        { title: "What worked", body: "The MSFT exit followed the plan to the letter: held above the 20 day, sold into strength on day eleven, banked 1.9R. Stated odds ran honest across the three closes." },
        { title: "What didn't", body: "XLK was entered as volume faded on day two and stopped the next morning. The entry screen has since been tightened to require a second confirming close." },
        { title: "Market", body: "Tech carried a flat market while energy lagged the crude curve. Breadth stayed positive into the close, so no defensive changes." },
      ],
      lessons: ["A faded second day is an exit signal, not a holding pattern", "One full-size winner covers two disciplined stops"],
      nextSteps: ["Re-screen XLK only on a high-volume reclaim", "Roll the NVDA time stop forward at the next cycle"],
    },
    facts: {
      periodStart: span[0]!,
      periodEnd: span[span.length - 1]!,
      startEquity: start,
      endEquity: end,
      pnl,
      pnlPct: r2((pnl / start) * 100),
      benchmarkPct: 0.6,
      equityCurve: span.map((date, i) => ({ date, equity: marks[i]! })),
      trades,
      realizedPnl: r2(trades.reduce((a, t) => a + t.pnl, 0)),
      winRatePct: r2((1 / 3) * 100),
      avgR: 0.5,
      orders: { submitted: 5, filled: 3, rejected: 1, cancelled: 1, failed: 0 },
      positions: [
        { symbol: "NVDA", weightPct: 6.34, unrealizedPnl: 191.99, sector: "Technology" },
        { symbol: "XLE", weightPct: 9.0, unrealizedPnl: -12.0, sector: "Energy" },
        { symbol: "JPM", weightPct: 8.23, unrealizedPnl: 42.15, sector: "Financials" },
      ],
      heatPct: 1.1,
      decisions: [
        { id: "rep-w-j1", at: afternoon(span[3]!), action: "sell", symbol: "MSFT", summary: "Bank the drift: 1.9R into strength on day eleven" },
        { id: "rep-w-j2", at: afternoon(span[2]!), action: "sell", symbol: "XLK", summary: "Stop XLK: volume faded on day two" },
        { id: "rep-w-j3", at: afternoon(span[1]!), action: "buy", symbol: "XLK", summary: "Enter XLK on the breakout retest" },
        { id: "rep-w-j4", at: afternoon(span[0]!), action: "hold", symbol: "NVDA", summary: "Hold NVDA into the supply checks" },
      ],
    },
  };
  return { summary: toSummary(report), report };
}

/** Finds a genuine pullback inside the last 30 NVDA bars so the stop-out reads true on the chart. */
function pickDecline(bars: Bar[]): { entry: number; exit: number } {
  for (let i = 12; i <= 20; i++) {
    for (let j = i + 3; j <= Math.min(i + 6, bars.length - 6); j++) {
      if (bars[j]!.close < bars[i]!.close * 0.96) return { entry: i, exit: j };
    }
  }
  return { entry: 19, exit: 25 };
}

function tradeReport(id: string, at: number): Built {
  const bars = mockHistory("NVDA", "3m").slice(-30);
  const { entry, exit } = pickDecline(bars);
  const entryPrice = r2(bars[entry]!.close);
  const exitPrice = r2(bars[exit]!.close);
  const quantity = 12;
  const pnl = r2((exitPrice - entryPrice) * quantity);
  const invalidationPrice = r2(exitPrice + 0.4);
  const timeStop = bars[Math.min(exit + 4, bars.length - 1)]!.date;
  const openedAt = afternoon(bars[entry]!.date);
  const closedAt = afternoon(bars[exit]!.date);
  const holdingDays = exit - entry;
  const endEquity = 25_431.77;
  const startEquity = r2(endEquity - pnl);
  const span = bars.slice(entry, exit + 1);
  const report: Report = {
    id,
    kind: "trade",
    at,
    symbol: "NVDA",
    periodStart: bars[entry]!.date,
    periodEnd: bars[exit]!.date,
    headline: "Stopped out of NVDA as the breakout retest failed",
    pnl,
    pnlPct: r2((pnl / (entryPrice * quantity)) * 100),
    grade: "B",
    narrative: {
      kind: "trade",
      symbol: "NVDA",
      headline: "Stopped out of NVDA as the breakout retest failed",
      summary:
        "The breakout retest lost the level on rising volume two days after entry, and the position was stopped the same afternoon. The loss was exactly the planned risk, so the week survives it without a scratch.",
      grade: "B",
      gradeReason: "The stop did its job: sized to the plan, exited at invalidation, never averaged down.",
      sections: [
        { title: "Setup", body: "NVDA reclaimed the breakout level on a high-volume close with data-center demand checks still intact. Entry went in the next morning with the stop under the retest low." },
        { title: "What worked", body: "Sizing held the loss to the planned risk and the exit printed within forty cents of the stop. No second-guessing, no widening." },
        { title: "What didn't", body: "The retest failed faster than the base case allowed: supply showed up on day two instead of absorbing. The odds were honest but the read was early." },
      ],
      lessons: ["A retest that fails on rising volume fails fast; same-day exits save the slippage"],
      nextSteps: ["NVDA back on the watchlist only above the failed level", "Reuse the sizing; it is what made this forgettable"],
    },
    facts: {
      periodStart: bars[entry]!.date,
      periodEnd: bars[exit]!.date,
      startEquity,
      endEquity,
      pnl,
      pnlPct: r2((pnl / (entryPrice * quantity)) * 100),
      benchmarkPct: 0.4,
      equityCurve: span.map((b, i) => ({ date: b.date, equity: r2(startEquity + (pnl * (i + 1)) / span.length) })),
      trades: [
        {
          symbol: "NVDA",
          openedAt,
          closedAt,
          quantity,
          entryPrice,
          exitPrice,
          pnl,
          pnlPct: r2((pnl / (entryPrice * quantity)) * 100),
          rMultiple: -1,
          holdingDays,
          probabilityWin: 0.64,
          source: "harness",
        },
      ],
      realizedPnl: pnl,
      orders: { submitted: 2, filled: 2, rejected: 0, cancelled: 0, failed: 0 },
      positions: [
        { symbol: "NVDA", weightPct: 6.34, unrealizedPnl: 191.99, sector: "Technology" },
        { symbol: "XLE", weightPct: 9.0, unrealizedPnl: -12.0, sector: "Energy" },
        { symbol: "JPM", weightPct: 8.23, unrealizedPnl: 42.15, sector: "Financials" },
      ],
      decisions: [
        { id: "rep-t-j1", at: closedAt, action: "sell", symbol: "NVDA", summary: "Stop NVDA: retest failed on rising volume" },
        { id: "rep-t-j2", at: openedAt, action: "buy", symbol: "NVDA", summary: "Enter NVDA on the breakout retest" },
      ],
      trade: {
        trade: {
          symbol: "NVDA",
          openedAt,
          closedAt,
          quantity,
          entryPrice,
          exitPrice,
          pnl,
          pnlPct: r2((pnl / (entryPrice * quantity)) * 100),
          rMultiple: -1,
          holdingDays,
          probabilityWin: 0.64,
          source: "harness",
        },
        plan: {
          thesis:
            "NVDA reclaimed the breakout level on strong volume and the data-center demand read is intact. A retest entry risks about five percent to the stop for an eight percent first target, with the time stop two weeks out.",
          invalidationPrice,
          timeStopDate: timeStop,
          probabilityWin: 0.64,
          expectedGainPct: 8.2,
          expectedLossPct: 5.4,
        },
        bars,
      },
    },
  };
  return { summary: toSummary(report), report };
}

const now = Date.now();
const HOUR = 3_600_000;

const pair = tradingSpan(2);
const xleExit: ClosedTrade = {
  symbol: "XLE",
  closedAt: afternoon(pair[1]!),
  quantity: 25,
  entryPrice: 92.1,
  exitPrice: 91.62,
  pnl: -12.0,
  pnlPct: -0.52,
  holdingDays: 7,
  source: "robinhood",
};

const daily = dailyReport("rep-daily", now - 26 * HOUR, pair[0]!, tradingSpan(3)[0]!, null);
const weeklySpan = tradingSpan(5);
const weekly = weeklyReport("rep-weekly", now - 4 * HOUR, weeklySpan);
const trade = tradeReport("rep-trade-nvda", now - 30 * 3_600_000);

const ALL: Built[] = [weekly, trade, daily].sort((a, b) => b.summary.at - a.summary.at);

/** The three standing fixtures, newest first. */
export function mockReportSummaries(): ReportSummary[] {
  return ALL.map((b) => b.summary);
}

/** Full report by id, for GET /api/reports/:id. */
export function mockReport(id: string): Report | undefined {
  return ALL.find((b) => b.summary.id === id)?.report;
}

/** A fresh flat-day report that arrives live a few seconds into dev:mock. */
export function buildLiveDaily(at = Date.now()): Built {
  const latest = tradingSpan(1);
  return dailyReport("rep-daily-live", at, latest[0]!, pair[0]!, xleExit);
}
