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

  it("shows_halts_mode_and_a_missing_account", () => {
    const text = cycleInput(input({ halts: ["daily_loss"], account: null }));
    assert.ok(text.includes("daily_loss"), "names the halt");
    assert.ok(text.includes("approve"), "names the mode");
    assert.match(text, /unavailable/i, "says the account is unavailable");
  });
});
