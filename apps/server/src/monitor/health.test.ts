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
  id?: string;
  createdAt?: number;
  orderType?: "limit" | "stop_limit";
  quantity?: number;
  filledQuantity?: number;
  brokerOrderId?: string;
  limitPrice?: number;
}): OrderRecord {
  const {
    status,
    symbol = "SPY",
    side = "sell",
    isExit = false,
    failedRules = [],
    createdAt = NOW - 10 * MIN,
    orderType = "limit",
    quantity = 1,
    limitPrice = 500,
  } = overrides;
  orderSeq += 1;
  return {
    id: overrides.id ?? `order-${orderSeq}`,
    createdAt,
    updatedAt: createdAt,
    intent: {
      symbol,
      side,
      quantity,
      orderType,
      limitPrice,
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
    ...(overrides.brokerOrderId !== undefined ? { brokerOrderId: overrides.brokerOrderId } : {}),
    ...(overrides.filledQuantity !== undefined ? { filledQuantity: overrides.filledQuantity } : {}),
  };
}

function workingExit(overrides: Omit<Parameters<typeof orderRecord>[0], "status"> & { status?: OrderRecord["status"] } = {}): OrderRecord {
  return orderRecord({ status: "submitted", side: "sell", isExit: true, brokerOrderId: "brk-1", ...overrides });
}

function baseInput(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    now: NOW,
    statusOk: true,
    status: statusResponse(),
    journalLastHour: [],
    ordersLastHour: [],
    workingExits: [],
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

  it("an_hours_old_btc_limit_exit_is_flagged_while_last_hour_orders_are_empty", () => {
    const exit = workingExit({ id: "btc-exit-1", symbol: "BTC", createdAt: NOW - 3 * 60 * MIN, quantity: 0.5, limitPrice: 97_500 });
    const report = buildHealthReport(baseInput({ ordersLastHour: [], workingExits: [exit] }));
    assert.equal(report.staleWorkingExits.localOnly, true);
    assert.equal(report.staleWorkingExits.total, 1);
    assert.deepEqual(report.staleWorkingExits.orders, [
      {
        orderId: "btc-exit-1",
        symbol: "BTC",
        status: "submitted",
        createdAt: NOW - 3 * 60 * MIN,
        ageMs: 3 * 60 * MIN,
        remainingQuantity: 0.5,
        limitPrice: 97_500,
      },
    ]);
    const finding = report.findings.find((f) => f.code === "STALE_WORKING_EXIT");
    assert.equal(finding?.severity, "warn");
    assert.equal(finding?.count, 1);
    assert.deepEqual(finding?.symbols, ["BTC"]);
    assert.match(finding?.message ?? "", /at least 60 minutes old/);
    assert.match(finding?.message ?? "", /broker reconciliation/);
    assert.match(finding?.message ?? "", /does not authorize/);
  });

  it("stale_threshold_is_inclusive_at_sixty_minutes", () => {
    const exact = workingExit({ id: "exit-exact", createdAt: NOW - 60 * MIN });
    const younger = workingExit({ id: "exit-younger", createdAt: NOW - 60 * MIN + 1 });
    const report = buildHealthReport(baseInput({ workingExits: [exact, younger] }));
    assert.equal(report.staleWorkingExits.total, 1);
    assert.deepEqual(report.staleWorkingExits.orders.map((o) => o.orderId), ["exit-exact"]);
  });

  it("partial_fills_report_remaining_while_fully_filled_exits_are_excluded", () => {
    const partial = workingExit({ id: "exit-partial", status: "partially_filled", createdAt: NOW - 2 * 60 * MIN, quantity: 10, filledQuantity: 6 });
    const filled = workingExit({ id: "exit-filled", createdAt: NOW - 2 * 60 * MIN, quantity: 10, filledQuantity: 10 });
    const report = buildHealthReport(baseInput({ workingExits: [partial, filled] }));
    assert.equal(report.staleWorkingExits.total, 1);
    assert.equal(report.staleWorkingExits.orders[0]?.orderId, "exit-partial");
    assert.equal(report.staleWorkingExits.orders[0]?.remainingQuantity, 4);
  });

  it("non_candidate_working_rows_are_excluded_from_stale_exits", () => {
    const staleAt = NOW - 2 * 60 * MIN;
    const candidate = workingExit({ id: "exit-good", symbol: "KEEP", createdAt: staleAt });
    const report = buildHealthReport(
      baseInput({
        workingExits: [
          candidate,
          workingExit({ id: "buy", symbol: "BUY", side: "buy", createdAt: staleAt }),
          workingExit({ id: "nonexit", symbol: "NONEXIT", isExit: false, createdAt: staleAt }),
          workingExit({ id: "stop", symbol: "STOP", orderType: "stop_limit", createdAt: staleAt }),
          workingExit({ id: "held", symbol: "HELD", status: "held", createdAt: staleAt }),
          workingExit({ id: "filled", symbol: "FILLED", status: "filled", createdAt: staleAt }),
          workingExit({ id: "cancelled", symbol: "CANCELLED", status: "cancelled", createdAt: staleAt }),
          workingExit({ id: "rejected", symbol: "REJECTED", status: "rejected_risk", createdAt: staleAt }),
          orderRecord({ id: "nobroker", status: "submitted", symbol: "NOBROKER", side: "sell", isExit: true, createdAt: staleAt }),
          workingExit({ id: "future", symbol: "FUTURE", createdAt: NOW + MIN }),
          workingExit({ id: "zero", symbol: "ZERO", quantity: 5, filledQuantity: 5, createdAt: staleAt }),
        ],
      }),
    );
    assert.equal(report.staleWorkingExits.total, 1);
    assert.deepEqual(report.staleWorkingExits.orders.map((o) => o.orderId), ["exit-good"]);
    const finding = report.findings.find((f) => f.code === "STALE_WORKING_EXIT");
    assert.deepEqual(finding?.symbols, ["KEEP"]);
  });

  it("stale_exits_are_reported_after_close_without_trading_action", () => {
    const exit = workingExit({ id: "btc-exit-closed", symbol: "BTC", createdAt: NOW - 3 * 60 * MIN });
    const report = buildHealthReport(
      baseInput({ status: statusResponse({ isOpen: false, lastCycleAt: NOW - 60 * MIN }), workingExits: [exit] }),
    );
    assert.ok(report.findings.some((f) => f.code === "STALE_WORKING_EXIT" && f.severity === "warn"));
    assert.equal(report.staleWorkingExits.total, 1);
    assert.equal(report.ok, true);
  });

  it("stale_exits_display_oldest_first_bounded_with_full_total", () => {
    const exits = Array.from({ length: 25 }, (_, i) =>
      workingExit({ id: `exit-${String(i).padStart(2, "0")}`, symbol: i % 2 === 0 ? "AAA" : "BBB", createdAt: NOW - (25 - i) * MIN - 60 * MIN }),
    );
    const report = buildHealthReport(baseInput({ workingExits: exits }));
    assert.equal(report.staleWorkingExits.total, 25);
    assert.equal(report.staleWorkingExits.orders.length, 20);
    assert.equal(report.staleWorkingExits.orders[0]?.orderId, "exit-00");
    assert.equal(report.staleWorkingExits.orders[19]?.orderId, "exit-19");
    const finding = report.findings.find((f) => f.code === "STALE_WORKING_EXIT");
    assert.equal(finding?.count, 25);
    assert.deepEqual(finding?.symbols, ["AAA", "BBB"]);
  });

  it("tied_stale_exits_order_stably_by_id", () => {
    const at = NOW - 2 * 60 * MIN;
    const report = buildHealthReport(
      baseInput({ workingExits: [workingExit({ id: "exit-b", createdAt: at }), workingExit({ id: "exit-a", createdAt: at })] }),
    );
    assert.deepEqual(report.staleWorkingExits.orders.map((o) => o.orderId), ["exit-a", "exit-b"]);
  });

  it("stale_exit_warning_keeps_ok_without_healthy", () => {
    const exit = workingExit({ createdAt: NOW - 2 * 60 * MIN });
    const report = buildHealthReport(baseInput({ workingExits: [exit] }));
    assert.equal(report.ok, true);
    assert.equal(report.coverage, "full");
    assert.equal(report.findings.some((f) => f.code === "HEALTHY"), false);
    assert.ok(report.findings.some((f) => f.code === "STALE_WORKING_EXIT" && f.severity === "warn"));
  });

  it("no_stale_exits_means_empty_list_without_warning", () => {
    const fresh = workingExit({ createdAt: NOW - 10 * MIN });
    const report = buildHealthReport(baseInput({ workingExits: [fresh] }));
    assert.deepEqual(report.staleWorkingExits, { localOnly: true, total: 0, orders: [] });
    assert.equal(report.findings.some((f) => f.code === "STALE_WORKING_EXIT"), false);
    assert.ok(report.findings.some((f) => f.code === "HEALTHY"));
  });
});
