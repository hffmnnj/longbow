import type {
  AccountSnapshot,
  MarketClock,
  OrderIntent,
  OrderRecord,
  Quote,
  RiskCheck,
  RiskVerdict,
  Settings,
} from "@rh/shared";
import { etDateForInstant } from "./calendar.ts";

/**
 * Pure risk engine. `evaluate` runs every rule, appends one RiskCheck per
 * rule, and approves only when all checks pass. A sell is an exit when the
 * account holds at least that quantity long; everything else is an entry.
 * Exits skip the entry-sizing rules but still face the safety rules.
 */

export interface RiskInput {
  intent: OrderIntent;
  settings: Settings;
  account: AccountSnapshot;
  quote: Quote;
  market: MarketClock;
  equityMarks: { dayStart?: number; monthPeak?: number };
  /** Submitted orders of the last 7 days. */
  recentOrders: OrderRecord[];
  /** ET date the current position in this symbol was first bought, if known. */
  lotOpenedEtDate?: string;
  /** Next scheduled earnings date (ET YYYY-MM-DD) within 30 days, when known. */
  nextEarningsDate?: string;
  /** Average daily dollar volume over the last 20 sessions, when known. */
  avgDollarVolume20?: number;
  /**
   * False when the market-data fetches failed or no provider is wired; the
   * earnings and liquidity entry rules then fail closed instead of passing.
   */
  marketDataAvailable: boolean;
  sectorOf: (symbol: string) => string | undefined;
  tradingDaysBetween: (a: string, b: string) => number;
  now: number;
}

const SEVEN_DAYS_MS = 7 * 86_400_000;
const MS_PER_DAY = 86_400_000;

export function sevenDaysAgo(now: number): number {
  return now - SEVEN_DAYS_MS;
}

function etDateOf(createdAt: number): string {
  return etDateForInstant(createdAt);
}

/** Submitted buys today in ET. */
export function countSubmittedBuysToday(recentOrders: OrderRecord[], todayEt: string): number {
  return recentOrders.filter(
    (o) => o.status === "submitted" && o.intent.side === "buy" && etDateOf(o.createdAt) === todayEt,
  ).length;
}

/**
 * Day trades (same-symbol buy and sell on the same ET day) in the last 5
 * trading days including today, from submitted orders.
 */
export function countDayTrades(
  recentOrders: OrderRecord[],
  todayEt: string,
  tradingDaysBetween: (a: string, b: string) => number,
): number {
  const submitted = recentOrders.filter((o) => o.status === "submitted");
  const buyDays = new Set(
    submitted
      .filter((o) => o.intent.side === "buy")
      .map((o) => `${o.intent.symbol}@${etDateOf(o.createdAt)}`),
  );
  let count = 0;
  for (const sell of submitted.filter((o) => o.intent.side === "sell")) {
    const day = etDateOf(sell.createdAt);
    if (buyDays.has(`${sell.intent.symbol}@${day}`) && tradingDaysBetween(day, todayEt) <= 3) {
      count++;
    }
  }
  return count;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function evaluate(input: RiskInput): RiskVerdict {
  const {
    intent,
    settings,
    account,
    quote,
    market,
    equityMarks,
    recentOrders,
    lotOpenedEtDate,
    nextEarningsDate,
    avgDollarVolume20,
    marketDataAvailable,
    sectorOf,
    tradingDaysBetween,
    now,
  } = input;
  const risk = settings.risk;
  const checks: RiskCheck[] = [];
  const push = (rule: string, ok: boolean, detail: string): void => {
    checks.push({ rule, ok, detail });
  };

  const equity = account.equity;
  const mid = (quote.bid + quote.ask) / 2;
  const notional = intent.quantity * intent.limitPrice;
  const position = account.positions.find((p) => p.symbol === intent.symbol);
  const heldQty = position?.quantity ?? 0;
  const isExit = intent.side === "sell" && heldQty >= intent.quantity;
  const isEntry = !isExit;
  const todayEt = etDateForInstant(now);
  const submitted = recentOrders.filter((o) => o.status === "submitted");

  // 1. kill_switch: blocks every order.
  push(
    "kill_switch",
    !settings.killSwitch,
    settings.killSwitch ? "kill switch is ENGAGED; every order is blocked" : "kill switch is off",
  );

  // 2. mode: "off" blocks every order.
  push(
    "mode",
    settings.mode !== "off",
    settings.mode === "off"
      ? 'mode is "off" (research only); every order is blocked'
      : `mode is "${settings.mode}"; orders may flow`,
  );

  // 3. market_hours: the regular session must be open, for entries and exits alike.
  push(
    "market_hours",
    market.isOpen,
    market.isOpen
      ? `market is open (regular session, trading day ${market.tradingDay})`
      : `market is ${market.session} (trading day ${market.tradingDay}); the regular session is closed`,
  );

  // 4. entry_window: no entries near the open or the close. Exits are allowed.
  if (!isEntry) {
    push("entry_window", true, "exit; the entry window does not apply");
  } else {
    const minutesSinceOpen = Math.floor((now - market.nextOpen) / 60_000);
    const minutesToClose = Math.floor((market.nextClose - now) / 60_000);
    const ok =
      minutesSinceOpen >= risk.noTradeOpenMinutes && minutesToClose >= risk.noTradeCloseMinutes;
    push(
      "entry_window",
      ok,
      `entry is ${minutesSinceOpen}min after the open and ${minutesToClose}min before the close ` +
        `(blocked in the first ${risk.noTradeOpenMinutes}min and the last ${risk.noTradeCloseMinutes}min)`,
    );
  }

  // 5. quote_fresh: at most 60 seconds old, with a sane bid/ask.
  const ageMs = now - quote.at;
  const ageSec = ageMs / 1000;
  push(
    "quote_fresh",
    ageMs <= 60_000 && ageMs >= -5_000 && quote.bid > 0 && quote.ask >= quote.bid,
    `quote for ${intent.symbol} is ${ageSec.toFixed(1)}s old (limit 60s), ` +
      `bid ${quote.bid} ask ${quote.ask} last ${quote.last}`,
  );

  // 6. spread: (ask - bid) / mid in basis points.
  const spreadBps = mid > 0 ? ((quote.ask - quote.bid) / mid) * 10_000 : Number.POSITIVE_INFINITY;
  push(
    "spread",
    spreadBps <= risk.maxSpreadBps,
    `spread ${quote.ask - quote.bid} on mid ${mid} = ${spreadBps.toFixed(1)}bps ` +
      `(limit ${risk.maxSpreadBps}bps)`,
  );

  // 7. limit_vs_mid: the limit may sit at most maxSlippageBps through the mid.
  if (intent.orderType === "stop_limit" && intent.stopPrice === undefined) {
    push("limit_vs_mid", false, "stop_limit order is missing its required stopPrice");
  } else if (mid <= 0) {
    push("limit_vs_mid", false, `mid ${mid} is not positive; cannot check the limit`);
  } else if (intent.orderType === "stop_limit") {
    const stop = intent.stopPrice ?? Number.NaN;
    const ok = intent.side === "buy" ? stop >= mid : stop <= mid;
    push(
      "limit_vs_mid",
      ok,
      `${intent.side} stop ${stop} vs current ${mid} ` +
        `(must trigger at or ${intent.side === "buy" ? "above" : "below"} the current price)`,
    );
  } else if (intent.side === "buy") {
    const ceiling = mid * (1 + risk.maxSlippageBps / 10_000);
    push(
      "limit_vs_mid",
      intent.limitPrice <= ceiling,
      `buy limit ${intent.limitPrice} vs mid ${mid} (ceiling ${ceiling.toFixed(2)} at ${risk.maxSlippageBps}bps)`,
    );
  } else {
    const floor = mid * (1 - risk.maxSlippageBps / 10_000);
    push(
      "limit_vs_mid",
      intent.limitPrice >= floor,
      `sell limit ${intent.limitPrice} vs mid ${mid} (floor ${floor.toFixed(2)} at ${risk.maxSlippageBps}bps)`,
    );
  }

  // No shorting: a sell larger than the held long is rejected outright.
  if (intent.side === "buy") {
    push("no_short", true, "buy; shorting rules do not apply");
  } else {
    push(
      "no_short",
      heldQty >= intent.quantity,
      `sell ${intent.quantity} with ${heldQty} held long (shorting is not allowed)`,
    );
  }

  // 8. daily_loss: entries stop when equity falls this far below the day start. Exits allowed.
  if (!isEntry) {
    push("daily_loss", true, "exit; the daily-loss halt does not apply");
  } else if (equityMarks.dayStart === undefined) {
    push("daily_loss", true, `no day-start equity mark yet; equity is ${money(equity)}`);
  } else {
    const floor = equityMarks.dayStart * (1 - risk.dailyLossHaltPct / 100);
    push(
      "daily_loss",
      equity > floor,
      `equity ${money(equity)} vs day start ${money(equityMarks.dayStart)} ` +
        `halt floor ${money(floor)} (-${risk.dailyLossHaltPct}%)`,
    );
  }

  // 9. drawdown: entries stop on the monthly breaker. The gate persists the trip.
  if (!isEntry) {
    push("drawdown", true, "exit; the drawdown breaker does not apply");
  } else if (settings.drawdownHalted) {
    push("drawdown", false, "monthly drawdown breaker already tripped; needs a human re-arm");
  } else if (equityMarks.monthPeak === undefined) {
    push("drawdown", true, `no month-peak equity mark yet; equity is ${money(equity)}`);
  } else {
    const floor = equityMarks.monthPeak * (1 - risk.monthlyDrawdownHaltPct / 100);
    const tripped = equity <= floor;
    push(
      "drawdown",
      !tripped,
      tripped
        ? `BREAKER TRIPPED: equity ${money(equity)} at or below month peak ` +
            `${money(equityMarks.monthPeak)} halt floor ${money(floor)} (-${risk.monthlyDrawdownHaltPct}%)`
        : `equity ${money(equity)} vs month peak ${money(equityMarks.monthPeak)} ` +
            `halt floor ${money(floor)} (-${risk.monthlyDrawdownHaltPct}%)`,
    );
  }

  // 10. risk_per_trade: loss to invalidation bounded by % of equity (entries only).
  let riskQty: number | undefined;
  if (!isEntry) {
    push("risk_per_trade", true, "exit; per-trade risk sizing does not apply");
  } else {
    const riskPerShare = Math.abs(intent.limitPrice - intent.invalidationPrice);
    const allowance = equity * (risk.maxRiskPerTradePct / 100);
    if (riskPerShare > 0 && Number.isFinite(riskPerShare)) {
      riskQty = Math.floor(allowance / riskPerShare);
    }
    const sideOk =
      intent.side === "buy"
        ? intent.invalidationPrice < intent.limitPrice
        : intent.invalidationPrice > intent.limitPrice;
    const loss = intent.quantity * riskPerShare;
    push(
      "risk_per_trade",
      sideOk && loss <= allowance,
      !sideOk
        ? `${intent.side} invalidation ${intent.invalidationPrice} is on the wrong side of limit ` +
            `${intent.limitPrice} (must be below for buys, above for sells)`
        : `risk ${intent.quantity}x${money(riskPerShare)}=${money(loss)} vs allowance ` +
            `${money(allowance)} (${risk.maxRiskPerTradePct}% of equity ${money(equity)})`,
    );
  }

  // 11. position_size: the symbol's value after the order bounded by % of equity.
  let positionQty: number | undefined;
  if (!isEntry) {
    push("position_size", true, "exit; position sizing does not apply");
  } else {
    const existing = position?.marketValue ?? 0;
    const allowance = equity * (risk.maxPositionPct / 100);
    if (intent.limitPrice > 0) {
      positionQty = Math.floor((allowance - existing) / intent.limitPrice);
    }
    push(
      "position_size",
      existing + notional <= allowance,
      `existing ${money(existing)} + order ${money(notional)} = ${money(existing + notional)} ` +
        `vs ${money(allowance)} (${risk.maxPositionPct}% of equity ${money(equity)})`,
    );
  }

  // 12. sector: the sector's value after the order bounded by % of equity.
  if (!isEntry) {
    push("sector", true, "exit; sector sizing does not apply");
  } else {
    const sector = intent.sector ?? sectorOf(intent.symbol);
    if (sector === undefined) {
      push("sector", true, `no sector known for ${intent.symbol}; skipping`);
    } else {
      const held = account.positions
        .filter((p) => (p.sector ?? sectorOf(p.symbol)) === sector)
        .reduce((sum, p) => sum + p.marketValue, 0);
      const allowance = equity * (risk.maxSectorPct / 100);
      push(
        "sector",
        held + notional <= allowance,
        `sector "${sector}" held ${money(held)} + order ${money(notional)} = ${money(held + notional)} ` +
          `vs ${money(allowance)} (${risk.maxSectorPct}% of equity ${money(equity)})`,
      );
    }
  }

  // 13. notional_cap: fat-finger cap, plus buying power / settled cash for buys.
  let capQty: number | undefined;
  if (intent.limitPrice > 0 && Number.isFinite(intent.limitPrice)) {
    capQty = Math.floor(risk.maxOrderNotionalUsd / intent.limitPrice);
    if (intent.side === "buy") {
      capQty = Math.min(capQty, Math.floor(account.buyingPower / intent.limitPrice));
      if (account.settledCash !== undefined) {
        capQty = Math.min(capQty, Math.floor(account.settledCash / intent.limitPrice));
      }
    }
  }
  if (intent.side === "sell") {
    push(
      "notional_cap",
      notional <= risk.maxOrderNotionalUsd,
      `sell notional ${money(notional)} vs cap ${money(risk.maxOrderNotionalUsd)}`,
    );
  } else {
    const cashOk =
      account.settledCash === undefined ? true : notional <= account.settledCash;
    const ok =
      notional <= risk.maxOrderNotionalUsd && notional <= account.buyingPower && cashOk;
    push(
      "notional_cap",
      ok,
      `buy notional ${money(notional)} vs cap ${money(risk.maxOrderNotionalUsd)}, ` +
        `buying power ${money(account.buyingPower)}` +
        (account.settledCash === undefined
          ? " (no settled-cash mark)"
          : `, settled cash ${money(account.settledCash)}`),
    );
  }

  // 14. max_positions: no new symbol once maxPositions distinct symbols are held.
  if (!isEntry) {
    push("max_positions", true, "exit; the position count does not apply");
  } else {
    const heldSymbols = new Set(
      account.positions.filter((p) => p.quantity > 0).map((p) => p.symbol),
    );
    const alreadyHeld = heldSymbols.has(intent.symbol);
    push(
      "max_positions",
      alreadyHeld || heldSymbols.size < risk.maxPositions,
      alreadyHeld
        ? `${intent.symbol} is already held (${heldSymbols.size}/${risk.maxPositions} symbols)`
        : `holds ${heldSymbols.size}/${risk.maxPositions} symbols; ${intent.symbol} would be new`,
    );
  }

  // 15. entries_per_day: submitted buys today in ET below the daily max.
  if (intent.side !== "buy") {
    push("entries_per_day", true, "not a buy; the daily entry count does not apply");
  } else {
    const count = countSubmittedBuysToday(submitted, todayEt);
    push(
      "entries_per_day",
      count < risk.maxEntriesPerDay,
      `${count} submitted buys today in ET vs max ${risk.maxEntriesPerDay}`,
    );
  }

  // 16. min_hold: exits of young lots are blocked unless the quote is at/below
  // the original entry's invalidation price (a stop exit).
  if (isEntry) {
    push("min_hold", true, "entry; the minimum hold does not apply");
  } else if (lotOpenedEtDate === undefined) {
    push(
      "min_hold",
      true,
      "lot age unknown (position predates order records); treating as seasoned",
    );
  } else {
    const heldDays = tradingDaysBetween(lotOpenedEtDate, todayEt);
    if (heldDays >= risk.minHoldDays) {
      push(
        "min_hold",
        true,
        `lot opened ${lotOpenedEtDate} (${heldDays} trading days ago; minimum ${risk.minHoldDays})`,
      );
    } else {
      const original = submitted
        .filter((o) => o.intent.side === "buy" && o.intent.symbol === intent.symbol)
        .sort((a, b) => a.createdAt - b.createdAt)[0];
      const stopExit =
        original !== undefined && quote.last > 0 && quote.last <= original.intent.invalidationPrice;
      push(
        "min_hold",
        stopExit,
        stopExit
          ? `lot opened ${lotOpenedEtDate} (${heldDays}d < ${risk.minHoldDays}d) but last ${quote.last} ` +
              `is at/below entry invalidation ${original?.intent.invalidationPrice}: stop exit`
          : original === undefined
            ? `lot opened ${lotOpenedEtDate} (${heldDays}d < ${risk.minHoldDays}d) and the original ` +
              `entry is outside the 7-day window; cannot verify a stop`
            : `lot opened ${lotOpenedEtDate} (${heldDays}d < ${risk.minHoldDays}d); last ${quote.last} ` +
              `is above entry invalidation ${original.intent.invalidationPrice}`,
      );
    }
  }

  // 17. day_trades: same-day round trips count against the 5-day max. Stop exits are not exempt.
  const boughtToday = submitted.some(
    (o) =>
      o.intent.side === "buy" &&
      o.intent.symbol === intent.symbol &&
      etDateOf(o.createdAt) === todayEt,
  );
  if (intent.side !== "sell" || !boughtToday) {
    push("day_trades", true, "not a same-day round trip; the day-trade count does not apply");
  } else {
    const count = countDayTrades(submitted, todayEt, tradingDaysBetween);
    push(
      "day_trades",
      count < risk.maxDayTrades5d,
      `${count} day trades in the last 5 trading days vs max ${risk.maxDayTrades5d} ` +
        `(sell of ${intent.symbol} bought today in ET)`,
    );
  }

  // 18. ev_after_costs: expected value after costs must clear a multiple of costs.
  if (!isEntry) {
    push("ev_after_costs", true, "exit; expected value does not apply");
  } else if (mid <= 0) {
    push("ev_after_costs", false, `mid ${mid} is not positive; cannot check expected value`);
  } else {
    const spreadPct = ((quote.ask - quote.bid) / mid) * 100;
    const ev =
      intent.probabilityWin * intent.expectedGainPct -
      (1 - intent.probabilityWin) * intent.expectedLossPct -
      intent.estimatedCostPct;
    const required = risk.minEvToCost * intent.estimatedCostPct;
    const ok = intent.estimatedCostPct >= spreadPct && ev > required;
    push(
      "ev_after_costs",
      ok,
      `EV ${ev.toFixed(2)}% = ${intent.probabilityWin}x${intent.expectedGainPct}% - ` +
        `${(1 - intent.probabilityWin).toFixed(2)}x${intent.expectedLossPct}% - ` +
        `${intent.estimatedCostPct}% costs vs required >${required.toFixed(2)}% ` +
        `(${risk.minEvToCost}x costs); costs ${intent.estimatedCostPct}% vs spread ${spreadPct.toFixed(3)}%`,
    );
  }

  // 19. time_stop: after today in ET and within 60 calendar days.
  if (!isEntry) {
    push("time_stop", true, "exit; the time stop does not apply");
  } else {
    const stopDay = Date.UTC(
      Number(intent.timeStopDate.slice(0, 4)),
      Number(intent.timeStopDate.slice(5, 7)) - 1,
      Number(intent.timeStopDate.slice(8, 10)),
    );
    const todayDay = Date.UTC(
      Number(todayEt.slice(0, 4)),
      Number(todayEt.slice(5, 7)) - 1,
      Number(todayEt.slice(8, 10)),
    );
    const diffDays = Math.round((stopDay - todayDay) / MS_PER_DAY);
    const ok = diffDays > 0 && diffDays <= 60;
    push(
      "time_stop",
      ok,
      `time stop ${intent.timeStopDate} is ${diffDays}d after today ${todayEt} ` +
        `(must be after today and within 60 calendar days)`,
    );
  }

  // 20. earnings_blackout: no entries shortly before a scheduled report. Exits allowed.
  if (!isEntry) {
    push("earnings_blackout", true, "exit; the earnings blackout does not apply");
  } else if (risk.earningsBlackoutDays <= 0) {
    push("earnings_blackout", true, "earnings blackout is disabled (0d)");
  } else if (!marketDataAvailable) {
    push(
      "earnings_blackout",
      false,
      `market data was unavailable; cannot check the earnings blackout for ${intent.symbol}`,
    );
  } else if (nextEarningsDate === undefined) {
    push(
      "earnings_blackout",
      true,
      `no earnings scheduled for ${intent.symbol} in the next 30 days ` +
        `(blackout ${risk.earningsBlackoutDays}d)`,
    );
  } else if (nextEarningsDate < todayEt) {
    push(
      "earnings_blackout",
      true,
      `${intent.symbol} earnings on ${nextEarningsDate} already passed (today ${todayEt})`,
    );
  } else {
    const daysToEarnings =
      nextEarningsDate === todayEt ? 0 : tradingDaysBetween(todayEt, nextEarningsDate) + 1;
    push(
      "earnings_blackout",
      daysToEarnings > risk.earningsBlackoutDays,
      daysToEarnings <= risk.earningsBlackoutDays
        ? `entry blocked: ${intent.symbol} reports earnings on ${nextEarningsDate} ` +
            `(${daysToEarnings} trading days away; blackout ${risk.earningsBlackoutDays}d)`
        : `${intent.symbol} earnings on ${nextEarningsDate} ` +
            `(${daysToEarnings} trading days away; blackout ${risk.earningsBlackoutDays}d)`,
    );
  }

  // 21. liquidity: entries need enough average dollar volume. Exits allowed.
  if (!isEntry) {
    push("liquidity", true, "exit; the liquidity floor does not apply");
  } else if (risk.minAvgDollarVolumeUsd <= 0) {
    push("liquidity", true, "liquidity floor is disabled ($0)");
  } else if (!marketDataAvailable) {
    push(
      "liquidity",
      false,
      `market data was unavailable; cannot check the liquidity floor for ${intent.symbol}`,
    );
  } else if (avgDollarVolume20 === undefined) {
    push(
      "liquidity",
      true,
      `no average dollar volume known for ${intent.symbol}; ` +
        `skipping the $${risk.minAvgDollarVolumeUsd} floor`,
    );
  } else {
    push(
      "liquidity",
      avgDollarVolume20 >= risk.minAvgDollarVolumeUsd,
      `20-session average dollar volume $${avgDollarVolume20} vs floor $${risk.minAvgDollarVolumeUsd}`,
    );
  }

  let maxQuantity: number | undefined;
  if (isEntry) {
    const candidates = [riskQty, positionQty, capQty].filter(
      (q): q is number => q !== undefined && Number.isFinite(q),
    );
    if (candidates.length > 0) {
      maxQuantity = Math.max(0, Math.floor(Math.min(...candidates)));
    }
  }

  return {
    approved: checks.every((c) => c.ok),
    isExit,
    checks,
    ...(maxQuantity === undefined ? {} : { maxQuantity }),
    quote,
  };
}
