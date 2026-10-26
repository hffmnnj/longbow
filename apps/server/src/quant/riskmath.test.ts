import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  alignLast,
  annualizedVol,
  correlationMatrix,
  portfolioBeta,
  portfolioSeries,
  varEs95,
  worstDayIndices,
  type DatedReturn,
} from "./riskmath.ts";

function dated(returns: number[]): DatedReturn[] {
  return returns.map((r, i) => ({ date: `2024-01-${String(i + 1).padStart(2, "0")}`, r }));
}

describe("correlationMatrix", () => {
  it("finds_unit_correlation_and_the_top_pair", () => {
    const a = [0.01, -0.02, 0.03, 0.01, -0.01];
    const out = correlationMatrix(
      new Map([
        ["A", a],
        ["B", a.map((v) => v * 2)],
        ["C", a.map((v) => -v)],
      ]),
    );
    assert.deepEqual(out.symbols, ["A", "B", "C"]);
    assert.ok(Math.abs((out.matrix[0]?.[1] ?? 0) - 1) < 1e-9);
    assert.equal(out.top?.a, "A");
    assert.equal(out.top?.b, "B");
    assert.ok(Math.abs((out.top?.correlation ?? 0) - 1) < 1e-9);
  });
});

describe("portfolioBeta", () => {
  it("is_one_against_itself", () => {
    const r = [0.01, -0.02, 0.03, 0.015, -0.005, 0.02];
    assert.ok(Math.abs((portfolioBeta(r, r) ?? 0) - 1) < 1e-12);
  });
  it("is_zero_for_cash", () => {
    const bench = [0.01, -0.02, 0.03, 0.015, -0.005, 0.02];
    assert.equal(portfolioBeta([0, 0, 0, 0, 0, 0], bench), 0);
  });
});

describe("varEs95", () => {
  it("measures_the_left_tail", () => {
    const daily = [...new Array(95).fill(0.001), -0.02, -0.03, -0.04, -0.05, -0.06];
    const ve = varEs95(daily);
    assert.ok(ve);
    assert.ok(ve.varPct > 0 && ve.esPct >= ve.varPct);
    assert.equal(ve.varPct, 0.02);
    assert.ok(Math.abs(ve.esPct - (0.02 + 0.03 + 0.04 + 0.05 + 0.06) / 5) < 1e-12);
  });
  it("needs_at_least_20_points", () => {
    assert.equal(varEs95([0.01, -0.01]), undefined);
  });
});

describe("alignLast", () => {
  it("intersects_on_common_dates_and_takes_the_tail", () => {
    const { dates, matrix } = alignLast(
      new Map([
        ["A", dated([0.01, 0.02, 0.03])],
        ["B", [...dated([0.05, 0.06]), { date: "2024-01-04", r: 0.07 }]],
      ]),
      ["A", "B"],
      10,
    );
    assert.deepEqual(dates, ["2024-01-01", "2024-01-02"]);
    assert.deepEqual(matrix.get("A"), [0.01, 0.02]);
    assert.deepEqual(matrix.get("B"), [0.05, 0.06]);
  });
});

describe("portfolioSeries", () => {
  it("weights_component_returns", () => {
    const out = portfolioSeries(
      new Map([
        ["A", [0.01, 0.02]],
        ["B", [0.03, -0.01]],
      ]),
      new Map([
        ["A", 0.6],
        ["B", 0.4],
      ]),
    );
    assert.ok(Math.abs((out[0] ?? 0) - 0.018) < 1e-12);
    assert.ok(Math.abs((out[1] ?? 0) - 0.008) < 1e-12);
  });
});

describe("annualizedVol", () => {
  it("scales_daily_stdev_by_sqrt252", () => {
    const daily = [0.01, -0.01, 0.01, -0.01];
    const vol = annualizedVol(daily);
    assert.ok(vol !== undefined && vol > 0);
    const mean = 0;
    const variance = daily.reduce((a, r) => a + (r - mean) ** 2, 0) / 3;
    assert.ok(Math.abs((vol ?? 0) - Math.sqrt(variance * 252)) < 1e-12);
  });
});

describe("worstDayIndices", () => {
  it("picks_the_worst_days_oldest_first", () => {
    assert.deepEqual(worstDayIndices([0.01, -0.05, 0.02, -0.03, -0.01], 2), [1, 3]);
  });
});
