import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  type JournalEntry,
  type OrderRecord,
  type StatusResponse,
} from "@rh/shared";
import { buildHealthReport, type HealthInput } from "./health.ts";

// Contract: pure aggregation of status + last-hour rows into deterministic,
// bounded finding codes. Fault: treating a missing/failed fetch as healthy,
// counting an oversell as a rejected exit, or demanding a buy on repeats.

const NOW = new Date("2026-10-27T15:00:00Z").getTime();
const MIN = 60_000;

function statusResponse(overrides: {
  isOpen?: boolean;
  lastCycleAt?: number | "omit";
  account?: StatusResponse["account"];
} = {}): StatusResponse {
  const { isOpen = true, lastCycleAt = NOW - 5 * MIN, account = "default" } = overrides;
  return {
    agent: {
      state: "idle",
      model: "test/main#xhigh",
      ...(lastCycleAt === "omit" ? {} : { lastCycleAt }),
    },
    broker: { state: "connected", tools: [] },
    market: {
      now: NOW,
      session: isOpen ? "regular" : "closed",
      isOpen,
      tradingDay: "2026-10-27",
      nextOpen: NOW,
      nextClose: NOW,
      earlyClose: false,
    },
    settings: DEFAULT_SETTINGS,
    account:
      account === "default"
        ? {
            at: NOW,
            equity: 10_000,
            cash: 2_500,
            buyingPower: 5_000,
            positions: [
              { symbol: "SPY", quantity: 10, averageCost: 500, marketValue: 5_000, unrealizedPnl: 100 },
              { symbol: "QQQ", quantity: 5, averageCost: 500, marketValue: 2_500, unrealizedPnl: -20 },
            ],
          }
        : account,
    halts: [],
    liveTrading: false,
    models: { main: "test/main#xhigh", subagents: "test/sub#xhigh" },
  };
}

function journalRow(at: number, action: JournalEntry["action"], symbol?: string): HealthInput["journalLastHour"][number] {
  return { at, action, ...(symbol === undefined ? {} : { symbol }) };
}

let orderSeq = 0;
function orderRecord(overrides: {
  status: OrderRecord["status"];
  symbol?: string;
  side?: "buy" | "sell";
  isExit?: boolean;
  failedRules?: string[];
}): OrderRecord {
  const { status, symbol = "SPY", side = "sell", isExit = false, failedRules = [] } = overrides;
  orderSeq += 1;
  return {
    id: `order-${orderSeq}`,
    createdAt: NOW - 10 * MIN,
    updatedAt: NOW - 10 * MIN,
    intent: {
      symbol,
      side,
      quantity: 1,
      orderType: "limit",
      limitPrice: 500,
      invalidationPrice: 480,
      timeInForce: "day",
      timeStopDate: "2026-11-27",
      thesis: "a thesis long enough to satisfy the shared shape for tests",
      probabilityWin: 0.55,
      expectedGainPct: 4,
      expectedLossPct: 2,
      estimatedCostPct: 0.1,
      evidence: ["quote SHOWN at test time"],
    },
    verdict: {
      approved: status !== "rejected_risk",
      isExit,
      checks: failedRules.map((rule) => ({ rule, ok: false, detail: `${rule} failed in the test` })),
    },
    status,
  };
}

function baseInput(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    now: NOW,
    statusOk: true,
    status: statusResponse(),
    journalLastHour: [],
    ordersLastHour: [],
    openStops: [
      { symbol: "SPY", status: "held", remainingQuantity: 10 },
      { symbol: "QQQ", status: "submitted", remainingQuantity: 5 },
    ],
    dbOk: true,
    ...overrides,
  };
}

describe("buildHealthReport", () => {
  it("healthy_full_coverage_reports_descriptive_percentages", () => {
    const report = buildHealthReport(
      baseInput({
        journalLastHour: [journalRow(NOW - MIN, "hold", "SPY")],
        ordersLastHour: [orderRecord({ status: "submitted", side: "buy" })],
      }),
    );
    assert.equal(report.ok, true);
    assert.equal(report.coverage, "full");
    assert.equal(report.cashPct, 25);
    assert.deepEqual(report.positionWeights, [
      { symbol: "SPY", weightPct: 50 },
      { symbol: "QQQ", weightPct: 25 },
    ]);
    assert.deepEqual(report.ordersByStatus, { submitted: 1 });
    assert.equal(report.lastCycle.stale, false);
    assert.equal(report.lastCycle.expectedCycleMs, 35 * MIN);
    assert.deepEqual(report.protection.uncovered, []);
    assert.equal(report.protection.covered.length, 2);
    assert.ok(report.findings.some((f) => f.code === "HEALTHY" && f.severity === "info"));
  });

  it("repeated_holds_flagged_as_diagnostic_only", () => {
    const report = buildHealthReport(
      baseInput({
        journalLastHour: [
          journalRow(NOW - MIN, "hold", "AAPL"),
          journalRow(NOW - 2 * MIN, "hold", "AAPL"),
          journalRow(NOW - 3 * MIN, "hold", "AAPL"),
          journalRow(NOW - 4 * MIN, "hold", "MSFT"),
          journalRow(NOW - 5 * MIN, "hold", "MSFT"),
        ],
      }),
    );
    assert.deepEqual(report.repeatedHolds, [{ symbol: "AAPL", holds: 3 }]);
    const finding = report.findings.find((f) => f.code === "REPEATED_HOLDS");
    assert.equal(finding?.severity, "warn");
    assert.match(finding?.message ?? "", /not a signal to buy/);
    assert.equal(report.ok, true);
  });

  it("rejected_exits_include_true_exits_exclude_oversells", () => {
    const exit = orderRecord({ status: "rejected_risk", isExit: true, failedRules: ["max_positions"] });
    const oversell = orderRecord({ status: "rejected_risk", isExit: false, failedRules: ["no_short"] });
    const report = buildHealthReport(baseInput({ ordersLastHour: [exit, oversell] }));
    assert.deepEqual(report.rejectedRiskReducingExits, [
      { orderId: exit.id, symbol: "SPY", failedRules: ["max_positions"] },
    ]);
    assert.deepEqual(report.failedRules, { max_positions: 1, no_short: 1 });
    const finding = report.findings.find((f) => f.code === "REJECTED_EXIT");
    assert.equal(finding?.severity, "warn");
    assert.deepEqual(finding?.symbols, ["SPY"]);
  });

  it("portfolio_wide_holds_are_not_lost_when_no_symbol_is_journaled", () => {
    const report = buildHealthReport(baseInput({ journalLastHour: [
      journalRow(NOW - MIN, "hold"),
      journalRow(NOW - 2 * MIN, "hold"),
      journalRow(NOW - 3 * MIN, "hold"),
    ] }));
    assert.deepEqual(report.repeatedHolds, [{ symbol: "(portfolio)", holds: 3 }]);
    assert.ok(report.findings.some((f) => f.code === "REPEATED_HOLDS"));
  });

  it("partial_stop_coverage_lists_uncovered_with_local_sources", () => {
    const report = buildHealthReport(baseInput({ openStops: [{ symbol: "SPY", status: "held", remainingQuantity: 10 }] }));
    assert.deepEqual(report.protection.covered, [{ symbol: "SPY", source: "held" }]);
    assert.deepEqual(report.protection.uncovered, ["QQQ"]);
    assert.equal(report.protection.localOnly, true);
    const finding = report.findings.find((f) => f.code === "STOP_COVERAGE_GAP");
    assert.equal(finding?.severity, "warn");
    assert.deepEqual(finding?.symbols, ["QQQ"]);
    assert.equal(report.findings.some((f) => f.code === "HEALTHY"), false);
  });

  it("a_stop_for_only_part_of_a_position_does_not_claim_full_protection", () => {
    const report = buildHealthReport(baseInput({ openStops: [
      { symbol: "SPY", status: "held", remainingQuantity: 4 },
      { symbol: "SPY", status: "submitted", remainingQuantity: 3 },
      { symbol: "QQQ", status: "submitted", remainingQuantity: 5 },
    ] }));
    assert.deepEqual(report.protection.uncovered, ["SPY"]);
    assert.deepEqual(report.protection.covered, [{ symbol: "QQQ", source: "broker" }]);
    assert.equal(report.findings.some((f) => f.code === "HEALTHY"), false);
  });

  it("broker_resting_stop_maps_to_broker_source", () => {
    const report = buildHealthReport(baseInput({ openStops: [{ symbol: "SPY", status: "held", remainingQuantity: 10 }, { symbol: "QQQ", status: "submitted", remainingQuantity: 5 }] }));
    assert.deepEqual(report.protection.covered, [
      { symbol: "SPY", source: "held" },
      { symbol: "QQQ", source: "broker" },
    ]);
    assert.deepEqual(report.protection.uncovered, []);
  });

  it("status_fetch_failure_is_unavailable_not_healthy", () => {
    const report = buildHealthReport(baseInput({ statusOk: false, status: null, statusError: "fetch failed" }));
    assert.equal(report.ok, false);
    assert.equal(report.coverage, "unavailable");
    assert.ok(report.findings.some((f) => f.code === "STATUS_FETCH_FAILED" && f.severity === "error"));
    assert.ok(!report.findings.some((f) => f.code === "HEALTHY"));
  });

  it("db_failure_marks_partial_without_hiding_counts_gap", () => {
    const report = buildHealthReport(baseInput({ dbOk: false, dbError: "no such table" }));
    assert.equal(report.ok, false);
    assert.equal(report.coverage, "partial");
    assert.ok(report.findings.some((f) => f.code === "DB_READ_FAILED" && f.severity === "error"));
  });

  it("missing_account_is_an_error_not_healthy", () => {
    const report = buildHealthReport(baseInput({ status: statusResponse({ account: null }) }));
    assert.equal(report.ok, false);
    assert.equal(report.coverage, "partial");
    assert.ok(report.findings.some((f) => f.code === "ACCOUNT_UNAVAILABLE" && f.severity === "error"));
    assert.equal(report.cashPct, undefined);
  });

  it("a_disconnected_broker_cannot_be_healthy_from_a_cached_account", () => {
    const status = statusResponse();
    status.broker = { state: "disconnected", tools: [] };
    const report = buildHealthReport(baseInput({ status }));
    assert.equal(report.ok, false);
    assert.equal(report.coverage, "partial");
    assert.ok(report.findings.some((f) => f.code === "BROKER_DISCONNECTED"));
    assert.equal(report.findings.some((f) => f.code === "HEALTHY"), false);
  });

  it("a_fresh_cycle_does_not_make_an_old_account_snapshot_current", () => {
    const status = statusResponse();
    assert.ok(status.account);
    status.account.at = NOW - 66 * MIN;
    const report = buildHealthReport(baseInput({ status }));
    assert.equal(report.lastCycle.stale, false);
    assert.equal(report.ok, false);
    assert.equal(report.coverage, "partial");
    assert.ok(report.findings.some((f) => f.code === "ACCOUNT_STALE"));
    assert.equal(report.findings.some((f) => f.code === "HEALTHY"), false);
  });

  it("stale_cycle_uses_open_cadence_plus_grace", () => {
    const report = buildHealthReport(baseInput({ status: statusResponse({ lastCycleAt: NOW - 60 * MIN }) }));
    assert.equal(report.lastCycle.stale, true);
    assert.equal(report.ok, false);
    assert.ok(report.findings.some((f) => f.code === "CYCLE_STALE" && f.severity === "error"));
  });

  it("closed_session_uses_closed_cadence", () => {
    const report = buildHealthReport(
      baseInput({ status: statusResponse({ isOpen: false, lastCycleAt: NOW - 60 * MIN }) }),
    );
    assert.equal(report.lastCycle.expectedCycleMs, 245 * MIN);
    assert.equal(report.lastCycle.stale, false);
    assert.equal(report.ok, true);
  });

  it("future_cycle_start_is_clock_skew_not_fresh", () => {
    const report = buildHealthReport(baseInput({ status: statusResponse({ lastCycleAt: NOW + 2 * MIN }) }));
    assert.equal(report.lastCycle.stale, true);
    assert.equal(report.ok, false);
    assert.ok(report.findings.some((f) => f.code === "CLOCK_SKEW" && f.severity === "error"));
  });

  it("no_recorded_cycle_is_an_error", () => {
    const report = buildHealthReport(baseInput({ status: statusResponse({ lastCycleAt: "omit" }) }));
    assert.equal(report.lastCycle.stale, true);
    assert.ok(report.findings.some((f) => f.code === "NO_CYCLE_RECORDED" && f.severity === "error"));
  });
});
