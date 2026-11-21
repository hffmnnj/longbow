import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReplayBenchmarkCoverage, etInstant, pathPrice, pathSegment, realisticPath, realisticPrice, realisticSegment, tradingDays, REALISTIC_INTERVALS } from "./path.ts";
import { createNyseCalendar } from "../risk/calendar.ts";

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
test("replay skips observed Juneteenth 2022 but rejects a missing next-session SPY bar", () => {
  const calendar = createNyseCalendar();
  const start = "2022-06-17";
  assert.doesNotThrow(() => assertReplayBenchmarkCoverage([start, "2022-06-21", "2022-06-22"], start, calendar));
  assert.throws(() => assertReplayBenchmarkCoverage([start, "2022-06-22"], start, calendar),
    /Missing SPY bar for scheduled replay session 2022-06-21/);
});
test("replay rejects duplicate marks or bars on a known exchange closure", () => {
  const calendar = createNyseCalendar();
  const prior = "2026-07-02";
  const closure = "2026-07-03";
  const next = "2026-07-06";
  assert.doesNotThrow(() => assertReplayBenchmarkCoverage([prior, next], prior, calendar));
  assert.throws(() => assertReplayBenchmarkCoverage([prior, closure, next], prior, calendar),
    /Unexpected SPY bar on a closed replay session 2026-07-03/);
  assert.throws(() => assertReplayBenchmarkCoverage([prior, next, next], prior, calendar),
    /Duplicate SPY bar for replay session 2026-07-06/);
  assert.throws(() => assertReplayBenchmarkCoverage([prior, "2026-07-07"], prior, calendar),
    /Missing SPY bar for scheduled replay session 2026-07-06/);
});
test("ET instant respects winter and summer offsets", () => {
  assert.equal(new Date(etInstant("2026-01-05", 10, 15)).toISOString(), "2026-01-05T15:15:00.000Z");
  assert.equal(new Date(etInstant("2026-07-02", 10, 15)).toISOString(), "2026-07-02T14:15:00.000Z");
});
test("realistic bridge is deterministic, bounded, and touches each extreme once", () => {
  const bar = { date: "2026-07-02", open: 100, low: 90, high: 120, close: 110, volume: 1000 };
  const first = realisticPath(bar, "SPY", 7);
  const second = realisticPath(bar, "SPY", 7);
  assert.deepEqual(first, second);
  assert.equal(first.length, REALISTIC_INTERVALS + 1);
  assert.equal(first[0]!.price, 100);
  assert.equal(first.at(-1)!.price, 110);
  assert.ok(first.every((p) => p.price >= 90 && p.price <= 120));
  assert.equal(first.filter((p) => p.price === 90).length, 1);
  assert.equal(first.filter((p) => p.price === 120).length, 1);
  const other = realisticPath(bar, "SPY", 8);
  assert.notDeepEqual(first.map((p) => p.price), other.map((p) => p.price));
  const down = realisticPath({ ...bar, close: 95 }, "SPY", 7);
  assert.equal(down[0]!.price, 100);
  assert.equal(down.at(-1)!.price, 95);
  assert.ok(down.every((p) => p.price >= 90 && p.price <= 120));
  assert.equal(down.filter((p) => p.price === 90).length, 1);
  assert.equal(down.filter((p) => p.price === 120).length, 1);
});

test("realistic replay preserves the quoted open and close when the reported range excludes them", () => {
  const inconsistentBar = { date: "2023-06-05", open: 104.25, high: 103.57, low: 100.97, close: 102.07, volume: 3_000_000 };
  const closeOutside = { ...inconsistentBar, close: 100.88 };
  for (const row of [inconsistentBar, closeOutside]) {
    const path = realisticPath(row, "COP", 7);
    assert.equal(path[0]?.price, row.open);
    assert.equal(path.at(-1)?.price, row.close);
    assert.ok(path.every(({ price }) => price >= Math.min(row.low, row.close) && price <= row.open));
    assert.equal(path.filter(({ price }) => price === row.open).length, 1);
    if (row.close < row.low) assert.equal(path.filter(({ price }) => price === row.close).length, 1);
  }
});
test("up days lean low-first and down days lean high-first", () => {
  const bar = { date: "2026-07-02", open: 100, low: 90, high: 120, close: 110, volume: 1000 };
  const lowFirstFraction = (close: number): number => {
    let lowFirst = 0;
    for (let seed = 0; seed < 400; seed++) {
      const path = realisticPath({ ...bar, close }, "SPY", seed);
      const prices = path.map((p) => p.price);
      if (prices.indexOf(90) < prices.indexOf(120)) lowFirst++;
    }
    return lowFirst / 400;
  };
  const up = lowFirstFraction(110);
  assert.ok(up > 0.5 && up < 0.8, `up-day low-first fraction ${up}`);
  const down = lowFirstFraction(95);
  assert.ok(down > 0.2 && down < 0.5, `down-day low-first fraction ${down}`);
});
test("realistic segments slice the cached path without future points", () => {
  const bar = { date: "2026-07-02", open: 100, low: 90, high: 120, close: 110, volume: 1000 };
  const segment = realisticSegment(bar, "SPY", 7, etInstant(bar.date, 10, 15), etInstant(bar.date, 15, 30));
  assert.ok(segment.length > 2);
  assert.equal(segment[0]!.at, etInstant(bar.date, 10, 15));
  assert.equal(segment.at(-1)!.at, etInstant(bar.date, 15, 30));
  assert.equal(segment[0]!.price, realisticPrice(bar, "SPY", 7, etInstant(bar.date, 10, 15)));
  assert.ok(segment.every((p) => p.price >= 90 && p.price <= 120));
  assert.deepEqual(realisticSegment(bar, "SPY", 7, etInstant(bar.date, 9), etInstant(bar.date, 9, 15)), []);
});
