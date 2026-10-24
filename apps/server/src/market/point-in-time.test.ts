import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Extension } from "@earendil-works/pi-durable";
import type { Bar, HistoryRange } from "@rh/shared";
import type { Clock, Logger, MarketData } from "../ports.ts";
import { createPointInTimeMarketData, endOfEtDateMs, MarketStore } from "./market-data.ts";
import { closes, rsi, sma } from "./indicators.ts";
import { createMarketExtension } from "./tools.ts";

const silent: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silent,
};

const ASOF = "2025-04-08";

function isoPlus(start: string, days: number): string {
  return new Date(Date.parse(`${start}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Every calendar date from 2022-01-01 through 2026-10-23. */
const ALL_DATES: string[] = [];
for (let i = 0; ; i++) {
  const d = isoPlus("2022-01-01", i);
  ALL_DATES.push(d);
  if (d >= "2026-10-23") break;
}
const ASOF_INDEX = ALL_DATES.indexOf(ASOF);
assert.ok(ASOF_INDEX > 300);

function dailyBars(closeAt: (i: number) => number): Bar[] {
  return ALL_DATES.map((date, i) => {
    const close = closeAt(i);
    return { date, open: close, high: close + 1, low: close - 1, close, volume: 1_000_000 };
  });
}

function fakeMarket(bars: Bar[], nextEarnings: string | undefined = "2025-05-01"): MarketData {
  return {
    history: (symbol) => Promise.resolve({ symbol, bars: bars.map((b) => ({ ...b })), source: "fake", asOf: 0 }),
    nextEarnings: () => Promise.resolve(nextEarnings),
    avgDollarVolume: () => Promise.resolve(undefined),
  };
}

function fixedClock(now: number): Clock {
  return { now: () => now };
}

function historyPayload(dates: string[]): string {
  const rows = [...dates].reverse().map((d) => {
    const [y, m, day] = d.split("-") as [string, string, string];
    return { date: `${m}/${day}/${y}`, open: "100.00", high: "101.00", low: "99.00", close: "100.00", volume: "1000000" };
  });
  return JSON.stringify({ data: { symbol: "SPY", tradesTable: { rows } } });
}

function vixCsv(dates: string[], closeAt: (i: number) => number): string {
  const lines = ["DATE,OPEN,HIGH,LOW,CLOSE"];
  for (let i = 0; i < dates.length; i++) {
    const [y, m, d] = (dates[i] as string).split("-") as [string, string, string];
    const c = closeAt(i);
    lines.push(`${m}/${d}/${y},${c},${c + 1},${c - 1},${c}`);
  }
  return lines.join("\n");
}

function treasuryCsv(dates: string[]): string {
  const lines = ['"Date","1 Mo","3 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"'];
  for (let i = 0; i < dates.length; i++) {
    const [y, m, d] = (dates[i] as string).split("-") as [string, string, string];
    const y2 = (3 + i * 0.01).toFixed(2);
    const y10 = (4 + i * 0.01).toFixed(2);
    lines.push(`${Number(m)}/${Number(d)}/${y},3.00,3.00,3.00,3.00,${y2},3.00,3.00,3.00,${y10},5.00,5.00`);
  }
  return lines.join("\n");
}

function fakeFetchImpl(routes: { match: (url: string) => boolean; body: string }[]): typeof fetch {
  return (async (url: unknown) => {
    const u = String(url);
    for (const r of routes) {
      if (r.match(u)) return new Response(r.body, { status: 200 });
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  }) as typeof fetch;
}

const TREASURY_DATES = ALL_DATES.filter((d) => d >= "2025-01-02");

function marketRoutes(): { match: (url: string) => boolean; body: string }[] {
  return [
    { match: (u) => u.includes("/historical?"), body: historyPayload(ALL_DATES) },
    {
      match: (u) => u.includes("calendar/earnings?date="),
      body: JSON.stringify({
        data: {
          rows: [
            { symbol: "RPM", name: "RPM International Inc.", time: "time-after-hours", epsForecast: "$0.52", eps: "$0.35", marketCap: "$12,972,727,300" },
          ],
        },
      }),
    },
    {
      match: (u) => u.includes("/analyst/"),
      body: JSON.stringify({
        data: {
          reportText:
            "AAPL is expected* to report earnings on 04/20/2025 after market close. " +
            "According to Zacks Investment Research, the consensus EPS forecast for the quarter is $2.10.",
          announcement: "Earnings announcement* for AAPL: Apr 20, 2025",
        },
      }),
    },
    {
      match: (u) => u.includes("economicevents?date="),
      body: JSON.stringify({
        data: {
          rows: [
            { gmt: "08:30", country: "United States", eventName: "CPI m/m", actual: "0.3%", consensus: "0.2%", previous: "0.1%" },
            { gmt: "01:00", country: "Japan", eventName: "Foreign report", actual: "9.9", consensus: "1", previous: "2" },
          ],
        },
      }),
    },
    { match: (u) => u.includes("VIX3M_History"), body: vixCsv(ALL_DATES, (i) => 20 + (i % 10)) },
    { match: (u) => u.includes("VIX9D_History"), body: vixCsv(ALL_DATES, (i) => 15 + (i % 10)) },
    {
      // Post-asOf spike to 90 proves truncation: the untruncated latest would be 90.
      match: (u) => u.includes("VIX_History"),
      body: vixCsv(ALL_DATES, (i) => (i > ASOF_INDEX ? 90 : 15 + (i % 10))),
    },
    { match: (u) => u.includes("daily-treasury"), body: treasuryCsv(TREASURY_DATES) },
    {
      match: (u) => u.includes("company_tickers"),
      body: JSON.stringify({ 0: { cik_str: 320193, ticker: "AAPL" } }),
    },
    {
      match: (u) => u.includes("/submissions/CIK"),
      body: JSON.stringify({
        name: "Apple Inc.",
        sic: "3571",
        sicDescription: "Electronic Computers",
        filings: {
          recent: {
            form: ["10-Q", "8-K", "10-Q"],
            filingDate: ["2025-05-01", ASOF, "2025-01-15"],
            accessionNumber: ["0000320193-25-000100", "0000320193-25-000099", "0000320193-25-000050"],
            primaryDocument: ["aapl-10q.htm", "aapl-8k.htm", "aapl-10q-q1.htm"],
            reportDate: ["2025-03-29", "", "2024-12-28"],
          },
        },
      }),
    },
    {
      match: (u) => u.includes("companyfacts/CIK"),
      body: JSON.stringify({
        facts: {
          "us-gaap": {
            Revenues: {
              units: {
                USD: Array.from({ length: 10 }, (_, k) => {
                  const ends = [
                    "2024-06-30", "2024-07-31", "2024-08-31", "2024-09-30", "2024-10-31",
                    "2024-11-30", "2024-12-31", "2025-01-31", "2025-02-28", "2025-03-31",
                  ];
                  const end = ends[k] as string;
                  return {
                    end,
                    val: 1000 + k,
                    form: "10-Q",
                    fy: 2025,
                    fp: "Q1",
                    filed: isoPlus(end, 35),
                  };
                }),
              },
            },
          },
        },
      }),
    },
  ];
}

interface ToolCallResult {
  output?: { text?: string }[];
  structuredOutput?: unknown;
  isError?: boolean;
}

async function callTool(ext: Extension, name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  const tool = ext.tools?.find((t) => t.name === name);
  assert.ok(tool !== undefined, `tool ${name} is registered`);
  const execute = (tool as unknown as { execute: (a: unknown, b: unknown, c: unknown) => Promise<ToolCallResult> })
    .execute;
  return execute(args, {}, {});
}

function textOf(result: ToolCallResult): string {
  return (result.output ?? []).map((p) => p.text ?? "").join("\n");
}

describe("endOfEtDateMs", () => {
  it("is_the_end_of_the_daylight_date", () => {
    assert.equal(endOfEtDateMs("2025-04-08"), Date.parse("2025-04-09T03:59:59.999Z"));
  });
  it("is_the_end_of_the_standard_date", () => {
    assert.equal(endOfEtDateMs("2026-01-15"), Date.parse("2026-01-16T04:59:59.999Z"));
  });
  it("rejects_malformed_dates", () => {
    assert.throws(() => endOfEtDateMs("2025-4-8"));
  });
});

describe("createPointInTimeMarketData", () => {
  const bars = dailyBars((i) => 100 + i * 0.05);
  const pit = createPointInTimeMarketData(fakeMarket(bars), () => ASOF);

  it("counts_each_range_back_from_asof", async () => {
    const expected: [HistoryRange, number][] = [
      ["1m", 21],
      ["3m", 63],
      ["6m", 126],
      ["1y", 252],
      ["2y", 504],
    ];
    for (const [range, count] of expected) {
      const hist = await pit.history("SPY", range);
      assert.equal(hist.bars.length, count, range);
      assert.equal(hist.bars.at(-1)?.date, ASOF, range);
      assert.ok(hist.bars.every((b) => b.date <= ASOF), range);
    }
  });

  it("returns_everything_on_or_before_asof_for_5y", async () => {
    const hist = await pit.history("SPY", "5y");
    assert.equal(hist.bars.length, ASOF_INDEX + 1);
    assert.equal(hist.bars.at(-1)?.date, ASOF);
  });

  it("never_returns_a_bar_after_asof", async () => {
    const ranges: HistoryRange[] = ["1m", "3m", "6m", "1y", "2y", "5y"];
    for (const range of ranges) {
      const hist = await pit.history("SPY", range);
      assert.ok(hist.bars.length > 0, range);
      assert.ok(hist.bars.every((b) => b.date <= ASOF), range);
      assert.equal(hist.asOf, endOfEtDateMs(ASOF), range);
    }
  });

  it("keeps_everything_when_asof_is_after_the_last_bar", async () => {
    const live = createPointInTimeMarketData(fakeMarket(bars), () => "2026-10-23");
    const hist = await live.history("SPY", "1y");
    assert.equal(hist.bars.length, 252);
    assert.equal(hist.bars.at(-1)?.date, "2026-10-23");
  });

  it("averages_dollar_volume_over_bars_on_or_before_asof", async () => {
    const got = await pit.avgDollarVolume("SPY", 20);
    const window = bars.slice(ASOF_INDEX - 19, ASOF_INDEX + 1);
    const want = window.reduce((sum, b) => sum + b.close * b.volume, 0) / window.length;
    assert.equal(got, want);
  });

  it("delegates_next_earnings_to_the_base", async () => {
    assert.equal(await pit.nextEarnings("SPY"), "2025-05-01");
  });
});

describe("truncated_indicators", () => {
  it("differ_from_untruncated_ones_on_a_series_with_a_late_jump", () => {
    // Flat at 100, then a jump to 200 for the last 10 sessions; asOf sits just before the jump.
    const full = dailyBars((i) => (i < 290 ? 100 : 200));
    const cutDate = full[289]?.date;
    assert.ok(cutDate !== undefined);
    const truncated = full.filter((b) => b.date <= cutDate);
    assert.equal(truncated.length, 290);
    const fullCloses = closes(full);
    const cutCloses = closes(truncated);
    assert.notEqual(sma(fullCloses, 50), sma(cutCloses, 50));
    assert.equal(rsi(cutCloses, 14), 50);
    assert.notEqual(rsi(fullCloses, 14), 50);
  });
});

describe("MarketStore_point_in_time", () => {
  function setup() {
    const dataDir = mkdtempSync(join(tmpdir(), "pit-store-"));
    const clock = fixedClock(Date.parse("2026-10-24T12:00:00Z"));
    const store = new MarketStore({
      dataDir,
      log: silent,
      clock,
      asOf: () => ASOF,
      fetchImpl: fakeFetchImpl([{ match: (u) => u.includes("/historical?"), body: historyPayload(ALL_DATES) }]),
    });
    return { store };
  }

  it("history_counts_back_from_asof_and_marks_end_of_date", async () => {
    const { store } = setup();
    const hist = await store.history("SPY", "1m");
    assert.ok(hist.bars.length > 0);
    assert.ok(hist.bars.every((b) => b.date <= ASOF));
    assert.equal(hist.bars.at(-1)?.date, ASOF);
    assert.equal(hist.asOf, endOfEtDateMs(ASOF));
  });

  it("extended_full_excludes_bars_after_asof", async () => {
    const { store } = setup();
    const { full, window } = await store.extended("SPY", "1y");
    assert.ok(full.length > 0);
    assert.ok(full.every((b) => b.date <= ASOF));
    assert.ok(window.every((b) => b.date <= ASOF && b.date >= "2024-04-08"));
    assert.equal(full.at(-1)?.date, ASOF);
  });

  it("bars_between_returns_exactly_the_requested_window", async () => {
    const { store } = setup();
    const bars = await store.barsBetween("SPY", "2025-03-01", "2025-04-30");
    assert.equal(bars.length, 61);
    assert.equal(bars[0]?.date, "2025-03-01");
    assert.equal(bars.at(-1)?.date, "2025-04-30");
    assert.deepEqual(await store.barsBetween("SPY", "2025-04-30", "2025-03-01"), []);
  });

  it("next_earnings_searches_forward_from_asof", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "pit-earn-"));
    const store = new MarketStore({
      dataDir,
      log: silent,
      clock: fixedClock(Date.parse("2026-10-24T12:00:00Z")),
      asOf: () => ASOF,
      fetchImpl: fakeFetchImpl(marketRoutes()),
    });
    assert.equal(await store.nextEarnings("AAPL"), "2025-04-20");
  });

  it("avg_dollar_volume_uses_bars_on_or_before_asof", async () => {
    const { store } = setup();
    assert.equal(await store.avgDollarVolume("SPY", 20), 100 * 1_000_000);
  });
});

describe("market_tools_point_in_time", () => {
  function setup(asOf: (() => string | undefined) | undefined) {
    const dataDir = mkdtempSync(join(tmpdir(), "pit-tools-"));
    const clock = fixedClock(Date.parse("2026-10-24T12:00:00Z"));
    const ext = createMarketExtension({
      market: fakeMarket(dailyBars((i) => 100 + i * 0.05)),
      dataDir,
      log: silent,
      clock,
      ...(asOf === undefined ? {} : { asOf }),
      fetchImpl: fakeFetchImpl(marketRoutes()),
    });
    return { ext };
  }

  it("price_history_truncates_ranges_and_prefixes_text", async () => {
    const { ext } = setup(() => ASOF);
    const result = await callTool(ext, "market_price_history", { symbol: "SPY", range: "1m" });
    assert.equal(result.isError, undefined);
    const structured = result.structuredOutput as unknown as { bars: Bar[]; asOf: number };
    assert.equal(structured.bars.length, 21);
    assert.ok(structured.bars.every((b) => b.date <= ASOF));
    assert.equal(structured.bars.at(-1)?.date, ASOF);
    assert.equal(structured.asOf, endOfEtDateMs(ASOF));
    assert.ok(textOf(result).startsWith(`As of ${ASOF}: `));
  });

  it("indicators_end_on_asof_and_prefix_text", async () => {
    const { ext } = setup(() => ASOF);
    const result = await callTool(ext, "market_indicators", { symbol: "SPY", range: "1y" });
    assert.equal(result.isError, undefined);
    const structured = result.structuredOutput as unknown as { date: string; close: number };
    assert.equal(structured.date, ASOF);
    assert.equal(structured.close, 100);
    assert.ok(textOf(result).startsWith(`As of ${ASOF}: `));
  });

  it("compare_uses_truncated_bars_and_prefixes_text", async () => {
    const { ext } = setup(() => ASOF);
    const result = await callTool(ext, "market_compare", { symbols: ["AAPL"], range: "1m" });
    assert.equal(result.isError, undefined);
    const structured = result.structuredOutput as unknown as { rows: { symbol: string }[] };
    assert.equal(structured.rows.length, 1);
    assert.ok(textOf(result).startsWith(`As of ${ASOF}: `));
  });

  it("earnings_counts_days_from_asof", async () => {
    const { ext } = setup(() => ASOF);
    const result = await callTool(ext, "market_earnings", { symbol: "AAPL" });
    assert.equal(result.isError, undefined);
    const structured = result.structuredOutput as unknown as { nextDate: string; daysUntil: number };
    assert.equal(structured.nextDate, "2025-04-20");
    assert.equal(structured.daysUntil, 12);
    assert.ok(textOf(result).startsWith(`As of ${ASOF}: `));
  });

  it("earnings_calendar_blanks_actuals_on_and_after_asof", async () => {
    const { ext } = setup(() => ASOF);
    const on = await callTool(ext, "market_earnings_calendar", { date: ASOF });
    const onRows = (on.structuredOutput as unknown as { rows: Record<string, unknown>[] }).rows;
    assert.equal(onRows.length, 1);
    assert.ok(!("actualEps" in (onRows[0] as object)));
    assert.ok(textOf(on).startsWith(`As of ${ASOF}: `));
    const before = await callTool(ext, "market_earnings_calendar", { date: "2025-04-01" });
    const beforeRows = (before.structuredOutput as unknown as { rows: Record<string, unknown>[] }).rows;
    assert.equal(beforeRows[0]?.["actualEps"], "$0.35");
  });

  it("economic_calendar_refuses_future_dates_and_blanks_actual_on_asof", async () => {
    const { ext } = setup(() => ASOF);
    const future = await callTool(ext, "market_economic_calendar", { date: "2025-04-09" });
    assert.equal(future.isError, true);
    assert.ok(textOf(future).includes("not available in the simulation yet"));
    assert.ok(textOf(future).startsWith(`As of ${ASOF}: `));
    const on = await callTool(ext, "market_economic_calendar", { date: ASOF });
    assert.equal(on.isError, undefined);
    const onEvents = (on.structuredOutput as unknown as { events: Record<string, unknown>[] }).events;
    assert.equal(onEvents.length, 1);
    assert.ok(!("actual" in (onEvents[0] as object)));
    assert.equal(onEvents[0]?.["consensus"], "0.2%");
    const before = await callTool(ext, "market_economic_calendar", { date: "2025-04-01" });
    const beforeEvents = (before.structuredOutput as unknown as { events: Record<string, unknown>[] }).events;
    assert.equal(beforeEvents[0]?.["actual"], "0.3%");
  });

  it("volatility_truncates_the_series_at_asof", async () => {
    const { ext } = setup(() => ASOF);
    const result = await callTool(ext, "market_volatility", { range: "1y" });
    assert.equal(result.isError, undefined);
    const structured = result.structuredOutput as unknown as {
      vix: { date: string; close: number };
      vix3m: { date: string };
      vix9d: { date: string };
    };
    assert.equal(structured.vix.date, ASOF);
    assert.notEqual(structured.vix.close, 90);
    assert.ok(structured.vix3m.date <= ASOF);
    assert.ok(structured.vix9d.date <= ASOF);
    assert.ok(textOf(result).startsWith(`As of ${ASOF}: `));
  });

  it("yields_truncate_the_curve_at_asof", async () => {
    const { ext } = setup(() => ASOF);
    const result = await callTool(ext, "market_yields", {});
    assert.equal(result.isError, undefined);
    const structured = result.structuredOutput as unknown as {
      date: string;
      spread2s10s: number;
      change10y20d: number;
    };
    assert.equal(structured.date, ASOF);
    assert.ok(Math.abs(structured.spread2s10s - 1) < 1e-9);
    assert.ok(Math.abs(structured.change10y20d - 0.2) < 1e-9);
    assert.ok(textOf(result).startsWith(`As of ${ASOF}: `));
  });

  it("sec_company_filters_filings_and_facts_by_filed_date", async () => {
    const { ext } = setup(() => ASOF);
    const result = await callTool(ext, "sec_company", { symbol: "AAPL" });
    assert.equal(result.isError, undefined);
    const structured = result.structuredOutput as unknown as {
      recentFilings: { filedAt: string }[];
      facts: Record<string, { end: string; filed: string; value: number }[]>;
    };
    assert.ok(structured.recentFilings.length === 2);
    assert.ok(structured.recentFilings.every((f) => f.filedAt <= ASOF));
    const revenue = structured.facts["revenue"] ?? [];
    assert.equal(revenue.length, 7);
    assert.ok(revenue.every((p) => p.filed <= ASOF));
    assert.ok(revenue.every((p) => typeof p.filed === "string"));
    assert.ok(!revenue.some((p) => p.end === "2025-03-31"));
    assert.ok(textOf(result).startsWith(`As of ${ASOF}: `));
  });

  it("live_calls_have_no_prefix_and_full_bars_without_asof", async () => {
    const { ext } = setup(undefined);
    const result = await callTool(ext, "market_price_history", { symbol: "SPY", range: "1m" });
    assert.equal(result.isError, undefined);
    const structured = result.structuredOutput as unknown as { bars: Bar[] };
    assert.ok(structured.bars.length > 21);
    assert.ok(!textOf(result).startsWith("As of "));
  });
});
