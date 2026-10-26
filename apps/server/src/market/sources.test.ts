import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseEconomicEvents,
  parseEarningsCalendar,
  parseEarningsDate,
  parseNasdaqHistory,
  parseNasdaqNumber,
} from "./sources/nasdaq.ts";
import { parseCboeCsv as parseVix } from "./sources/cboe.ts";
import { parseTreasuryCsv } from "./sources/treasury.ts";
import { filingIndexUrl, parseSubmissions, pickFactPoints } from "./sources/sec.ts";

describe("parseNasdaqNumber", () => {
  it("parses_formatted_strings_and_numbers", () => {
    assert.equal(parseNasdaqNumber("$671.23"), 671.23);
    assert.equal(parseNasdaqNumber("12,345,678"), 12345678);
    assert.equal(parseNasdaqNumber("759.97"), 759.97);
    assert.equal(parseNasdaqNumber(42), 42);
  });
  it("rejects_non_numeric_cells", () => {
    assert.equal(parseNasdaqNumber("N/A"), undefined);
    assert.equal(parseNasdaqNumber("--"), undefined);
    assert.equal(parseNasdaqNumber(""), undefined);
    assert.equal(parseNasdaqNumber(null), undefined);
    assert.equal(parseNasdaqNumber("12.34.56"), undefined);
  });
});

describe("parseNasdaqHistory", () => {
  const payload = {
    data: {
      symbol: "SPY",
      tradesTable: {
        rows: [
          // Newest first upstream.
          { date: "10/23/2026", open: "$759.90", high: "763.47", low: "758.68", close: "759.97", volume: "33,423,220" },
          { date: "10/22/2026", open: "763.96", high: "765.00", low: "759.00", close: "763.96", volume: "30,000,000" },
          // Malformed close: dropped.
          { date: "10/21/2026", open: "760.00", high: "764.00", low: "759.00", close: "N/A", volume: "29,000,000" },
          // Duplicate date: dropped.
          { date: "10/22/2026", open: "1", high: "1", low: "1", close: "1", volume: "1" },
          // Bad date: dropped.
          { date: "yesterday", open: "1", high: "1", low: "1", close: "1", volume: "1" },
        ],
      },
    },
  };
  it("returns_oldest_first_and_drops_bad_rows", () => {
    const bars = parseNasdaqHistory(payload);
    assert.equal(bars.length, 2);
    assert.equal(bars[0]?.date, "2026-10-22");
    assert.equal(bars[1]?.date, "2026-10-23");
    assert.equal(bars[1]?.close, 759.97);
    assert.equal(bars[1]?.volume, 33423220);
  });
  it("returns_empty_for_missing_tables", () => {
    assert.deepEqual(parseNasdaqHistory({ data: null }), []);
    assert.deepEqual(parseNasdaqHistory({}), []);
  });
});

describe("parseEarningsCalendar", () => {
  it("keeps_named_fields_and_normalizes_time", () => {
    const rows = parseEarningsCalendar({
      data: {
        rows: [
          { symbol: "V", name: "Visa Inc.", time: "time-after-hours", epsForecast: "$3.43", marketCap: "$740,324,150,000" },
          { symbol: "KO", name: "Coca-Cola", time: "time-pre-market", epsForecast: "$0.87", marketCap: "bad" },
          { symbol: "", name: "Nameless" },
        ],
      },
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.time, "after hours");
    assert.equal(rows[0]?.marketCapNum, 740324150000);
    assert.equal(rows[1]?.time, "pre-market");
    assert.equal(rows[1]?.marketCapNum, undefined);
  });
});

describe("parseEarningsDate", () => {
  it("parses_report_text", () => {
    const out = parseEarningsDate({
      data: {
        reportText:
          "Apple Inc. Common Stock is expected* to report earnings on  11/02/2026 after market close. " +
          "According to Zacks Investment Research, the consensus EPS forecast for the quarter is $2. The reported EPS " +
          "for the same quarter last year was $1.85.",
        announcement: "Earnings announcement* for AAPL: Nov 02, 2026",
      },
    });
    assert.deepEqual(out, { date: "2026-11-02", time: "after hours", epsForecast: "$2" });
  });
  it("falls_back_to_the_announcement_field", () => {
    assert.deepEqual(parseEarningsDate({ data: { announcement: "Earnings announcement* for AAPL: Nov 02, 2026" } }), {
      date: "2026-11-02",
    });
  });
  it("returns_undefined_without_a_date", () => {
    assert.equal(parseEarningsDate({ data: { reportText: "no date here" } }), undefined);
    assert.equal(parseEarningsDate({}), undefined);
  });
});

describe("parseEconomicEvents", () => {
  it("drops_nbsp_cells_and_keeps_countries", () => {
    const events = parseEconomicEvents({
      data: {
        rows: [
          { gmt: "08:30", country: "United States", eventName: "Chicago Fed National Activity", actual: "&nbsp;", consensus: " ", previous: "-0.04" },
          { gmt: "01:00", country: "Japan", eventName: "Coincident Indicator", actual: "1.2", consensus: "-1.9%", previous: "1.7%" },
          { gmt: "", country: "United States", eventName: "No time" },
        ],
      },
    });
    assert.equal(events.length, 2);
    assert.deepEqual(events[0], { time: "08:30", country: "United States", event: "Chicago Fed National Activity", previous: "-0.04" });
  });
});

describe("parseCboeCsv", () => {
  const csv = [
    "DATE,OPEN,HIGH,LOW,CLOSE",
    "10/23/2026,18.10,18.90,17.80,18.42",
    "10/22/2026,17.50,18.20,17.10,17.90",
    "bad,row,here",
  ].join("\n");
  it("parses_newest_or_oldest_and_sorts", () => {
    const bars = parseVix(csv);
    assert.equal(bars.length, 2);
    assert.deepEqual(bars[0], { date: "2026-10-22", open: 17.5, high: 18.2, low: 17.1, close: 17.9 });
    assert.equal(bars[1]?.close, 18.42);
  });
});

describe("parseTreasuryCsv", () => {
  const csv = [
    'Date,"1 Mo","3 Mo","6 Mo","1 Yr","2 Yr","10 Yr","30 Yr"',
    "10/23/2026,4.11,4.22,4.30,4.44,4.69,5.00,5.33",
    "10/22/2026,4.11,4.22,4.29,4.41,4.65,4.96,5.29",
    "10/21/2026,N/A,N/A,N/A,N/A,N/A,N/A,N/A",
  ].join("\n");
  it("normalizes_tenors_and_drops_empty_rows", () => {
    const rows = parseTreasuryCsv(csv);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.date, "2026-10-22");
    assert.deepEqual(rows[1]?.curve, { "1M": 4.11, "3M": 4.22, "6M": 4.3, "1Y": 4.44, "2Y": 4.69, "10Y": 5.0, "30Y": 5.33 });
  });
});

describe("sec_parsers", () => {
  it("builds_filing_index_urls", () => {
    assert.equal(
      filingIndexUrl("0000320193", "0000320193-25-000123"),
      "https://www.sec.gov/Archives/edgar/data/320193/000032019325000123/",
    );
  });
  it("parses_recent_filings", () => {
    const info = parseSubmissions("0000320193", {
      name: "Apple Inc.",
      sic: "3571",
      sicDescription: "Electronic Computers",
      filings: {
        recent: {
          form: ["10-K", "8-K"],
          filingDate: ["2025-10-31", "2025-10-30"],
          accessionNumber: ["0000320193-25-000123", "0000320193-25-000100"],
          primaryDocument: ["aapl-20250927x10k.htm", "aapl-8k.htm"],
          reportDate: ["2025-09-27", ""],
        },
      },
    });
    assert.equal(info.filings.length, 2);
    assert.equal(info.filings[0]?.url, "https://www.sec.gov/Archives/edgar/data/320193/000032019325000123/");
    assert.equal(info.filings[0]?.description, "10-K (report date 2025-09-27)");
    assert.equal(info.filings[1]?.description, "8-K (aapl-8k.htm)");
  });
  it("picks_the_last_8_fact_periods_oldest_first", () => {
    const points = Array.from({ length: 10 }, (_, i) => ({
      end: `2023-${String(i + 1).padStart(2, "0")}-15`,
      val: 100 + i,
      form: "10-Q",
      fy: 2023,
      fp: "Q1",
    }));
    const root = { facts: { "us-gaap": { Nope: { units: {} }, Revenues: { units: { USD: points } } } } };
    const picked = pickFactPoints(root, ["Missing", "Revenues"]);
    assert.equal(picked.length, 8);
    assert.ok(picked[0]!.end <= picked[7]!.end);
    assert.equal(picked[7]!.value, 109);
  });
});
