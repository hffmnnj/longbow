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

describe("trader prompt sections", () => {
  it("keeps_a_system_one_section_naming_all_six_tools", async () => {
    const ext = createTraderPromptExtension();
    const sections = ext.sections ?? [];
    const keys = sections.map((section) => section.key);
    assert.ok(keys.includes("trader-system-one"), "has a trader-system-one section");
    const found = sections.find((section) => section.key === "trader-system-one");
    const text = found === undefined ? undefined : await found.render({} as never, {} as never);
    assert.ok(text, "system-one section renders text");
    for (const tool of [
      "jev_status",
      "jev_decide",
      "jev_candidates",
      "jev_read_text",
      "jev_thesis_check",
      "jev_regime",
    ]) {
      assert.ok(text.includes(tool), `system-one section names ${tool}`);
    }
  });
  it("keeps_the_original_section_ids", async () => {
    const keys = (createTraderPromptExtension().sections ?? []).map((section) => section.key);
    for (const key of [
      "trader-mandate",
      "trader-owner",
      "trader-loop",
      "trader-protocol",
      "trader-edge",
      "trader-system-one",
      "trader-portfolio",
      "trader-numbers",
      "trader-orders",
      "trader-risk",
      "trader-small",
      "trader-exits",
      "trader-autonomy",
      "trader-journal",
      "trader-tools",
    ]) {
      assert.ok(keys.includes(key), `still has ${key}`);
    }
    assert.equal(keys.indexOf("trader-system-one"), keys.indexOf("trader-edge") + 1, "system-one follows edge");
  });
  it("explains fractional execution, held protection and cancellation", async () => {
    const sections = createTraderPromptExtension().sections ?? [];
    const text = (await Promise.all(sections.map((section) => section.render({} as never, {} as never)))).join("\n");
    assert.match(text, /fractional shares as market orders/);
    assert.match(text, /watched every minute/);
    assert.match(text, /Use cancel_order/);
    assert.match(text, /cannot protect while the harness is down/);
  });
  it("teaches deliberate fractional price limits and distinguishes unplaced rejections from ambiguous errors", async () => {
    const sections = createTraderPromptExtension().sections ?? [];
    const text = (await Promise.all(sections.map((section) => section.render({} as never, {} as never)))).join("\n");
    assert.match(text, /buy ceiling to cover the fresh ask/);
    assert.match(text, /sell floor at or below the fresh bid/);
    assert.match(text, /buffer belongs in that original intent/);
    assert.match(text, /not guaranteed limit-price protection/);
    assert.match(text, /fractional_marketable rejection is provably not placed/);
    assert.match(text, /only failing check/);
    assert.match(text, /ambiguous: never automatically retry it; reconcile Robinhood orders first/);
  });
  it("allows_crypto_only_as_the_capped_sleeve_skill", async () => {
    const sections = createTraderPromptExtension().sections ?? [];
    const text = (await Promise.all(sections.map((section) => section.render({} as never, {} as never)))).join("\n");
    assert.match(text, /Long only: no options, no margin, no shorting/);
    assert.match(text, /capped sleeve/);
    assert.match(text, /crypto-sleeve/);
    assert.match(text, /load that skill before any crypto order/);
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

describe("owner preference priority", () => {
  async function fullPrompt(): Promise<string> {
    const sections = createTraderPromptExtension().sections ?? [];
    return (await Promise.all(sections.map((section) => section.render({} as never, {} as never)))).join("\n");
  }

  it("owner_section_sets_the_hierarchy_without_authorizing_limit_changes", async () => {
    const text = await fullPrompt();
    assert.match(text, /owner-preferences\.md/, "names the owner preferences note");
    assert.match(text, /latest direct owner instruction wins/i, "latest owner instruction outranks older plans");
    assert.match(text, /never overrides deterministic risk-engine checks/i, "engine checks stay binding");
    assert.match(text, /explicit cash reserve/i, "reserves stay binding");
    assert.match(text, /does not authorize raising engine limits/i, "preferences do not raise limits");
    assert.match(text, /named failing engine check, missing evidence, market state, an owner constraint/i, "hold reasons name their class");
  });

  it("drops_stale_hard_vetoes_for_isolated_protection_issues", async () => {
    const text = await fullPrompt();
    assert.ok(!text.includes("If any earlier step is unresolved, skip entries this cycle"), "blanket skip-entries veto is gone");
    assert.ok(!text.includes("Fix anything missing before doing anything else"), "protect step does not recreate the blanket veto");
    assert.match(text, /isolated unresolved protection issue/i, "isolated issues stay isolated");
    assert.match(text, /broker-wide outage/i, "genuine portfolio-wide failures still block");
    assert.ok(!text.includes("at most 4 names"), "hard-coded name count is gone");
    assert.match(text, /live position cap \(maxPositions\)/i, "live cap governs");
  });

  it("treats_owner_allocations_as_researchable_without_forcing_trades", async () => {
    const text = await fullPrompt();
    assert.ok(!text.includes("No named setup, no trade"), "named-setup-only veto is gone");
    assert.ok(!text.includes("trade only setups with a measured base rate"), "mandate does not contradict the allocation path");
    assert.match(text, /owner-directed allocation/, "owner-directed allocations are named");
    assert.match(text, /not the only way to consider an owner-directed allocation/, "playbooks are not exclusive");
    assert.match(text, /Missing a dip, RSI trigger, or 200-day filter fails that tactical setup/, "tactical misses stay tactical");
    assert.match(text, /not a prerequisite for researching or evaluating a long-horizon allocation/, "no backtest prerequisite for research");
    assert.match(text, /no daily trade quota/i, "no forced quota");
    assert.match(text, /no automatic buy when data or EV requirements cannot be supported/i, "no automatic buy");
    assert.match(text, /Never invent probabilities, base rates, targets, or evidence/i, "no invented inputs");
    assert.match(text, /state the exact gap and research it next/i, "missing evidence names its gap");
  });

  it("keeps_protection_first_with_honest_blocker_labels", async () => {
    const text = await fullPrompt();
    assert.match(text, /smallest valid remedy without routing around/i, "remedy without routing around rejection");
    assert.match(text, /deterministic defect fix.*does not need an expensive simulation/i, "defect fixes skip expensive suites");
    assert.match(text, /zero-trade suite establishes neither a profitable edge nor sound inactivity/i, "zero-trade suites prove neither side");
    assert.match(text, /do not call a preference a mandatory safeguard/i, "preferences are not safeguards");
  });

  it("states_engine_facts_without_overclaiming_exits_or_earnings_blindness", async () => {
    const text = await fullPrompt();
    assert.ok(!text.includes("A stop exit is always allowed"), "absolute stop-exit claim is gone");
    assert.match(text, /still allowed during a daily-loss or monthly-drawdown halt/i, "halt behavior stays specific");
    assert.match(text, /kill switch, mode off, a closed regular session/i, "exit blockers are named");
    assert.ok(!text.includes("the engine cannot see earnings dates"), "false earnings blindness is gone");
    assert.match(text, /enforces an earnings-blackout entry gate from market data/i, "earnings gate is engine-enforced");
  });

  it("labels_the_entry_notional_cap_and_its_exit_exemption", () => {
    const text = cycleInput(input({}));
    assert.match(text, /one entry order <=/, "cap is labeled as an entry cap");
    assert.match(text, /genuine reducing exits are exempt from the entry notional cap/, "exit exemption is explicit");
  });

  it("reads_the_live_position_cap_dynamically", () => {
    const live = { ...settings, risk: { ...settings.risk, maxPositions: 7 } };
    assert.match(cycleInput(input({ settings: live })), /max 7 positions/, "header follows live maxPositions");
  });

  it("requires_owner_preferences_in_every_cycle_job", () => {
    const kinds: Array<{ kind: CycleKind; closed?: boolean }> = [
      { kind: "pre_open" },
      { kind: "intraday" },
      { kind: "post_close" },
      { kind: "overnight", closed: true },
      { kind: "manual" },
      { kind: "manual", closed: true },
    ];
    for (const { kind, closed } of kinds) {
      const text = cycleInput(
        input({ kind, market: closed ? market({ session: "closed", isOpen: false }) : market() }),
      );
      assert.ok(text.includes("owner-preferences.md"), `${kind}${closed ? " closed" : ""} reads owner preferences`);
    }
  });
});

describe("playbook consistency", () => {
  it("small_account_uses_the_live_cap_not_a_hardcoded_count", async () => {
    const body = await readFile(new URL("../../skills/small-account/SKILL.md", import.meta.url), "utf8");
    assert.ok(!body.includes("At most 4 names"), "hard-coded count is gone");
    assert.ok(!body.includes("fifth slot"), "stale fifth-slot wording is gone");
    assert.match(body, /live maxPositions/, "live cap governs");
    assert.ok(!body.includes("are always allowed"), "skill does not promise that exits bypass all checks");
    assert.match(body, /live day-trade cap and minimum hold/, "skill uses current hold and day-trade settings");
  });

  it("debate_and_review_separates_engine_blocks_from_preferences", async () => {
    const body = await readFile(new URL("../../skills/debate-and-review/SKILL.md", import.meta.url), "utf8");
    assert.ok(!body.includes("A risk_reviewer flag is a hard stop, not a suggestion."), "blanket hard-stop rule is gone");
    assert.match(body, /live engine check, halt, or account constraint is a hard stop/, "engine blocks stay hard stops");
    assert.match(body, /never as a mandatory safeguard/, "preferences stay labeled as preferences");
  });
});
