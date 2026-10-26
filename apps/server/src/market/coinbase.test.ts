import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Extension } from "@earendil-works/pi-durable";
import type { Bar } from "@rh/shared";
import type { Clock, Logger, MarketData } from "../ports.ts";
import { etDate, MarketCache } from "./cache.ts";
import { closes, periodReturn, realizedVol } from "./indicators.ts";
import { MarketStore } from "./market-data.ts";
import { createMarketExtension } from "./tools.ts";
import { fetchCoinbaseHistory, parseCoinbaseCandles } from "./sources/coinbase.ts";

const silent: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silent,
};

/** Monday 2026-10-26 10:00 ET. */
const NOW = Date.parse("2026-10-26T14:00:00Z");
const TODAY = "2026-10-26";
const clock: Clock = { now: () => NOW };
assert.equal(etDate(NOW), TODAY);

function isoPlus(start: string, days: number): string {
  return new Date(Date.parse(`${start}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Every calendar date from `start` through TODAY. */
function dateRange(start: string): string[] {
  const out: string[] = [];
  for (let i = 0; ; i++) {
    const d = isoPlus(start, i);
    if (d > TODAY) break;
    out.push(d);
  }
  return out;
}

function isWeekday(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

/** Coinbase candle tuple, newest first as the API returns. */
function candlesFor(dates: string[], closeAt: (i: number) => number): unknown[] {
  return [...dates]
    .reverse()
    .map((date, rev) => {
      const i = dates.length - 1 - rev;
      const close = closeAt(i);
      const time = Date.parse(`${date}T00:00:00Z`) / 1000;
      return [time, close - 1, close + 1, close - 0.5, close, 10 + (i % 7)];
    });
}

function nasdaqPayload(dates: string[], closeAt: (i: number) => number): string {
  const rows = dates.map((d) => {
    const i = dates.indexOf(d);
    const [y, m, day] = d.split("-") as [string, string, string];
    const close = closeAt(i).toFixed(2);
    return { date: `${m}/${day}/${y}`, open: close, high: close, low: close, close, volume: "1000000" };
  });
  return JSON.stringify({ data: { symbol: "SPY", tradesTable: { rows } } });
}

function fakeFetchImpl(handler: (url: string) => string): typeof fetch {
  return (async (url: unknown) => new Response(handler(String(url)), { status: 200 })) as typeof fetch;
}

function fakeMarket(bars: Bar[]): MarketData {
  return {
    history: (symbol) => Promise.resolve({ symbol, bars: bars.map((b) => ({ ...b })), source: "fake", asOf: 0 }),
    nextEarnings: () => Promise.resolve(undefined),
    avgDollarVolume: () => Promise.resolve(undefined),
  };
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

describe("parseCoinbaseCandles", () => {
  it("orders_newest_first_oldest_first_and_drops_bad_rows", () => {
    const t1 = Date.parse("2026-10-24T00:00:00Z") / 1000;
    const t2 = Date.parse("2026-10-25T00:00:00Z") / 1000;
    const t3 = Date.parse("2026-10-26T00:00:00Z") / 1000;
    const bars = parseCoinbaseCandles([
      [t3, 90, 110, 95, 100, 12],
      [t2, 89, 109, 94, 99, 11],
      [t1, 88, 108, 93, 98, 10],
      [t2, 1, 1, 1, 1, 1], // duplicate date
      [t1, "bad", 108, 93, 98, 10], // bad low
      "not-a-candle",
      [t3, 90, 110, 95, NaN, 12], // bad close
    ]);
    assert.equal(bars.length, 3);
    assert.deepEqual(
      bars.map((b) => b.date),
      ["2026-10-24", "2026-10-25", "2026-10-26"],
    );
    assert.deepEqual(bars[2], { date: "2026-10-26", open: 95, high: 110, low: 90, close: 100, volume: 12 });
  });

  it("converts_epoch_seconds_to_the_utc_calendar_date", () => {
    // 2024-01-01T00:00:00Z, 2024-01-01T12:00:00Z (same UTC day), 2024-01-02T00:00:00Z.
    const bars = parseCoinbaseCandles([
      [1704153600, 1, 2, 1, 2, 3],
      [1704110400, 1, 2, 1, 2, 3],
      [1704067200, 1, 2, 1, 2, 3],
    ]);
    // The two same-day timestamps collapse to one bar; oldest first.
    assert.deepEqual(
      bars.map((b) => b.date),
      ["2024-01-01", "2024-01-02"],
    );
  });

  it("returns_empty_for_non_arrays", () => {
    assert.deepEqual(parseCoinbaseCandles({}), []);
    assert.deepEqual(parseCoinbaseCandles(null), []);
  });
});

describe("fetchCoinbaseHistory", () => {
  it("pages_requests_past_300_days_and_merges_oldest_first", async () => {
    const dates = dateRange("2025-09-01");
    assert.ok(dates.length > 300, `need >300 days, got ${dates.length}`);
    const payload = JSON.stringify(candlesFor(dates, (i) => 100 + i * 0.1));
    const seen: string[] = [];
    const cache = new MarketCache(mkdtempSync(join(tmpdir(), "cb-page-")), silent, clock, fakeFetchImpl((url) => {
      seen.push(url);
      return payload;
    }));
    const bars = await fetchCoinbaseHistory(cache, "BTC-USD", dates[0] as string, TODAY, 60_000);
    assert.equal(bars.length, dates.length);
    assert.equal(bars[0]?.date, dates[0]);
    assert.equal(bars.at(-1)?.date, TODAY);
    // 400+ days need two 290-day windows.
    assert.equal(seen.length, 2);
    for (const url of seen) {
      const parsed = new URL(url);
      assert.ok(parsed.hostname === "api.exchange.coinbase.com");
      assert.ok(parsed.pathname.includes("/products/BTC-USD/candles"));
      assert.equal(parsed.searchParams.get("granularity"), "86400");
      const span =
        (Date.parse(parsed.searchParams.get("end") as string) -
          Date.parse(parsed.searchParams.get("start") as string)) /
        86_400_000;
      assert.ok(span <= 290, `window spans ${span} days`);
    }
  });
});

describe("MarketStore_crypto_routing", () => {
  function setup(asOf?: () => string | undefined) {
    const dates = dateRange("2024-01-01");
    const fetchImpl = fakeFetchImpl((url) => {
      if (url.includes("api.exchange.coinbase.com")) {
        return JSON.stringify(candlesFor(dates, (i) => 60_000 + i * 10 + (i % 2)));
      }
      return nasdaqPayload(dates, () => 100);
    });
    const store = new MarketStore({ dataDir: mkdtempSync(join(tmpdir(), "cb-store-")), log: silent, clock, asOf, fetchImpl });
    return { store };
  }

  it("routes_BTC-USD_to_coinbase_and_SPY_to_nasdaq", async () => {
    const { store } = setup();
    const btc = await store.history("BTC-USD", "1y");
    assert.equal(btc.source, "coinbase");
    // Crypto trades every day: about 365 bars for a 1y range.
    assert.ok(btc.bars.length >= 360 && btc.bars.length <= 370, `got ${btc.bars.length} bars`);
    assert.equal(btc.bars.at(-1)?.date, TODAY);
    const spy = await store.history("SPY", "1m");
    assert.equal(spy.source, "nasdaq");
    assert.ok(spy.bars.length > 0);
  });

  it("applies_the_asof_cutoff_to_crypto_like_equities", async () => {
    const { store } = setup(() => "2026-10-20");
    const btc = await store.history("BTC-USD", "1m");
    assert.equal(btc.source, "coinbase");
    assert.ok(btc.bars.length > 0);
    assert.ok(btc.bars.every((b) => b.date <= "2026-10-20"));
    assert.equal(btc.bars.at(-1)?.date, "2026-10-20");
  });

  it("bars_between_honors_exact_windows_for_crypto", async () => {
    const { store } = setup();
    const bars = await store.barsBetween("BTC-USD", "2026-10-01", "2026-10-07");
    assert.equal(bars.length, 7);
    assert.equal(bars[0]?.date, "2026-10-01");
    assert.equal(bars.at(-1)?.date, "2026-10-07");
  });
});

describe("market_indicators_crypto", () => {
  function setup() {
    const dates = dateRange("2024-01-01");
    const closeAt = (i: number): number => 60_000 + i * 10 + (i % 2) * 25;
    const fetchImpl = fakeFetchImpl((url) => {
      if (url.includes("api.exchange.coinbase.com")) return JSON.stringify(candlesFor(dates, closeAt));
      throw new Error(`unexpected fetch in test: ${url}`);
    });
    const dataDir = mkdtempSync(join(tmpdir(), "cb-ind-"));
    const ext = createMarketExtension({
      market: fakeMarket([]),
      dataDir,
      log: silent,
      clock,
      fetchImpl,
    });
    const store = new MarketStore({ dataDir, log: silent, clock, fetchImpl });
    return { ext, store };
  }

  it("counts_return_windows_in_calendar_days_and_annualizes_with_sqrt365", async () => {
    const { ext, store } = setup();
    const result = await callTool(ext, "market_indicators", { symbol: "BTC-USD", range: "1y" });
    assert.equal(result.isError, undefined);
    const s = result.structuredOutput as unknown as {
      date: string;
      ret1m: number;
      ret3m: number;
      ret6m: number;
      ret1y: number;
      realizedVol20: number;
      high52w: number;
      low52w: number;
    };
    // The exact bars the tool computed over.
    const { full } = await store.extended("BTC-USD", "1y");
    assert.ok(full.length > 400);
    const c = closes(full);
    assert.equal(s.date, TODAY);
    assert.ok(Math.abs((s.ret1m ?? NaN) - (periodReturn(c, 30) ?? NaN)) < 1e-12);
    assert.ok(Math.abs((s.ret3m ?? NaN) - (periodReturn(c, 90) ?? NaN)) < 1e-12);
    assert.ok(Math.abs((s.ret6m ?? NaN) - (periodReturn(c, 180) ?? NaN)) < 1e-12);
    assert.ok(Math.abs((s.ret1y ?? NaN) - (periodReturn(c, 365) ?? NaN)) < 1e-12);
    assert.ok(Math.abs((s.realizedVol20 ?? NaN) - (realizedVol(c, 20, 365) ?? NaN)) < 1e-12);
    // The 252-based value must differ, proving sqrt(365) is used.
    assert.notEqual(s.realizedVol20, realizedVol(c, 20));
    const year = full.slice(full.length - 365);
    assert.equal(s.high52w, Math.max(...year.map((b) => b.high)));
    assert.equal(s.low52w, Math.min(...year.map((b) => b.low)));
  });

  it("keeps_equity_windows_on_252", async () => {
    const dates = dateRange("2024-01-01");
    const fetchImpl = fakeFetchImpl((url) => {
      if (url.includes("api.nasdaq.com")) return nasdaqPayload(dates, (i) => 100 + i * 0.05 + (i % 2) * 0.3);
      throw new Error(`unexpected fetch in test: ${url}`);
    });
    const ext = createMarketExtension({
      market: fakeMarket([]),
      dataDir: mkdtempSync(join(tmpdir(), "cb-ind-eq-")),
      log: silent,
      clock,
      fetchImpl,
    });
    const result = await callTool(ext, "market_indicators", { symbol: "SPY", range: "1y" });
    assert.equal(result.isError, undefined);
    const s = result.structuredOutput as unknown as { realizedVol20: number; ret1m: number };
    assert.ok(s.realizedVol20 !== null && s.realizedVol20 > 0);
    assert.ok(s.ret1m !== null);
  });
});

describe("market_compare_mixed_calendars", () => {
  it("aligns_a_weekend_crypto_series_against_weekday_equity", async () => {
    const dates = dateRange("2025-01-01");
    const fetchImpl = fakeFetchImpl((url) => {
      if (url.includes("api.exchange.coinbase.com")) {
        // Crypto trades every day, weekends included.
        return JSON.stringify(candlesFor(dates, (i) => 60_000 + i * 10 + (i % 3) * 17));
      }
      if (url.includes("api.nasdaq.com")) {
        // Equities print weekdays only.
        const weekdays = dates.filter(isWeekday);
        return nasdaqPayload(weekdays, (i) => 500 + i * 0.2 + (i % 2) * 0.4);
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    });
    const dataDir = mkdtempSync(join(tmpdir(), "cb-cmp-"));
    const store = new MarketStore({ dataDir, log: silent, clock, fetchImpl });
    const ext = createMarketExtension({ market: store, dataDir, log: silent, clock, fetchImpl });
    const result = await callTool(ext, "market_compare", { symbols: ["BTC-USD"], range: "3m" });
    assert.equal(result.isError, undefined);
    const s = result.structuredOutput as unknown as {
      benchmark: string;
      rows: { symbol: string; beta: number | null; correlation: number | null }[];
      correlation: { symbols: string[]; matrix: (number | null)[][] };
    };
    assert.equal(s.benchmark, "SPY");
    assert.equal(s.rows.length, 1);
    assert.equal(s.rows[0]?.symbol, "BTC-USD");
    assert.notEqual(s.rows[0]?.beta, null);
    assert.notEqual(s.rows[0]?.correlation, null);
    assert.deepEqual(s.correlation.symbols, ["SPY", "BTC-USD"]);
  });
});
