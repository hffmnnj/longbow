import { describe, expect, it } from "vitest";
import type { Bar } from "@rh/shared";
import { periodReturn, sma } from "./chart.ts";

const bars = (closes: number[]): Bar[] =>
  closes.map((close, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, open: close, high: close, low: close, close, volume: 1 }));

describe("sma", () => {
  it("starts once a full window exists and slides", () => {
    expect(sma(bars([1, 2, 3, 4, 5]), 3)).toEqual([
      { time: "2026-01-03", value: 2 },
      { time: "2026-01-04", value: 3 },
      { time: "2026-01-05", value: 4 },
    ]);
  });
  it("is empty when there are fewer bars than the period", () => {
    expect(sma(bars([1, 2]), 20)).toEqual([]);
  });
});

describe("periodReturn", () => {
  it("is last over first close in percent", () => {
    expect(periodReturn(bars([100, 90, 110]))).toBeCloseTo(10);
    expect(periodReturn([])).toBeUndefined();
  });
});
