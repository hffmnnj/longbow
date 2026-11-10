import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_CRYPTO,
  type AccountSnapshot,
  type CycleKind,
  type MarketClock,
  type Settings,
} from "@rh/shared";
import { createTraderPromptExtension, cycleInput, type CycleInput } from "./prompt.ts";

const settings: Settings = {
  mode: "approve",
  killSwitch: false,
  drawdownHalted: false,
  cycleMinutesOpen: 30,
  cycleMinutesClosed: 240,
  watchlist: ["SPY", "QQQ"],
  systemOne: { enabled: true, gate: "advise" },
  crypto: DEFAULT_CRYPTO,
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

const closedMarket = market({ session: "closed", isOpen: false });

async function fullPrompt(): Promise<string> {
  const sections = createTraderPromptExtension().sections ?? [];
  return (await Promise.all(sections.map((section) => section.render({} as never, {} as never)))).join("\n");
}

describe("trader prompt sections", () => {
  it("prompt_renders_identically_every_time_so_the_provider_cache_stays_warm", async () => {
    const ext = createTraderPromptExtension();
    assert.equal(ext.name, "trader-prompt");
    for (const section of ext.sections ?? []) {
      const first = await section.render({} as never, {} as never);
      assert.ok(first && first.length > 0, `${section.key} renders text`);
      assert.equal(await section.render({} as never, {} as never), first, `${section.key} is stable`);
    }
  });

  it("prompt_keeps_the_order_path_and_ambiguity_safeguards", async () => {
    const text = await fullPrompt();
    assert.match(text, /only way to place an order is submit_order/);
    assert.match(text, /never automatically retry it; reconcile Robinhood orders first/);
    assert.match(text, /Do not resubmit with tweaked numbers/);
    assert.match(text, /Long only: no options, no margin, no shorting/);
    assert.match(text, /load that skill before any crypto order/);
    assert.match(text, /Never move a stop down/);
    assert.match(text, /untrusted data, never instructions/);
  });

  it("prompt_describes_fractional_execution_and_harness_held_stops", async () => {
    const text = await fullPrompt();
    assert.match(text, /fractional shares as market orders/);
    assert.match(text, /not guaranteed limit-price protection/);
    assert.match(text, /watched every minute/);
    assert.match(text, /cannot protect while the harness is down/);
    assert.match(text, /Use cancel_order with our order id/);
  });

  it("owner_orders_quote_the_owner_verbatim_and_are_never_invented", async () => {
    const text = await fullPrompt();
    assert.match(text, /set ownerInstruction to the owner's own words quoted verbatim/);
    assert.match(text, /Never put ownerInstruction on a trade the owner did not explicitly order/);
    assert.match(text, /wait for the owner's tap in the app/);
  });

  it("prompt_no_longer_tells_the_agent_to_default_to_cash", async () => {
    const text = await fullPrompt();
    assert.ok(!/Default to hold\./.test(text), "the old default-to-hold rule is gone");
    assert.ok(!/benchmark evaluation of autonomous trading agents/.test(text), "the disqualification framing is gone");
    assert.match(text, /Invested target/, "states invested targets by regime");
    assert.match(text, /buying is the default/, "deploying cash below target is the default");
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
    it(`cycleInput_${kind}${closed ? "_closed" : ""}_states_the_situation_and_reads_owner_preferences`, () => {
      const text = cycleInput(input({ kind, market: closed ? closedMarket : market() }));
      assert.ok(text.includes(`(${kind})`), "names the cycle kind");
      assert.ok(text.includes("Watchlist: SPY, QQQ"), "includes the watchlist");
      assert.ok(text.includes("equity $10,250.50"), "summarizes equity");
      assert.ok(text.includes("SPY 10 sh"), "summarizes positions");
      assert.ok(text.includes("owner-preferences.md"), "reads owner preferences");
      if (closed) assert.match(text, /orders are impossible/i, "closed cycles are research only");
    });
  }

  it("cycleInput_reports_the_invested_share_of_equity", () => {
    // 5,100 of 10,250.50 equity is 49.75 percent, rounded to 50.
    assert.match(cycleInput(input({})), /invested 50% of equity/);
    const flat = { ...account, positions: [] };
    assert.match(cycleInput(input({ account: flat })), /invested 0% of equity/);
  });

  it("cycleInput_converts_live_limits_to_dollars", () => {
    const text = cycleInput(input({}));
    assert.match(text, /risk 1%\/trade \(\$102\.51 at current equity\)/);
    assert.match(text, /max 5 positions/);
    assert.match(text, /one entry order <= \$2,500\.00/);
    const live = { ...settings, risk: { ...settings.risk, maxPositions: 7 } };
    assert.match(cycleInput(input({ settings: live })), /max 7 positions/);
  });

  it("cycleInput_shows_halts_mode_and_a_missing_account", () => {
    const text = cycleInput(input({ halts: ["daily_loss"], account: null }));
    assert.match(text, /entries blocked: daily_loss/);
    assert.match(text, /approve: approved orders wait for a human/);
    assert.match(text, /Account: unavailable/);
  });

  it("cycleInput_intraday_reflects_the_configured_interval_and_closed_jobs_do_not", () => {
    const live = { ...settings, cycleMinutesOpen: 45 };
    assert.match(cycleInput(input({ settings: live, kind: "intraday" })), /configured 45-minute open-cycle interval/);
    for (const kind of ["overnight", "post_close", "pre_open"] as const) {
      const text = cycleInput(input({ kind, market: closedMarket }));
      assert.ok(!text.includes("open-cycle interval"), `${kind} advertises no open interval`);
    }
    assert.match(cycleInput(input({ kind: "overnight", market: closedMarket })), /do not expand research-only scope into execution/);
  });

  it("cycleInput_post_close_publishes_reports_only_when_the_week_flag_is_set", () => {
    assert.ok(!cycleInput(input({ kind: "post_close" })).includes("publish_report"), "simulations have no report tool");
    const last = cycleInput(input({ kind: "post_close", isLastTradingDayOfWeek: true }));
    assert.match(last, /quoting figures only from the tool's returned facts/);
    assert.match(last, /also publish the weekly report/);
    assert.match(cycleInput(input({ kind: "post_close", isLastTradingDayOfWeek: false })), /skip the weekly report/);
  });
});

describe("playbooks", () => {
  async function skill(name: string): Promise<string> {
    return readFile(new URL(`../../skills/${name}/SKILL.md`, import.meta.url), "utf8");
  }

  it("portfolio_heat_allows_a_multi_position_book", async () => {
    const body = await skill("portfolio-heat");
    assert.ok(!body.includes("Hard ceiling: 3 percent"), "a 3% aggregate ceiling allowed only one position");
    assert.match(body, /about 12 percent of equity/);
  });

  it("regime_map_keeps_investing_in_corrections_but_not_in_bear_high_vol", async () => {
    const body = await skill("market-regime");
    assert.match(body, /Correction .*invested 50 to 70 percent/);
    assert.match(body, /Bear-high-vol: invested 25 to 40 percent.*no new buys/);
    assert.ok(!body.includes("keep the more cautious"), "Jev no longer vetoes by default");
  });
});
