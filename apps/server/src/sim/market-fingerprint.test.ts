import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "@rh/shared";
import { isMarketFingerprint, marketFingerprint } from "./market-fingerprint.ts";
import type { ScenarioMarket } from "./scenario-market.ts";

test("the same seed and dates cannot pair markets with a revised company tape", async () => {
  const dates = ["2031-01-06", "2031-01-07"];
  const baseline: Bar[] = dates.map((date) => ({ date, open: 100, high: 103, low: 99, close: 101, volume: 10_000 }));
  const scenario = (company: Bar[]): ScenarioMarket => ({
    symbols: ["MKT", "ZABC"], benchmark: "MKT", aliases: { MKT: "SPY", ZABC: "AAA" }, sectorOf: () => undefined,
    calendar: { firstDay: dates[1]! }, simDates: dates.slice(1), allDates: dates,
    sourceDates: ["2025-06-11", "2025-06-12"], dropped: [], universeText: "",
    bars: async (symbol) => symbol === "MKT" ? baseline : company,
    market: () => { throw new Error("The effective tapes are sufficient for this check"); },
  });
  const config = { mode: "bootstrap", execution: "realistic", startingCash: 1200, cyclesPerDay: 2 } as const;
  const first = await marketFingerprint(scenario(baseline), 21, config);
  assert.ok(isMarketFingerprint(first));
  assert.equal(await marketFingerprint(scenario(structuredClone(baseline)), 21, config), first);
  const correction = [{ ...baseline[0]!, volume: 20_000 }, baseline[1]!];
  const corrected = await marketFingerprint(scenario(correction), 21, config);
  assert.ok(isMarketFingerprint(corrected));
  assert.notEqual(corrected, first);
  assert.equal(await marketFingerprint(scenario(baseline.slice(1)), 21, config), undefined);
});
