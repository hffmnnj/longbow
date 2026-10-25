import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "@rh/shared";
import { atrPctSeries, evaluateScreen, pullbackDays } from "./screen.ts";

function mkBars(closes: number[], opts?: { volume?: number; lastVolume?: number; spread?: number }): Bar[] {
  const spread = opts?.spread ?? 0.5;
  return closes.map((close, i) => {
    const day = i + 1;
    const date = `2024-${String(Math.floor((day - 1) / 28) + 1).padStart(2, "0")}-${String(((day - 1) % 28) + 1).padStart(2, "0")}`;
    const volume = i === closes.length - 1 ? (opts?.lastVolume ?? opts?.volume ?? 1_000_000) : (opts?.volume ?? 1_000_000);
    return { date, open: close, high: close + spread, low: close - spread, close, volume };
  });
}

function rising(n: number, from: number, step: number): number[] {
  return Array.from({ length: n }, (_, i) => from + i * step);
}

describe("pullbackDays", () => {
  it("counts_trailing_down_closes", () => {
    assert.equal(pullbackDays([100, 101, 100, 99, 98]), 3);
    assert.equal(pullbackDays([100, 101, 102]), 0);
  });
});

describe("trend_template", () => {
  it("passes_a_rising_uptrend_near_its_high", () => {
    const bars = mkBars(rising(260, 100, 0.4));
    const out = evaluateScreen({ symbol: "AAA", bars, benchRet3m: 0.05 }, "trend_template");
    assert.ok(out.row, `expected a row, got skip: ${out.skip}`);
    assert.ok(out.row.above50 && out.row.above200);
    assert.ok((out.row.dist52w ?? -1) > -0.25);
  });
  it("rejects_a_downtrend", () => {
    const bars = mkBars(rising(260, 200, -0.4));
    const out = evaluateScreen({ symbol: "AAA", bars }, "trend_template");
    assert.equal(out.row, undefined);
    assert.match(out.skip ?? "", /uptrend/);
  });
});

describe("breakout_52w", () => {
  it("passes_within_3pct_of_the_high_on_high_volume", () => {
    const bars = mkBars(new Array(60).fill(100), { lastVolume: 3_000_000 });
    const out = evaluateScreen({ symbol: "AAA", bars }, "breakout_52w");
    assert.ok(out.row, `expected a row, got skip: ${out.skip}`);
  });
  it("rejects_quiet_volume", () => {
    const bars = mkBars(new Array(60).fill(100));
    const out = evaluateScreen({ symbol: "AAA", bars }, "breakout_52w");
    assert.equal(out.row, undefined);
  });
});

describe("pullback_20d", () => {
  it("passes_an_uptrend_pullback_to_the_20day", () => {
    const closes = [...rising(250, 100, 0.4), 199.4, 198.9, 198.4, 197.9];
    const bars = mkBars(closes);
    const out = evaluateScreen({ symbol: "AAA", bars }, "pullback_20d");
    assert.ok(out.row, `expected a row, got skip: ${out.skip}`);
  });
  it("rejects_without_a_3day_pullback", () => {
    const bars = mkBars(rising(260, 100, 0.4));
    const out = evaluateScreen({ symbol: "AAA", bars }, "pullback_20d");
    assert.equal(out.row, undefined);
    assert.match(out.skip ?? "", /pullback/);
  });
});

describe("rsi_oversold_uptrend", () => {
  it("passes_an_rsi2_washout_above_the_200day", () => {
    const closes = [...rising(258, 50, 0.2), 95, 88];
    const bars = mkBars(closes);
    const out = evaluateScreen({ symbol: "AAA", bars }, "rsi_oversold_uptrend");
    assert.ok(out.row, `expected a row, got skip: ${out.skip}`);
    assert.ok(out.row.above200);
  });
  it("rejects_when_rsi2_is_not_oversold", () => {
    const bars = mkBars(rising(260, 100, 0.4));
    const out = evaluateScreen({ symbol: "AAA", bars }, "rsi_oversold_uptrend");
    assert.equal(out.row, undefined);
  });
});

describe("relative_strength", () => {
  it("scores_return_minus_benchmark", () => {
    const bars = mkBars([...rising(100, 100, 0.3)]);
    const strong = evaluateScreen({ symbol: "AAA", bars, benchRet3m: 0.01 }, "relative_strength");
    const weak = evaluateScreen({ symbol: "BBB", bars, benchRet3m: 0.2 }, "relative_strength");
    assert.ok(strong.row && weak.row);
    assert.ok(strong.row.score > weak.row.score);
    assert.ok(Math.abs(strong.row.score - ((strong.row.ret3m ?? 0) - 0.01)) < 1e-12);
  });
});

describe("volatility_contraction", () => {
  it("passes_a_flat_tape_after_a_volatile_year", () => {
    const volatile = Array.from({ length: 150 }, (_, i) => 100 + (i % 2 === 0 ? 3 : -3));
    const flat = Array.from({ length: 150 }, (_, i) => 100 + i * 0.002);
    const bars = mkBars([...volatile, ...flat], { spread: 0.05 });
    const out = evaluateScreen({ symbol: "AAA", bars }, "volatility_contraction");
    assert.ok(out.row, `expected a row, got skip: ${out.skip}`);
    const series = atrPctSeries(bars);
    assert.ok(series.length >= 50);
  });
  it("rejects_an_expanding_range", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + (i % 2 === 0 ? i * 0.05 : -i * 0.05));
    const bars = mkBars(closes);
    const out = evaluateScreen({ symbol: "AAA", bars }, "volatility_contraction");
    assert.equal(out.row, undefined);
  });
});
