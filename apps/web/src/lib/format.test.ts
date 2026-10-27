import { describe, expect, it } from "vitest";
import { ago, countdown, durationShort, etClock, etStamp, etTime, pct, pctSigned, priceFor, qtyFor, qtyUnit, tone, usd, usdSigned } from "./format.ts";

describe("currency", () => {
  it("formats two decimals with thousands separators", () => {
    expect(usd(1234567.8)).toBe("$1,234,567.80");
    expect(usd(0)).toBe("$0.00");
  });
  it("uses a real minus sign for negatives", () => {
    expect(usd(-12.5)).toBe("\u2212$12.50");
  });
  it("prefixes signed amounts and leaves zero unsigned", () => {
    expect(usdSigned(42.1)).toBe("+$42.10");
    expect(usdSigned(-42.1)).toBe("\u2212$42.10");
    expect(usdSigned(0.001)).toBe("$0.00");
    expect(usdSigned(-0.001)).toBe("$0.00");
  });
});

describe("percent", () => {
  it("signs and rounds to two decimals", () => {
    expect(pctSigned(1.2345)).toBe("+1.23%");
    expect(pctSigned(-0.4)).toBe("\u22120.40%");
    expect(pctSigned(0)).toBe("0.00%");
    expect(pct(12.5)).toBe("12.50%");
  });
});

describe("tone", () => {
  it("treats sub-cent values as flat", () => {
    expect(tone(0.004)).toBe("flat");
    expect(tone(3)).toBe("gain");
    expect(tone(-3)).toBe("loss");
  });
});

describe("time zone formatting", () => {
  it("renders in the requested zone across DST", () => {
    // 2026-07-01T14:05:09Z is 10:05:09 EDT; 2026-01-15T14:05:09Z is 09:05:09 EST.
    expect(etClock(Date.UTC(2026, 6, 1, 14, 5, 9), "America/New_York")).toBe("10:05:09 EDT");
    expect(etTime(Date.UTC(2026, 0, 15, 14, 5, 9), "America/New_York")).toBe("09:05 EST");
  });
  it("renders midnight as 00, not 24", () => {
    expect(etTime(Date.UTC(2026, 0, 15, 5, 0, 0), "America/New_York")).toBe("00:00 EST");
  });
  it("defaults to the host zone", () => {
    // The formatter's zone name is whatever the runtime resolves; only the shape is fixed.
    expect(etTime(Date.UTC(2026, 0, 15, 14, 5, 9))).toMatch(/^\d{2}:\d{2} \S+$/);
  });
});

describe("countdown and ago", () => {
  it("picks the two most useful units", () => {
    expect(countdown(45_000)).toBe("45s");
    expect(countdown(5 * 60_000 + 7_000)).toBe("5m 07s");
    expect(countdown(3 * 3_600_000 + 12 * 60_000)).toBe("3h 12m");
    expect(countdown(50 * 3_600_000)).toBe("2d 2h");
    expect(countdown(-5)).toBe("0s");
  });
  it("describes recency", () => {
    const now = Date.UTC(2026, 9, 24, 15, 0, 0);
    expect(ago(now - 10_000, now)).toBe("just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5m ago");
    expect(ago(now - 3 * 3_600_000, now)).toBe("3h ago");
  });
});

describe("durationShort", () => {
  it("scales units", () => {
    expect([412, 1840, 12_400, 65_000].map(durationShort)).toEqual(["412ms", "1.8s", "12s", "1m 05s"]);
  });
});

describe("historical feed timestamps", () => {
  const zone = "America/New_York";
  // Two distinct historical instants on the same day, an hour apart.
  const first = Date.UTC(2026, 9, 24, 14, 5, 9);
  const second = Date.UTC(2026, 9, 24, 15, 5, 9);
  // A much later reload: history must not collapse onto this clock.
  const laterNow = Date.UTC(2026, 9, 25, 12, 0, 0);

  it("keeps two historical instants distinct after a reload with a later clock", () => {
    expect(etClock(first, zone)).toBe("10:05:09 EDT");
    expect(etClock(second, zone)).toBe("11:05:09 EDT");
    expect(etClock(laterNow, zone)).toBe("08:00:00 EDT");
    expect(etTime(first, zone)).toBe("10:05 EDT");
    expect(etTime(second, zone)).toBe("11:05 EDT");
    expect(etTime(laterNow, zone)).toBe("08:00 EDT");
  });

  it("stamps history with its own day, not the reload day", () => {
    expect(etStamp(first, laterNow, zone)).toBe("Oct 24 10:05 EDT");
    expect(etStamp(laterNow, laterNow, zone)).toBe("08:00 EDT");
  });

  it("reads recency from the event time against the given now, not the current clock", () => {
    expect(ago(laterNow - 5 * 60_000, laterNow)).toBe("5m ago");
    expect(ago(laterNow - 3 * 3_600_000, laterNow)).toBe("3h ago");
  });

  it("derives a completed step duration from stored script/result times, not the reload clock", () => {
    const wall = second - first;
    expect(durationShort(wall)).toBe("60m 00s");
  });
});

describe("crypto quantities and prices", () => {
  it("keeps shares exactly as today", () => {
    expect(qtyFor("AAPL", 8.5)).toBe("8.5");
    expect(qtyFor("NVDA", 12)).toBe("12");
    expect(qtyUnit("AAPL")).toBe("shares");
  });
  it("shows coin fractions with up to 8 decimals, trimmed", () => {
    expect(qtyFor("BTC-USD", 0.00058109)).toBe("0.00058109");
    expect(qtyFor("BTC-USD", 1.5)).toBe("1.5");
    expect(qtyFor("ETH-USD", 0.1)).toBe("0.1");
    expect(qtyFor("BTC-USD", 0)).toBe("0");
    expect(qtyUnit("BTC-USD")).toBe("coins");
  });
  it("groups large crypto prices and keeps sub-dollar precision", () => {
    expect(priceFor("BTC-USD", 80062.48)).toBe("$80,062.48");
    expect(priceFor("BTC-USD", 0.2134)).toBe("$0.2134");
    expect(priceFor("AAPL", 413.2)).toBe("$413.20");
  });
});
