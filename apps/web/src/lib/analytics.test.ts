import { describe, expect, it } from "vitest";
import type { CalibrationBucket, ClosedTrade, EquityHistory, Position } from "@rh/shared";
import {
  calendarKey,
  calibrationReading,
  calibrationRows,
  closedTradeKey,
  distanceToStopPct,
  ditherRampSvg,
  earningsKey,
  equityReading,
  equityRows,
  groupCalendarDays,
  heatCapPct,
  indexToStart,
  orderOutcomes,
  pnlBars,
  positionStops,
  rebase,
  replayReading,
  REPLAY_LABEL,
  simFillKey,
  thinSeries,
  vixReading,
  yieldReading,
  breadthPct,
} from "./analytics.ts";

const trade = (over: Partial<ClosedTrade>): ClosedTrade => ({
  symbol: "NVDA",
  closedAt: 1,
  quantity: 1,
  exitPrice: 10,
  pnl: 0,
  source: "harness",
  ...over,
});

describe("thinSeries", () => {
  it("keeps the first and last item and the requested count when thinning 1,000 points", () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const out = thinSeries(items, 50);
    expect(out).toHaveLength(50);
    expect(out[0]).toBe(0);
    expect(out[49]).toBe(999);
    expect(out).toEqual([...out].sort((a, b) => a - b));
  });

  it("returns a short series unchanged and as a copy", () => {
    const items = [1, 2, 3];
    const out = thinSeries(items, 10);
    expect(out).toEqual([1, 2, 3]);
    expect(out).not.toBe(items);
  });
});

describe("indexToStart", () => {
  it("expresses each value as percent change from the first", () => {
    expect(indexToStart([200, 210, 190])).toEqual([0, 5, -5]);
  });

  it("returns zeros when the start is zero rather than infinities", () => {
    expect(indexToStart([0, 5])).toEqual([0, 0]);
  });
});

describe("rebase", () => {
  it("lifts a narrow band off the zero floor and keeps differences intact", () => {
    const { offset, rows } = rebase([[25000, 25500], [24900, 25200]]);
    expect(offset).toBeGreaterThan(24000);
    expect(offset).toBeLessThanOrEqual(24900);
    expect(rows[0]![1]! - rows[0]![0]!).toBe(500);
    expect(rows[1]![0]! + offset).toBe(24900);
  });

  it("floors the offset to a round number so added-back ticks stay readable", () => {
    const { offset } = rebase([[25123, 25678]]);
    expect(offset % 100).toBe(0);
    expect(offset).toBeLessThanOrEqual(25123);
  });

  it("never produces a negative offset for small values", () => {
    expect(rebase([[0.05, 1]]).offset).toBe(0);
  });
});

describe("equityRows", () => {
  const history = (benchmarks: (number | undefined)[]): EquityHistory => ({
    points: benchmarks.map((b, i) => ({ at: i, date: `2026-10-${10 + i}`, equity: 1000 + i, benchmark: b })),
    holdingsReplay: [],
  });

  it("drops the benchmark entirely when any mark lacks one so the line never falls to zero", () => {
    const { rows, hasBenchmark } = equityRows(history([1000, undefined, 1002]));
    expect(hasBenchmark).toBe(false);
    expect(rows.every((r) => r.benchmark === undefined)).toBe(true);
  });

  it("keeps the benchmark when every mark has one", () => {
    const { rows, hasBenchmark } = equityRows(history([1000, 1001, 1002]));
    expect(hasBenchmark).toBe(true);
    expect(rows.map((r) => r.benchmark)).toEqual([1000, 1001, 1002]);
  });
});

describe("equityReading", () => {
  const base: EquityHistory = {
    points: [
      { at: 1, date: "2026-10-24", equity: 25000 },
      { at: 2, date: "2026-10-26", equity: 25475 },
    ],
    holdingsReplay: [],
    returnPct: 1.9,
    benchmarkReturnPct: -0.6,
  };

  it("states the account against SPY since the first mark", () => {
    expect(equityReading(base)).toBe("Up 1.90% vs SPY's \u22120.60% since Oct 24");
  });

  it("says Down for a negative return and drops SPY when there is no benchmark", () => {
    expect(equityReading({ ...base, returnPct: -2, benchmarkReturnPct: undefined })).toBe("Down 2.00% since Oct 24");
  });

  it("gives no reading for a single mark", () => {
    expect(equityReading({ ...base, points: base.points.slice(0, 1) })).toBeUndefined();
  });
});

describe("replay labelling", () => {
  it("names the replay as today's holdings and never as account history", () => {
    expect(REPLAY_LABEL).toBe("Today's holdings, replayed");
    const reading = replayReading({
      points: [],
      holdingsReplay: [
        { date: "2026-08-03", value: 1000 },
        { date: "2026-10-23", value: 1064 },
      ],
    });
    expect(reading).toBe("Replay: today's holdings are +6.40% since Aug 3");
  });
});

describe("calibration", () => {
  const buckets: CalibrationBucket[] = [
    { from: 0.5, to: 0.6, predicted: 0.55, realized: 0.4, count: 10 },
    { from: 0.6, to: 0.7, predicted: 0.65, realized: 0.65, count: 10 },
    { from: 0.7, to: 0.8, predicted: 0.75, realized: 0, count: 0 },
  ];

  it("shows only buckets that have trades, as percentages, with their counts", () => {
    const rows = calibrationRows(buckets);
    expect(rows.map((r) => [r.label, r.predicted, r.realized, r.count])).toEqual([
      ["50\u201360%", 55, 40, 10],
      ["60\u201370%", 65, 65, 10],
    ]);
  });

  it("weights the gap by trade count: a 15 point miss on half the trades reads as 8 points (7.5 rounded)", () => {
    expect(calibrationReading(buckets)).toBe("Realized win rate runs 8 points below predictions across 20 trades");
  });

  it("gives no reading without trades", () => {
    expect(calibrationReading([{ from: 0.5, to: 0.6, predicted: 0.55, realized: 0, count: 0 }])).toBeUndefined();
  });
});

describe("pnlBars", () => {
  it("orders by close time, splits wins from losses as magnitudes, and keeps the latest when capped", () => {
    const bars = pnlBars(
      [trade({ symbol: "B", closedAt: 20, pnl: -30 }), trade({ symbol: "A", closedAt: 10, pnl: 50 }), trade({ symbol: "C", closedAt: 30, pnl: 5 })],
      2,
    );
    expect(bars.map((b) => [b.label, b.gain, b.loss])).toEqual([
      ["B", 0, 30],
      ["C", 5, 0],
    ]);
  });
});

describe("stops and heat", () => {
  const position: Position = { symbol: "NVDA", quantity: 10, averageCost: 100, marketValue: 1200, unrealizedPnl: 200 };

  it("measures distance to the stop as a percent of price", () => {
    expect(distanceToStopPct(120, 108)).toBe(10);
    expect(distanceToStopPct(100, 103)).toBe(-3);
  });

  it("joins positions with the server's stop and falls back to weight from equity", () => {
    const [joined] = positionStops([position], [{ symbol: "NVDA", marketValue: 1200, weightPct: 4.8, unrealizedPnl: 200, stopPrice: 108 }], 25000);
    expect(joined!.distancePct).toBe(10);
    expect(joined!.weightPct).toBe(4.8);
    const [bare] = positionStops([position], [], 24000);
    expect(bare!.stopPrice).toBeUndefined();
    expect(bare!.weightPct).toBe(5);
  });

  it("caps heat at max positions times risk per trade", () => {
    expect(heatCapPct({ maxPositions: 4, maxRiskPerTradePct: 1.5 })).toBe(6);
  });
});

describe("orderOutcomes", () => {
  it("lists non-zero statuses largest first with plain labels", () => {
    expect(orderOutcomes({ filled: 3, rejected_risk: 5, failed: 0 })).toEqual([
      { status: "rejected_risk", label: "Blocked by risk", count: 5 },
      { status: "filled", label: "Filled", count: 3 },
    ]);
  });
});

describe("ditherRampSvg", () => {
  it("is solid at the left edge and sparser at the right", () => {
    const svg = ditherRampSvg(8, 2);
    const at = (x: number) => svg.split("<rect").filter((r) => r.includes(`x="${x}"`)).length;
    expect(at(0)).toBe(4);
    expect(at(14)).toBeLessThan(at(0));
  });
});

describe("market readings", () => {
  it("describes a normal curve in basis points", () => {
    expect(
      yieldReading([
        { tenor: "2Y", yieldPct: 3.86 },
        { tenor: "10Y", yieldPct: 4.18 },
      ]),
    ).toBe("10Y at 4.18%, 32 bp above 2Y: the curve slopes up");
  });

  it("calls a negative 2s10s spread inverted", () => {
    expect(
      yieldReading([
        { tenor: "2Y", yieldPct: 4.5 },
        { tenor: "10Y", yieldPct: 4.2 },
      ]),
    ).toBe("10Y at 4.20%, 30 bp below 2Y: the curve is inverted");
  });

  it("returns nothing when 2Y or 10Y is missing", () => {
    expect(yieldReading([{ tenor: "10Y", yieldPct: 4 }])).toBeUndefined();
  });

  it("states VIX rank with the right ordinal and the term structure", () => {
    expect(vixReading({ vix: 14.8, percentile: 22, contango: true })).toBe(
      "VIX 14.8 at the 22nd percentile of the past year; near-term fear is below the 3-month level (contango)",
    );
    expect(vixReading({ vix: 31, percentile: 93, contango: false })).toContain("93rd percentile");
  });

  it("computes breadth as the share above the 50 day, and zero for an empty universe", () => {
    expect(breadthPct({ aboveSma50: 250, total: 500 })).toBe(50);
    expect(breadthPct({ aboveSma50: 0, total: 0 })).toBe(0);
  });
});

describe("list keys", () => {
  it("stays unique when two calendar rows share a date and name", () => {
    const a = { date: "2026-10-26", event: "FOMC minutes" };
    const keys = [calendarKey(a, 0), calendarKey({ ...a }, 1)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stays unique when two earnings rows share a symbol and date", () => {
    const e = { symbol: "NVDA", date: "2026-10-26" };
    const keys = [earningsKey(e, 0), earningsKey({ ...e }, 1)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stays unique when two closed trades share a symbol and close time", () => {
    const t = { symbol: "MSFT", closedAt: 5 };
    const keys = [closedTradeKey(t, 0), closedTradeKey({ ...t }, 1)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stays unique when two fills share an order and timestamp", () => {
    const f = { orderId: "o1", at: 7 };
    const keys = [simFillKey(f, 0), simFillKey({ ...f }, 1)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("groups the calendar by date in first-seen order", () => {
    const days = groupCalendarDays([
      { date: "2026-10-27", event: "B" },
      { date: "2026-10-26", event: "A" },
      { date: "2026-10-26", event: "A again" },
    ]);
    expect(days.map((d) => d.date)).toEqual(["2026-10-27", "2026-10-26"]);
    expect(days[1]!.items.map((i) => i.event)).toEqual(["A", "A again"]);
  });
});
