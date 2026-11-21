import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OrderIntent, OrderRecord, Position } from "@rh/shared";
import { recordedEntryReviews } from "./review-dates.ts";

/** A Saturday; review-date states are plain ET date-string comparisons. */
const TODAY = "2026-11-21";

function intent(
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  timeStopDate: string,
): OrderIntent {
  return {
    symbol,
    side,
    quantity,
    orderType: "limit",
    limitPrice: 100,
    timeInForce: "gtc",
    invalidationPrice: 90,
    timeStopDate,
    thesis: "Fixture thesis, long enough to satisfy the shared intent schema.",
    probabilityWin: 0.6,
    expectedGainPct: 5,
    expectedLossPct: 2,
    estimatedCostPct: 0.05,
    evidence: ["fixture"],
  };
}

/** One locally observed order; updatedAt is when the server saw it, not an execution time. */
function fill(
  id: string,
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  filledQuantity: number | undefined,
  updatedAt: number,
  timeStopDate: string,
  overrides: Partial<OrderRecord> = {},
): OrderRecord {
  return {
    id,
    createdAt: updatedAt,
    updatedAt,
    intent: intent(symbol, side, quantity, timeStopDate),
    verdict: { approved: true, isExit: side === "sell", checks: [] },
    status: "filled",
    filledQuantity,
    averageFillPrice: 50,
    ...overrides,
  };
}

function position(symbol: string, quantity: number): Position {
  return { symbol, quantity, averageCost: 50, marketValue: 50 * quantity, unrealizedPnl: 0 };
}

describe("recordedEntryReviews", () => {
  it("reports aggregated review dates only for fully reconciled holdings", () => {
    const orders: OrderRecord[] = [
      // AAPL: the first lot was fully sold, then a new position was built from
      // three buys plus a cancelled order's partial fill. The unfilled cancelled
      // order must not become a lot.
      fill("aapl-open", "AAPL", "buy", 10, 10, 1_000, "2026-10-30"),
      fill("aapl-exit", "AAPL", "sell", 10, 10, 2_000, "2026-11-20"),
      fill("aapl-re-1", "AAPL", "buy", 3, 3, 3_000, "2026-11-18"),
      fill("aapl-re-2", "AAPL", "buy", 2, 2, 4_000, "2026-11-21"),
      fill("aapl-re-3", "AAPL", "buy", 3, 3, 5_000, "2026-11-21"),
      fill("aapl-re-4", "AAPL", "buy", 2, 2, 6_000, "2026-11-24", { status: "cancelled" }),
      fill("aapl-unfilled", "AAPL", "buy", 4, undefined, 7_000, "2026-11-24", { status: "cancelled" }),
      // MSFT: a still-pending order was observed with a partial fill, so the
      // local lots cannot be reconciled to the brokerage holding.
      fill("msft-fill", "MSFT", "buy", 4, 4, 1_000, "2026-12-01"),
      fill("msft-pending", "MSFT", "buy", 6, 2, 1_500, "2026-12-02", { status: "submitted" }),
      // NVDA: every remaining lot came from an owner-directed order.
      fill("nvda-owner", "NVDA", "buy", 4, 4, 1_000, "2026-12-15", { ownerMessageId: "owner-msg-1" }),
      // AMZN: one owner-directed lot and one strategy lot on the same holding.
      fill("amzn-owner", "AMZN", "buy", 2, 2, 1_000, "2026-12-01", { ownerMessageId: "owner-msg-2" }),
      fill("amzn-strategy", "AMZN", "buy", 2, 2, 2_000, "2026-12-02"),
      // GOOG: held at the broker with no local fills (missing provenance).
      // AVGO: local fills leave a residual that cannot cover the holding.
      fill("avgo-fill", "AVGO", "buy", 5, 5, 1_000, "2026-12-05"),
    ];
    const positions = [
      position("AAPL", 10),
      position("MSFT", 6),
      position("NVDA", 4),
      position("AMZN", 4),
      position("GOOG", 3),
      position("AVGO", 7),
    ];

    assert.deepEqual(recordedEntryReviews(positions, orders, TODAY), [
      {
        symbol: "AAPL",
        status: "recorded",
        dates: [
          { date: "2026-11-18", quantity: 3, state: "past" },
          { date: "2026-11-21", quantity: 5, state: "today" },
          { date: "2026-11-24", quantity: 2, state: "upcoming" },
        ],
      },
      { symbol: "MSFT", status: "unverified" },
      { symbol: "NVDA", status: "owner" },
      { symbol: "AMZN", status: "unverified" },
      { symbol: "GOOG", status: "unverified" },
      { symbol: "AVGO", status: "unverified" },
    ]);
  });

  it("treats a buy and a sell observed at the same time as unverified", () => {
    const positions = [position("META", 1)];
    const orders = [
      fill("meta-buy", "META", "buy", 2, 2, 5_000, "2026-12-10"),
      fill("meta-sell", "META", "sell", 1, 1, 5_000, "2026-12-10"),
    ];

    assert.deepEqual(recordedEntryReviews(positions, orders, TODAY), [
      { symbol: "META", status: "unverified" },
    ]);
  });

  it("withholds dates when a replacement lot was observed after the holdings snapshot", () => {
    const positions = [position("META", 1)];
    const orders = [
      fill("earlier", "META", "buy", 1, 1, 1_000, "2026-11-24"),
      fill("closed", "META", "sell", 1, 1, 5_000, "2026-11-24"),
      fill("reopened", "META", "buy", 1, 1, 6_000, "2026-12-10"),
    ];
    assert.deepEqual(recordedEntryReviews(positions, orders, TODAY, 4_000), [
      { symbol: "META", status: "unverified" },
    ]);
  });
});
