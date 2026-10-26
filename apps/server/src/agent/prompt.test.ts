import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  AccountSnapshot,
  CycleKind,
  MarketClock,
  Settings,
} from "@rh/shared";
import { createTraderPromptExtension, cycleInput, type CycleInput } from "./prompt.ts";

const settings: Settings = {
  mode: "approve",
  killSwitch: false,
  drawdownHalted: false,
  cycleMinutesOpen: 30,
  cycleMinutesClosed: 240,
  watchlist: ["SPY", "QQQ"],
  risk: {
    maxRiskPerTradePct: 1,
    maxPositionPct: 5,
    maxSectorPct: 20,
    maxPositions: 5,
    maxOrderNotionalUsd: 2500,
    minOrderNotionalUsd: 5,
    dailyLossHaltPct: 2,
    monthlyDrawdownHaltPct: 6,
    maxEntriesPerDay: 2,
    minHoldDays: 1,
    maxSpreadBps: 20,
    maxSlippageBps: 10,
    noTradeOpenMinutes: 30,
    noTradeCloseMinutes: 15,
    maxDayTrades5d: 3,
    minEvToCost: 2,
    earningsBlackoutDays: 5,
    minAvgDollarVolumeUsd: 20_000_000,
  },
};

function market(overrides: Partial<MarketClock> = {}): MarketClock {
  return {
    now: Date.UTC(2026, 9, 26, 13, 30),
    session: "regular",
    isOpen: true,
    tradingDay: "2026-10-26",
    nextOpen: Date.UTC(2026, 9, 27, 13, 30),
    nextClose: Date.UTC(2026, 9, 26, 20, 0),
    earlyClose: false,
    ...overrides,
  };
}

const account: AccountSnapshot = {
  at: Date.UTC(2026, 9, 26, 13, 30),
  equity: 10250.5,
  cash: 5250.25,
  buyingPower: 10500.75,
  positions: [
    { symbol: "SPY", quantity: 10, averageCost: 500, marketValue: 5100, unrealizedPnl: 100 },
  ],
};

function input(overrides: Partial<CycleInput> = {}): CycleInput {
  return {
    kind: "intraday",
    cycleId: "cycle-7",
    market: market(),
    settings,
    halts: [],
    account,
    ...overrides,
  };
}

describe("trader prompt sections", () => {
  it("explains fractional execution, held protection and cancellation", async () => {
    const sections = createTraderPromptExtension().sections ?? [];
    const text = (await Promise.all(sections.map((section) => section.render({} as never, {} as never)))).join("\n");
    assert.match(text, /fractional shares as market orders/);
    assert.match(text, /watched every minute/);
    assert.match(text, /Use cancel_order/);
    assert.match(text, /cannot protect while the harness is down/);
  });
  it("renders_stable_sections", async () => {
    const ext = createTraderPromptExtension();
    assert.equal(ext.name, "trader-prompt");
    const sections = ext.sections ?? [];
    assert.ok(sections.length >= 5, "prompt has several sections");
    for (const section of sections) {
      const first = await section.render({} as never, {} as never);
      const second = await section.render({} as never, {} as never);
      assert.ok(first && first.length > 0, `${section.key} renders text`);
      assert.equal(first, second, `${section.key} is stable across renders`);
    }
  });
});

describe("cycleInput", () => {
  const jobs: Array<{ kind: CycleKind; closed?: boolean }> = [
    { kind: "pre_open" },
    { kind: "intraday" },
    { kind: "post_close" },
    { kind: "overnight", closed: true },
    { kind: "manual" },
    { kind: "manual", closed: true },
  ];

  for (const { kind, closed } of jobs) {
    it(`covers_${kind}${closed ? "_closed" : ""}`, () => {
      const text = cycleInput(
        input({
          kind,
          market: closed ? market({ session: "closed", isOpen: false }) : market(),
        }),
      );
      assert.ok(text.includes(kind), "names the cycle kind");
      assert.ok(text.includes("SPY"), "includes the watchlist");
      assert.ok(text.includes("10,250.50"), "summarizes equity");
      assert.ok(text.includes("SPY 10 sh"), "summarizes positions");
      if (closed || kind === "overnight") {
        assert.match(text, /orders are impossible/i, "says orders are impossible when the market is closed");
      }
    });
  }

  it("pre_open_sets_a_plan_and_post_close_reviews_the_day", () => {
    assert.match(cycleInput(input({ kind: "pre_open" })), /trigger/i);
    assert.match(cycleInput(input({ kind: "post_close" })), /fills|review/i);
  });

  it("post_close_without_the_week_flag_keeps_the_review_only", () => {
    const text = cycleInput(input({ kind: "post_close" }));
    assert.match(text, /trade-review-and-calibration/);
    assert.ok(!text.includes("publish_report"), "simulations have no report tool");
  });

  it("post_close_with_the_flag_publishes_trade_then_daily_reports", () => {
    for (const last of [true, false]) {
      const text = cycleInput(input({ kind: "post_close", isLastTradingDayOfWeek: last }));
      assert.match(text, /publish_report/);
      assert.match(text, /grade the decision quality, not the outcome/);
      assert.match(text, /one-sentence gradeReason/);
      assert.match(text, /quoting figures only from the tool's returned facts/);
      assert.match(text, /"What worked"/);
      if (last) assert.match(text, /also publish the weekly report/);
      else assert.match(text, /skip the weekly report/);
    }
  });

  it("includes_per_trade_risk_dollars_when_account_known", () => {
    const text = cycleInput(input({}));
    assert.match(text, /1%\/trade/, "names the live per-trade risk percent");
    assert.match(text, /\$102\.5/, "converts 1% of $10,250.50 equity to dollars");
    assert.match(text, /max 5 positions/, "names the live position cap");
    assert.match(text, /entries\/day/, "names the live entries-per-day cap");
    assert.match(text, /approved orders execute immediately|wait for a human|research only/, "states the mode in plain words");
  });

  it("shows_halts_mode_and_a_missing_account", () => {
    const text = cycleInput(input({ halts: ["daily_loss"], account: null }));
    assert.ok(text.includes("daily_loss"), "names the halt");
    assert.ok(text.includes("approve"), "names the mode");
    assert.match(text, /unavailable/i, "says the account is unavailable");
  });
});
