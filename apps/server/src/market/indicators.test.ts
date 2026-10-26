import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "@rh/shared";
import {
  alignReturns,
  atr,
  avgDollarVolume,
  beta,
  betaAndCorrelation,
  bollinger,
  classifyTrend,
  correlation,
  dailyReturns,
  donchian,
  ema,
  macd,
  maxDrawdown,
  periodReturn,
  realizedVol,
  rsi,
  sma,
} from "./indicators.ts";

function bar(date: string, close: number, high?: number, low?: number, volume = 1_000_000): Bar {
  return { date, open: close, high: high ?? close + 1, low: low ?? close - 1, close, volume };
}

function series(closes: number[], startDay = 1): Bar[] {
  return closes.map((c, i) => bar(`2026-09-${String(startDay + i).padStart(2, "0")}`, c));
}

describe("sma", () => {
  it("averages_1_to_20_as_10_5", () => {
    assert.equal(sma(Array.from({ length: 20 }, (_, i) => i + 1), 20), 10.5);
  });
  it("returns_undefined_when_short", () => {
    assert.equal(sma([1, 2, 3], 20), undefined);
  });
});

describe("ema", () => {
  it("holds_a_flat_series", () => {
    assert.equal(ema([10, 10, 10, 10, 10], 5), 10);
  });
  it("weights_recent_values_on_a_jump", () => {
    const e = ema([1, 1, 1, 1, 1, 10, 10], 5);
    assert.ok(e !== undefined && Math.abs(e - 6) < 1e-9);
  });
});

describe("rsi", () => {
  it("is_100_for_a_steady_rise", () => {
    assert.equal(rsi(Array.from({ length: 16 }, (_, i) => i + 1), 14), 100);
  });
  it("is_0_for_a_steady_fall", () => {
    assert.equal(rsi(Array.from({ length: 16 }, (_, i) => 16 - i), 14), 0);
  });
  it("is_50_for_a_flat_series", () => {
    assert.equal(rsi(new Array(16).fill(100), 14), 50);
  });
  it("stays_100_for_a_longer_rise", () => {
    assert.equal(rsi(Array.from({ length: 30 }, (_, i) => i + 1), 14), 100);
  });
  it("returns_undefined_when_short", () => {
    assert.equal(rsi([1, 2, 3], 14), undefined);
  });
});

describe("atr", () => {
  const bars = [
    bar("2026-09-01", 9.5, 10, 9),
    bar("2026-09-02", 10.5, 11, 9.5),
    bar("2026-09-03", 11, 12, 10),
  ];
  it("averages_true_ranges_with_period_2", () => {
    // TRs are 1.5 and 2.0, so ATR(2) is 1.75.
    assert.equal(atr(bars, 2), 1.75);
  });
  it("smooths_with_wilder_recursion", () => {
    // One more bar with TR 2.0: (1.75 * 1 + 2.0) / 2 = 1.875.
    assert.equal(atr([...bars, bar("2026-09-04", 12, 13, 11)], 2), 1.875);
  });
  it("returns_undefined_when_short", () => {
    assert.equal(atr(bars.slice(0, 2), 2), undefined);
  });
});

describe("macd", () => {
  it("needs_35_closes", () => {
    assert.equal(macd(Array.from({ length: 34 }, (_, i) => i + 1)), undefined);
  });
  it("is_internally_consistent_on_a_trend", () => {
    const m = macd(Array.from({ length: 60 }, (_, i) => 100 + i + Math.sin(i) * 0.5));
    assert.ok(m !== undefined);
    assert.ok(Math.abs(m.histogram - (m.macd - m.signal)) < 1e-9);
    assert.ok(m.macd > m.signal); // uptrend: line above signal
  });
});

describe("bollinger", () => {
  it("matches_hand_computed_bands_for_1_to_20", () => {
    const bb = bollinger(Array.from({ length: 20 }, (_, i) => i + 1));
    assert.ok(bb !== undefined);
    assert.equal(bb.middle, 10.5);
    const sd = Math.sqrt(33.25); // population variance of 1..20
    assert.ok(Math.abs(bb.upper - (10.5 + 2 * sd)) < 1e-9);
    assert.ok(Math.abs(bb.lower - (10.5 - 2 * sd)) < 1e-9);
    assert.ok(Math.abs(bb.percentB - (20 - bb.lower) / (bb.upper - bb.lower)) < 1e-12);
  });
});

describe("donchian", () => {
  it("takes_extremes_of_the_last_20", () => {
    const bars = series(Array.from({ length: 25 }, (_, i) => 100 + i));
    const dc = donchian(bars, 20);
    assert.deepEqual(dc, { high: 125, low: 104 });
  });
});

describe("periodReturn_realizedVol_drawdown", () => {
  it("computes_a_one_session_return", () => {
    assert.ok(Math.abs((periodReturn([100, 110], 1) ?? NaN) - 0.1) < 1e-12);
  });
  it("is_zero_volatility_for_flat_prices", () => {
    assert.equal(realizedVol([100, 100, 100, 100], 3), 0);
  });
  it("finds_the_worst_peak_to_trough", () => {
    assert.equal(maxDrawdown([100, 120, 90, 110]), -0.25);
  });
  it("returns_undefined_when_short", () => {
    assert.equal(periodReturn([100], 1), undefined);
    assert.equal(realizedVol([100], 1), undefined);
    assert.equal(maxDrawdown([100]), undefined);
  });
});

describe("avgDollarVolume", () => {
  it("averages_close_times_volume", () => {
    const bars = [bar("2026-09-01", 10, 11, 9, 100), bar("2026-09-02", 20, 21, 19, 100)];
    assert.equal(avgDollarVolume(bars, 2), 1500);
  });
});

describe("beta_and_correlation", () => {
  const a = series([100, 101, 102, 103, 104], 1);
  const b = series([50, 50.5, 51, 51.5, 52], 1);
  it("is_one_for_identical_return_shapes", () => {
    const { beta: be, correlation: co } = betaAndCorrelation(a, b);
    assert.ok(be !== undefined && Math.abs(be - 1) < 1e-9);
    assert.ok(co !== undefined && Math.abs(co - 1) < 1e-9);
  });
  it("aligns_by_date_and_drops_missing_days", () => {
    const sparse = b.slice(0, 4); // dates 01..04, so returns align on 02..04
    const aligned = alignReturns(dailyReturns(a), dailyReturns(sparse));
    assert.equal(aligned.a.length, 3);
    assert.equal(beta(aligned.a, aligned.b), 1);
    assert.equal(correlation(aligned.a, aligned.b), 1);
  });
  it("returns_undefined_without_overlap", () => {
    const { beta: be, correlation: co } = betaAndCorrelation(a.slice(0, 1), b);
    assert.equal(be, undefined);
    assert.equal(co, undefined);
  });
});

describe("classifyTrend", () => {
  it("labels_up_down_and_sideways", () => {
    assert.equal(classifyTrend(110, 100, 90), "up");
    assert.equal(classifyTrend(90, 100, 110), "down");
    assert.equal(classifyTrend(105, 100, 110), "sideways");
    assert.equal(classifyTrend(110, undefined, 90), "sideways");
  });
});
