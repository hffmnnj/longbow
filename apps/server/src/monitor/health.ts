import type {
  JournalAction,
  JournalEntry,
  OrderRecord,
  OrderStatus,
  StatusResponse,
} from "@rh/shared";

/**
 * Read-only hourly health monitor for the Longbow trader.
 *
 * Pure typed aggregation only: no network, no database, no clock reads.
 * The CLI script (`scripts/health-monitor.ts`) supplies the inputs from a
 * single GET /api/status and read-only SELECTs; this module turns them into
 * one bounded JSON-serializable report with deterministic finding codes.
 *
 * Deliberately absent: raw transcripts, account identifiers, auth material,
 * full intent evidence, allocation recommendations, and any buy/sell advice.
 * Repeated holds are diagnostic, never a demand to buy. Stop coverage is
 * labelled as locally known protection; only the broker knows the truth.
 */

export const HEALTH_WINDOW_MS = 60 * 60_000;
export const STALE_GRACE_MS = 5 * 60_000;
/** Holds of one symbol within the window that count as "repeated". */
export const REPEATED_HOLD_THRESHOLD = 3;

export type HealthCoverage = "full" | "partial" | "unavailable";
export type HealthSeverity = "info" | "warn" | "error";

export interface HealthFinding {
  code: string;
  severity: HealthSeverity;
  message: string;
  count?: number;
  symbols?: string[];
}

export interface HealthInput {
  now: number;
  /** False when the GET /api/status failed; status is then null. */
  statusOk: boolean;
  statusError?: string;
  status: StatusResponse | null;
  /** Journal rows (at/action/symbol) inside the last hour, newest first. */
  journalLastHour: Pick<JournalEntry, "at" | "action" | "symbol">[];
  /** Orders created inside the last hour. */
  ordersLastHour: OrderRecord[];
  /**
   * Locally recorded working plain-limit exits (side sell, orderType limit,
   * verdict.isExit, brokerOrderId present, status submitted or
   * partially_filled), collected from the newest-5,000-orders scan regardless
   * of age. The report applies the staleness threshold. Local records only:
   * only the broker knows the truth about resting orders.
   */
  workingExits: OrderRecord[];
  /**
   * Locally known open protective sell stop_limit orders (status held,
   * submitted or partially_filled). Local records only: the
   * broker may hold stops this list does not show, and vice versa.
   */
  openStops: { symbol: string; status: OrderRecord["status"]; remainingQuantity: number }[];
  /** False when the read-only DB queries failed; lists above are then empty. */
  dbOk: boolean;
  dbError?: string;
}

export interface RejectedExit {
  orderId: string;
  symbol: string;
  failedRules: string[];
}

export interface PositionProtection {
  symbol: string;
  /** "held": harness-watched stop; "broker": resting stop the broker should hold. */
  source: "held" | "broker";
}

export interface StaleWorkingExit {
  orderId: string;
  symbol: string;
  status: OrderRecord["status"];
  createdAt: number;
  ageMs: number;
  remainingQuantity: number;
  limitPrice: number;
}

/** Working plain-limit exits shown at most this many entries; total is retained. */
export const STALE_WORKING_EXIT_DISPLAY_LIMIT = 20;

export interface HealthReport {
  generatedAt: number;
  ok: boolean;
  coverage: HealthCoverage;
  counts: { journalLastHour: number; ordersLastHour: number; positions: number };
  lastCycle: {
    /** Start of the most recent cycle run; a start is not proof it completed. */
    startedAt?: number;
    ageMs?: number;
    expectedCycleMs: number;
    stale: boolean;
  };
  /** Descriptive cash share of equity, not an allocation recommendation. */
  cashPct?: number;
  /** Descriptive per-position share of equity, not an allocation recommendation. */
  positionWeights?: { symbol: string; weightPct: number }[];
  journalActions: Partial<Record<JournalAction, number>>;
  ordersByStatus: Partial<Record<OrderStatus, number>>;
  /** Failing risk rule names across last-hour rejected_risk orders. */
  failedRules: Record<string, number>;
  repeatedHolds: { symbol: string; holds: number }[];
  rejectedRiskReducingExits: RejectedExit[];
  protection: {
    covered: PositionProtection[];
    uncovered: string[];
    /** Always true: these are local records, not broker truth. */
    localOnly: true;
    note: string;
  };
  /**
   * Working plain-limit exits at least HEALTH_WINDOW_MS old, oldest first
   * (stable by orderId when tied), display bounded to
   * STALE_WORKING_EXIT_DISPLAY_LIMIT entries with the full detected count in
   * total. Data only: no intent evidence, account identifiers, or raw broker
   * responses. Age is wall-clock time since createdAt, not time since last
   * fill; a resting price is not claimed to be stale.
   */
  staleWorkingExits: {
    /** Always true: these are local records, not broker truth. */
    localOnly: true;
    total: number;
    orders: StaleWorkingExit[];
  };
  findings: HealthFinding[];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function failingRules(order: OrderRecord): string[] {
  return order.verdict.checks.filter((check) => !check.ok).map((check) => check.rule);
}

function isWorkingExitCandidate(order: OrderRecord): boolean {
  if (order.intent?.side !== "sell") return false;
  if (order.intent?.orderType !== "limit") return false;
  if (order.verdict?.isExit !== true) return false;
  if (typeof order.brokerOrderId !== "string" || order.brokerOrderId.length === 0) return false;
  return order.status === "submitted" || order.status === "partially_filled";
}

export function buildHealthReport(input: HealthInput): HealthReport {
  const findings: HealthFinding[] = [];
  const error = (code: string, message: string, extra?: { count?: number; symbols?: string[] }): void => {
    findings.push({ code, severity: "error", message, ...extra });
  };
  const warn = (code: string, message: string, extra?: { count?: number; symbols?: string[] }): void => {
    findings.push({ code, severity: "warn", message, ...extra });
  };

  if (!input.statusOk || input.status === null) {
    error("STATUS_FETCH_FAILED", `GET /api/status failed${input.statusError ? `: ${input.statusError}` : ""}; health is unknown, not healthy.`);
  }
  if (!input.dbOk) {
    error("DB_READ_FAILED", `read-only app.sqlite queries failed${input.dbError ? `: ${input.dbError}` : ""}; journal and order counts are unknown.`);
  }

  const settings = input.status?.settings;
  const isOpen = input.status?.market.isOpen ?? false;
  const cycleMinutes = settings === undefined ? 30 : isOpen ? settings.cycleMinutesOpen : settings.cycleMinutesClosed;
  const expectedCycleMs = cycleMinutes * 60_000 + STALE_GRACE_MS;

  const startedAt = input.status?.agent.lastCycleAt;
  let ageMs: number | undefined;
  let stale: boolean;
  if (startedAt === undefined) {
    stale = true;
    if (input.status !== null) error("NO_CYCLE_RECORDED", "the agent reports no cycle start yet; the scheduler may never have run.");
  } else {
    ageMs = input.now - startedAt;
    if (ageMs < 0) {
      stale = true;
      error("CLOCK_SKEW", `last cycle start is ${-ageMs}ms in the future; check the system clock before trusting ages.`);
    } else if (ageMs > expectedCycleMs) {
      stale = true;
      error("CYCLE_STALE", `last cycle started ${Math.round(ageMs / 60_000)}min ago; expected every ${cycleMinutes}min plus grace.`);
    } else {
      stale = false;
    }
  }

  const account = input.status?.account ?? null;
  const brokerConnected = input.status?.broker?.state === "connected";
  if (input.status !== null && !brokerConnected) {
    error("BROKER_DISCONNECTED", "broker is not connected; a cached account snapshot does not establish current account health.");
  }
  if (input.status !== null && account === null) {
    error("ACCOUNT_UNAVAILABLE", "status has no account snapshot; equity, cash and positions are unknown.");
  }
  const accountAgeMs = account === null ? undefined : input.now - account.at;
  const accountFresh = accountAgeMs !== undefined && Number.isFinite(accountAgeMs) &&
    accountAgeMs >= -5_000 && accountAgeMs <= 2 * cycleMinutes * 60_000 + STALE_GRACE_MS;
  if (account !== null && !accountFresh) {
    error("ACCOUNT_STALE", "account snapshot is older than two cycle windows plus grace, invalid, or in the future; current balances and protection are unknown.");
  }

  const equity = account?.equity ?? 0;
  const cashPct = account !== null && equity > 0 ? round1((account.cash / equity) * 100) : undefined;
  const positionWeights =
    account !== null && equity > 0
      ? account.positions
          .filter((p) => p.quantity > 0)
          .map((p) => ({ symbol: p.symbol, weightPct: round1((p.marketValue / equity) * 100) }))
      : undefined;

  const journalActions: Partial<Record<JournalAction, number>> = {};
  const holdsBySymbol = new Map<string, number>();
  for (const entry of input.journalLastHour) {
    journalActions[entry.action] = (journalActions[entry.action] ?? 0) + 1;
    if (entry.action === "hold") {
      const symbol = entry.symbol ?? "(portfolio)";
      holdsBySymbol.set(symbol, (holdsBySymbol.get(symbol) ?? 0) + 1);
    }
  }
  const repeatedHolds = [...holdsBySymbol]
    .filter(([, holds]) => holds >= REPEATED_HOLD_THRESHOLD)
    .map(([symbol, holds]) => ({ symbol, holds }))
    .sort((a, b) => b.holds - a.holds || (a.symbol < b.symbol ? -1 : 1));
  if (repeatedHolds.length > 0) {
    warn(
      "REPEATED_HOLDS",
      "diagnostic only: these symbols were held repeatedly in the last hour; this is not a signal to buy.",
      { count: repeatedHolds.length, symbols: repeatedHolds.map((h) => h.symbol) },
    );
  }

  const ordersByStatus: Partial<Record<OrderStatus, number>> = {};
  const failedRules: Record<string, number> = {};
  const rejectedRiskReducingExits: RejectedExit[] = [];
  for (const order of input.ordersLastHour) {
    ordersByStatus[order.status] = (ordersByStatus[order.status] ?? 0) + 1;
    if (order.status !== "rejected_risk") continue;
    const failed = failingRules(order);
    for (const rule of failed) failedRules[rule] = (failedRules[rule] ?? 0) + 1;
    // verdict.isExit is the engine's own classification: an oversell (sell
    // larger than the held long) is not an exit, so it is excluded here.
    if (order.verdict.isExit) {
      rejectedRiskReducingExits.push({ orderId: order.id, symbol: order.intent.symbol, failedRules: failed });
    }
  }
  if (rejectedRiskReducingExits.length > 0) {
    warn("REJECTED_EXIT", "risk rejected an order that would have reduced or closed a long; review the failed rules.", {
      count: rejectedRiskReducingExits.length,
      symbols: [...new Set(rejectedRiskReducingExits.map((o) => o.symbol))].sort(),
    });
  }

  const staleWorkingExitOrders: StaleWorkingExit[] = [];
  for (const order of input.workingExits) {
    // Filter defensively: the CLI already collects candidates, but callers
    // may supply unfiltered rows.
    if (!isWorkingExitCandidate(order)) continue;
    const createdAt = order.createdAt;
    const ageMs = input.now - createdAt;
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs < HEALTH_WINDOW_MS) continue;
    const remainingQuantity = Math.max(0, order.intent.quantity - (order.filledQuantity ?? 0));
    if (!Number.isFinite(remainingQuantity) || remainingQuantity <= 0) continue;
    const limitPrice = order.intent.limitPrice;
    if (!Number.isFinite(limitPrice)) continue;
    staleWorkingExitOrders.push({
      orderId: order.id,
      symbol: order.intent.symbol,
      status: order.status,
      createdAt,
      ageMs,
      remainingQuantity,
      limitPrice,
    });
  }
  staleWorkingExitOrders.sort((a, b) => a.createdAt - b.createdAt || (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0));
  const staleWorkingExits = {
    localOnly: true as const,
    total: staleWorkingExitOrders.length,
    orders: staleWorkingExitOrders.slice(0, STALE_WORKING_EXIT_DISPLAY_LIMIT),
  };
  if (staleWorkingExits.total > 0) {
    const symbols = [...new Set(staleWorkingExitOrders.map((o) => o.symbol))].sort();
    warn(
      "STALE_WORKING_EXIT",
      `locally recorded working exits at least 60 minutes old (${staleWorkingExits.total}); ` +
        "they can be intentionally resting and need broker reconciliation; " +
        "this does not authorize cancellation or repricing.",
      { count: staleWorkingExits.total, symbols },
    );
  }

  const covered: PositionProtection[] = [];
  const uncovered: string[] = [];
  if (account !== null) {
    for (const position of account.positions) {
      if (position.quantity <= 0) continue;
      const stops = input.openStops.filter((s) => s.symbol === position.symbol && s.remainingQuantity > 0);
      const protectedQuantity = stops.reduce((sum, stop) => sum + stop.remainingQuantity, 0);
      const stop = stops[0];
      if (stop === undefined || protectedQuantity < position.quantity) uncovered.push(position.symbol);
      else covered.push({ symbol: position.symbol, source: stop.status === "held" ? "held" : "broker" });
    }
    uncovered.sort();
    if (uncovered.length > 0) {
      warn("STOP_COVERAGE_GAP", "local records do not show full-quantity protective stops for these positions; only the broker knows the truth.", {
        count: uncovered.length,
        symbols: [...uncovered],
      });
    }
  }

  const coverage: HealthCoverage =
    input.status === null || !input.statusOk ? "unavailable" : !input.dbOk || account === null || !accountFresh || !brokerConnected ? "partial" : "full";
  const ok = !findings.some((f) => f.severity === "error");
  if (ok && findings.length === 0) {
    findings.push({ code: "HEALTHY", severity: "info", message: "status reachable, cycle fresh, account known, no gaps in local records." });
  }

  return {
    generatedAt: input.now,
    ok,
    coverage,
    counts: {
      journalLastHour: input.journalLastHour.length,
      ordersLastHour: input.ordersLastHour.length,
      positions: account?.positions.filter((p) => p.quantity > 0).length ?? 0,
    },
    lastCycle: {
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(ageMs !== undefined ? { ageMs } : {}),
      expectedCycleMs,
      stale,
    },
    ...(cashPct !== undefined ? { cashPct } : {}),
    ...(positionWeights !== undefined ? { positionWeights } : {}),
    journalActions,
    ordersByStatus,
    failedRules,
    repeatedHolds,
    rejectedRiskReducingExits,
    staleWorkingExits,
    protection: {
      covered,
      uncovered,
      localOnly: true,
      note: "Local stop records only; the broker is the source of truth for resting stops.",
    },
    findings,
  };
}
