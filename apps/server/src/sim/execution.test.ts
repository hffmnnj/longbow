import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "@rh/shared";
import { avgDollarVolumeBefore, halfSpreadBps, returnVolatilityBefore, slippageBps } from "./execution.ts";

const bar = (date: string, close: number, volume = 10_000_000): Bar =>
  ({ date, open: 100, low: 99, high: 101, close, volume });

test("half-spread tiers by average dollar volume and widens at the open", () => {
  assert.equal(halfSpreadBps(5_000_000_000, 60), 1);
  assert.equal(halfSpreadBps(1_000_000_000, 60), 2);
  assert.equal(halfSpreadBps(200_000_000, 60), 5);
  assert.equal(halfSpreadBps(199_999_999, 60), 15);
  assert.equal(halfSpreadBps(undefined, 60), 15);
  assert.equal(halfSpreadBps(5_000_000_000, 0), 1.5);
  assert.equal(halfSpreadBps(1_000_000_000, 14), 3);
  assert.equal(halfSpreadBps(100_000_000, 15), 15);
});
test("average dollar volume uses strictly earlier sessions", () => {
  const bars = [bar("2026-06-29", 100), bar("2026-06-30", 110), bar("2026-07-01", 1000, 1_000_000_000)];
  assert.equal(avgDollarVolumeBefore(bars, "2026-07-01"), 105 * 10_000_000);
  assert.equal(avgDollarVolumeBefore(bars, "2026-06-29"), undefined);
});
test("return volatility is zero on flat history and positive otherwise", () => {
  assert.equal(returnVolatilityBefore([bar("2026-06-29", 100), bar("2026-06-30", 100)], "2026-07-01"), 0);
  assert.equal(returnVolatilityBefore([bar("2026-06-30", 100)], "2026-07-01"), 0);
  assert.ok(returnVolatilityBefore([bar("2026-06-29", 100), bar("2026-06-30", 110), bar("2026-07-01", 100)], "2026-07-02") > 0);
});
test("slippage scales with volatility and the square root of relative size", () => {
  assert.equal(slippageBps(100, 1_000_000_000, 0), 0);
  assert.equal(slippageBps(100, undefined, 0.2), 0);
  assert.equal(slippageBps(100, 0, 0.2), 0);
  const base = slippageBps(1_000_000, 1_000_000_000, 0.02);
  assert.ok(Math.abs(base - 10_000 * 0.02 * Math.sqrt(0.001)) < 1e-12);
  assert.ok(Math.abs(slippageBps(4_000_000, 1_000_000_000, 0.02) - base * 2) < 1e-12);
});
