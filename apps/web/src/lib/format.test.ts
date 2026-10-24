import { describe, expect, it } from "vitest";
import { ago, countdown, etClock, etTime, pct, pctSigned, tone, usd, usdSigned } from "./format.ts";

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

describe("Eastern time", () => {
  it("renders in America/New_York across DST", () => {
    // 2026-07-01T14:05:09Z is 10:05:09 EDT; 2026-01-15T14:05:09Z is 09:05:09 EST.
    expect(etClock(Date.UTC(2026, 6, 1, 14, 5, 9))).toBe("10:05:09 ET");
    expect(etTime(Date.UTC(2026, 0, 15, 14, 5, 9))).toBe("09:05 ET");
  });
  it("renders midnight as 00, not 24", () => {
    expect(etTime(Date.UTC(2026, 0, 15, 5, 0, 0))).toBe("00:00 ET");
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
