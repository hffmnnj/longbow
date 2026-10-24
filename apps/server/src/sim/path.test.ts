import { test } from "node:test";
import assert from "node:assert/strict";
import { etInstant, pathPrice, pathSegment, tradingDays } from "./path.ts";

const bar = { date: "2026-07-02", open: 100, low: 90, high: 120, close: 110, volume: 1000 };
test("up days visit low before high, down days visit high before low", () => {
  assert.deepEqual([0, 1 / 3, 2 / 3, 1].map((t) => pathPrice(bar, t)), [100, 90, 120, 110]);
  assert.deepEqual([0, 1 / 3, 2 / 3, 1].map((t) => pathPrice({ ...bar, close: 95 }, t)), [100, 120, 90, 95]);
  assert.equal(pathPrice(bar, 1 / 6), 95);
});
test("path segments include turns between checks and never include future points", () => {
  const segment = pathSegment(bar, etInstant(bar.date, 10, 15), etInstant(bar.date, 15, 30));
  assert.deepEqual(segment.map((p) => p.price), [100 - 10 * 45 / 130, 90, 120, 110 + 10 * 30 / 130]);
  assert.equal(pathSegment(bar, etInstant(bar.date, 9), etInstant(bar.date, 9, 15)).length, 0);
});
test("trading days come from bars and skip Independence Day holiday", () => {
  const bars = ["2026-07-01", "2026-07-02", "2026-07-06", "2026-07-07"].map((date) => ({ ...bar, date }));
  assert.deepEqual(tradingDays(bars, "2026-07-02", 2).map((b) => b.date), ["2026-07-02", "2026-07-06"]);
});
test("ET instant respects winter and summer offsets", () => {
  assert.equal(new Date(etInstant("2026-01-05", 10, 15)).toISOString(), "2026-01-05T15:15:00.000Z");
  assert.equal(new Date(etInstant("2026-07-02", 10, 15)).toISOString(), "2026-07-02T14:15:00.000Z");
});
