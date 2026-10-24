import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type OrderRecord } from "@rh/shared";
import { evaluate, type RiskInput } from "./engine.ts";
import { createNyseCalendar } from "./calendar.ts";

const calendar = createNyseCalendar();
/** Monday 2026-11-02 10:05 ET, 35 minutes into the regular session. */
const NOW = Date.UTC(2026, 10, 2, 15, 5, 0);
const TODAY = "2026-11-02";

let orderSeq = 0;
function submittedBuy(symbol: string, createdAt: number, invalidationPrice = 140): OrderRecord {
  orderSeq += 1;
  return {
    id: `o${orderSeq}`,
    createdAt,
    updatedAt: createdAt,
    intent: {
      symbol,
      side: "buy",
      quantity: 10,
      orderType: "limit",
      limitPrice: 150,
      timeInForce: "day",
      invalidationPrice,
      timeStopDate: "2026-12-02",
      thesis: "breakout above resistance on strong volume",
      probabilityWin: 0.6,
      expectedGainPct: 10,
      expectedLossPct: 5,
      estimatedCostPct: 0.5,
      evidence: ["robinhood quote showed tight spread this morning"],
    },
    verdict: { approved: true, isExit: false, checks: [] },
    status: "submitted",
  };
}

function submittedSell(symbol: string, createdAt: number): OrderRecord {
  const buy = submittedBuy(symbol, createdAt);
  return { ...buy, id: `s${buy.id}`, intent: { ...buy.intent, side: "sell" } };
}

/** A base input that passes every rule: change one thing per test. */
function passingInput(): RiskInput {
  return {
    intent: {
      symbol: "AAPL",
      side: "buy",
      quantity: 1,
      orderType: "limit",
      limitPrice: 150,
      timeInForce: "day",
      invalidationPrice: 140,
      timeStopDate: "2026-12-02",
      thesis: "breakout above resistance on strong volume",
      probabilityWin: 0.6,
      expectedGainPct: 10,
      expectedLossPct: 5,
      estimatedCostPct: 0.5,
      evidence: ["robinhood quote showed tight spread this morning"],
    },
    settings: structuredClone(DEFAULT_SETTINGS),
    account: {
      at: NOW,
      equity: 1200,
      cash: 1200,
      buyingPower: 1200,
      settledCash: 1200,
      positions: [
        {
          symbol: "AAPL",
          quantity: 1,
          averageCost: 145,
          marketValue: 150,
          unrealizedPnl: 5,
          sector: "Technology",
        },
      ],
    },
    quote: { symbol: "AAPL", bid: 149.95, ask: 150.05, last: 150, at: NOW },
    market: {
      now: NOW,
      session: "regular",
      isOpen: true,
      tradingDay: TODAY,
      nextOpen: NOW - 35 * 60_000,
      nextClose: NOW + 5 * 3_600_000,
      earlyClose: false,
    },
    equityMarks: { dayStart: 1190, monthPeak: 1250 },
    recentOrders: [],
    lotOpenedEtDate: undefined,
    nextEarningsDate: undefined,
    avgDollarVolume20: 50_000_000,
    marketDataAvailable: true,
    sectorOf: (symbol: string) => (symbol === "AAPL" || symbol === "MSFT" ? "Technology" : undefined),
    tradingDaysBetween: (a: string, b: string) => calendar.tradingDaysBetween(a, b),
    now: NOW,
  };
}

function failedRules(input: RiskInput): string[] {
  return evaluate(input).checks.filter((c) => !c.ok).map((c) => c.rule);
}

describe("risk engine", () => {
  it("approves a well-formed entry with maxQuantity from the tightest sizing rule", () => {
    const verdict = evaluate(passingInput());
    assert.equal(verdict.approved, true);
    assert.equal(verdict.isExit, false);
    assert.equal(verdict.checks.length, 23);
    // Risk allows 1.8, notional 3.3333, position (360-150)/150 = 1.4.
    assert.equal(verdict.maxQuantity, 1.4);
  });

  it("sizes fractional shares to 4 decimal places", () => {
    const input = passingInput();
    input.intent = { ...input.intent, quantity: 3.7894, limitPrice: 100, invalidationPrice: 98 };
    input.quote = { ...input.quote, bid: 99.95, ask: 100.05, last: 100 };
    input.settings.risk.maxPositionPct = 100;
    input.settings.risk.maxOrderNotionalUsd = 378.945;
    const verdict = evaluate(input);
    assert.equal(verdict.approved, true);
    // Notional cap binds: floor(378.945 / 100) to 4 decimals.
    assert.equal(verdict.maxQuantity, 3.7894);
  });

  it("kill_switch blocks every order", () => {
    const input = passingInput();
    input.settings.killSwitch = true;
    assert.deepEqual(failedRules(input), ["kill_switch"]);
  });

  it("mode off blocks every order", () => {
    const input = passingInput();
    input.settings.mode = "off";
    assert.deepEqual(failedRules(input), ["mode"]);
  });

  it("market_hours blocks orders when the session is closed", () => {
    const input = passingInput();
    input.market = { ...input.market, session: "post", isOpen: false };
    assert.deepEqual(failedRules(input), ["market_hours"]);
  });

  it("entry_window blocks entries in the first minutes after the open", () => {
    const input = passingInput();
    input.market = { ...input.market, nextOpen: NOW - 5 * 60_000 };
    assert.deepEqual(failedRules(input), ["entry_window"]);
  });

  it("entry_window blocks entries in the last minutes before the close", () => {
    const input = passingInput();
    input.market = { ...input.market, nextClose: NOW + 5 * 60_000 };
    assert.deepEqual(failedRules(input), ["entry_window"]);
  });

  it("quote_fresh blocks orders on a stale quote", () => {
    const input = passingInput();
    input.quote = { ...input.quote, at: NOW - 120_000 };
    assert.deepEqual(failedRules(input), ["quote_fresh"]);
  });

  it("quote_fresh blocks orders on a crossed quote", () => {
    const input = passingInput();
    input.quote = { ...input.quote, bid: 150.1, ask: 150.05 };
    assert.deepEqual(failedRules(input), ["quote_fresh"]);
  });

  it("spread blocks entries wider than the cap", () => {
    const input = passingInput();
    input.quote = { ...input.quote, bid: 149, ask: 151, last: 150 };
    input.intent = { ...input.intent, expectedGainPct: 20, estimatedCostPct: 2 };
    assert.deepEqual(failedRules(input), ["spread"]);
  });

  it("limit_vs_mid blocks a buy limit above the slippage ceiling", () => {
    const input = passingInput();
    input.intent = { ...input.intent, limitPrice: 160, invalidationPrice: 150 };
    assert.deepEqual(failedRules(input), ["limit_vs_mid"]);
  });

  it("limit_vs_mid requires a stop price on stop_limit orders", () => {
    const input = passingInput();
    input.intent = { ...input.intent, orderType: "stop_limit" };
    assert.deepEqual(failedRules(input), ["limit_vs_mid"]);
  });

  it("limit_vs_mid blocks a buy stop below the current price", () => {
    const input = passingInput();
    input.intent = { ...input.intent, orderType: "stop_limit", stopPrice: 149 };
    assert.deepEqual(failedRules(input), ["limit_vs_mid"]);
  });

  it("no_short rejects a sell larger than the held long", () => {
    const input = passingInput();
    input.account = { ...input.account, positions: [] };
    input.intent = { ...input.intent, side: "sell", quantity: 1, invalidationPrice: 160 };
    assert.deepEqual(failedRules(input), ["no_short"]);
  });

  it("daily_loss blocks entries below the day-start floor", () => {
    const input = passingInput();
    input.account = { ...input.account, equity: 1152 };
    assert.deepEqual(failedRules(input), ["daily_loss"]);
  });

  it("daily_loss still allows an exit", () => {
    const input = passingInput();
    input.account = { ...input.account, equity: 1152 };
    input.intent = { ...input.intent, side: "sell", quantity: 1, timeStopDate: TODAY };
    const verdict = evaluate(input);
    assert.equal(verdict.approved, true);
    assert.equal(verdict.isExit, true);
  });

  it("drawdown blocks entries below the month-peak floor", () => {
    const input = passingInput();
    input.account = { ...input.account, equity: 1145 };
    input.equityMarks = { dayStart: 1150, monthPeak: 1250 };
    assert.deepEqual(failedRules(input), ["drawdown"]);
  });

  it("drawdown blocks entries while the breaker latch is set", () => {
    const input = passingInput();
    input.settings.drawdownHalted = true;
    assert.deepEqual(failedRules(input), ["drawdown"]);
  });

  it("risk_per_trade blocks entries risking too much to invalidation", () => {
    const input = passingInput();
    input.intent = { ...input.intent, quantity: 1, invalidationPrice: 80 };
    assert.deepEqual(failedRules(input), ["risk_per_trade"]);
  });

  it("risk_per_trade requires invalidation below the limit for a buy", () => {
    const input = passingInput();
    input.intent = { ...input.intent, invalidationPrice: 160 };
    assert.deepEqual(failedRules(input), ["risk_per_trade"]);
  });

  it("position_size blocks entries that would over-concentrate one symbol", () => {
    const input = passingInput();
    input.account = {
      ...input.account,
      positions: [
        { symbol: "AAPL", quantity: 2, averageCost: 145, marketValue: 300, unrealizedPnl: 10, sector: "Technology" },
      ],
    };
    assert.deepEqual(failedRules(input), ["position_size"]);
  });

  it("sector blocks entries that would over-concentrate one sector", () => {
    const input = passingInput();
    input.account = {
      ...input.account,
      positions: [
        { symbol: "AAPL", quantity: 1, averageCost: 145, marketValue: 150, unrealizedPnl: 5, sector: "Technology" },
        { symbol: "MSFT", quantity: 4, averageCost: 148, marketValue: 600, unrealizedPnl: 8, sector: "Technology" },
      ],
    };
    assert.deepEqual(failedRules(input), ["sector"]);
  });

  it("notional_cap blocks a sell above the fat-finger cap", () => {
    const input = passingInput();
    input.account = {
      ...input.account,
      positions: [
        { symbol: "AAPL", quantity: 10, averageCost: 145, marketValue: 1500, unrealizedPnl: 50, sector: "Technology" },
      ],
    };
    input.intent = { ...input.intent, side: "sell", quantity: 4, invalidationPrice: 160 };
    assert.deepEqual(failedRules(input), ["notional_cap"]);
  });

  it("notional_cap blocks buys above buying power", () => {
    const input = passingInput();
    input.account = { ...input.account, buyingPower: 100 };
    assert.deepEqual(failedRules(input), ["notional_cap"]);
  });

  it("min_notional blocks an entry below the minimum notional", () => {
    const input = passingInput();
    input.intent = { ...input.intent, quantity: 0.03, limitPrice: 100, invalidationPrice: 98 };
    input.quote = { ...input.quote, bid: 99.95, ask: 100.05, last: 100 };
    assert.deepEqual(failedRules(input), ["min_notional"]);
  });

  it("min_notional allows a full exit below the minimum notional", () => {
    const input = passingInput();
    input.account = {
      ...input.account,
      positions: [
        { symbol: "AAPL", quantity: 0.03, averageCost: 99, marketValue: 3, unrealizedPnl: 0, sector: "Technology" },
      ],
    };
    input.intent = { ...input.intent, side: "sell", quantity: 0.03, limitPrice: 100, invalidationPrice: 102 };
    input.quote = { ...input.quote, bid: 99.95, ask: 100.05, last: 100 };
    assert.deepEqual(failedRules(input), []);
  });

  it("min_notional blocks a partial exit below the minimum notional", () => {
    const input = passingInput();
    input.account = {
      ...input.account,
      positions: [
        { symbol: "AAPL", quantity: 10, averageCost: 99, marketValue: 1000, unrealizedPnl: 10, sector: "Technology" },
      ],
    };
    input.intent = { ...input.intent, side: "sell", quantity: 0.03, limitPrice: 100, invalidationPrice: 102 };
    input.quote = { ...input.quote, bid: 99.95, ask: 100.05, last: 100 };
    assert.deepEqual(failedRules(input), ["min_notional"]);
  });

  it("max_positions blocks a new symbol when full", () => {
    const input = passingInput();
    input.account = {
      ...input.account,
      positions: ["A", "B", "C", "D", "E"].map((symbol) => ({
        symbol,
        quantity: 10,
        averageCost: 10,
        marketValue: 100,
        unrealizedPnl: 0,
      })),
    };
    assert.deepEqual(failedRules(input), ["max_positions"]);
  });

  it("entries_per_day blocks the third submitted buy of the day", () => {
    const input = passingInput();
    input.recentOrders = [submittedBuy("AAPL", NOW - 3_600_000), submittedBuy("MSFT", NOW - 7_200_000)];
    assert.deepEqual(failedRules(input), ["entries_per_day"]);
  });

  it("min_hold blocks exits of lots opened today", () => {
    const input = passingInput();
    input.intent = { ...input.intent, side: "sell", quantity: 1 };
    input.lotOpenedEtDate = TODAY;
    assert.deepEqual(failedRules(input), ["min_hold"]);
  });

  it("min_hold allows a stop exit at or below the entry invalidation", () => {
    const input = passingInput();
    input.intent = { ...input.intent, side: "sell", quantity: 1 };
    input.lotOpenedEtDate = TODAY;
    input.recentOrders = [submittedBuy("AAPL", NOW - 3_600_000, 155)];
    input.quote = { ...input.quote, last: 150 };
    assert.deepEqual(failedRules(input), []);
  });

  it("day_trades blocks a same-day round trip at the limit, even as a stop", () => {
    const input = passingInput();
    input.intent = { ...input.intent, side: "sell", quantity: 1 };
    input.lotOpenedEtDate = TODAY;
    input.quote = { ...input.quote, last: 150 };
    const oct28 = Date.UTC(2026, 9, 28, 14, 0, 0);
    const oct29 = Date.UTC(2026, 9, 29, 14, 0, 0);
    const oct30 = Date.UTC(2026, 9, 30, 14, 0, 0);
    input.recentOrders = [
      submittedBuy("AAPL", NOW - 3_600_000, 155),
      submittedBuy("AAPL", oct28, 155),
      submittedSell("AAPL", oct28 + 3_600_000),
      submittedBuy("AAPL", oct29, 155),
      submittedSell("AAPL", oct29 + 3_600_000),
      submittedBuy("AAPL", oct30, 155),
      submittedSell("AAPL", oct30 + 3_600_000),
    ];
    assert.deepEqual(failedRules(input), ["day_trades"]);
  });

  it("ev_after_costs blocks entries whose edge cannot cover costs", () => {
    const input = passingInput();
    input.intent = { ...input.intent, probabilityWin: 0.1, expectedGainPct: 2 };
    assert.deepEqual(failedRules(input), ["ev_after_costs"]);
  });

  it("ev_after_costs blocks entries whose costs are below the spread", () => {
    const input = passingInput();
    input.intent = { ...input.intent, estimatedCostPct: 0.01 };
    assert.deepEqual(failedRules(input), ["ev_after_costs"]);
  });

  it("time_stop blocks a stop that is not after today", () => {
    const input = passingInput();
    input.intent = { ...input.intent, timeStopDate: TODAY };
    assert.deepEqual(failedRules(input), ["time_stop"]);
  });

  it("time_stop blocks a stop more than 60 days out", () => {
    const input = passingInput();
    input.intent = { ...input.intent, timeStopDate: "2027-02-15" };
    assert.deepEqual(failedRules(input), ["time_stop"]);
  });

  it("earnings_blackout blocks an entry three trading days before earnings", () => {
    const input = passingInput();
    input.nextEarningsDate = "2026-11-05";
    assert.deepEqual(failedRules(input), ["earnings_blackout"]);
  });

  it("earnings_blackout passes when earnings are ten trading days out", () => {
    const input = passingInput();
    input.nextEarningsDate = "2026-11-16";
    assert.deepEqual(failedRules(input), []);
  });

  it("liquidity blocks a buy below the dollar-volume floor", () => {
    const input = passingInput();
    input.avgDollarVolume20 = 1_000_000;
    assert.deepEqual(failedRules(input), ["liquidity"]);
  });

  it("an exit passes during an earnings blackout", () => {
    const input = passingInput();
    input.intent = { ...input.intent, side: "sell", quantity: 1 };
    input.nextEarningsDate = "2026-11-05";
    input.avgDollarVolume20 = 1_000_000;
    assert.deepEqual(failedRules(input), []);
  });

  it("liquidity fails when the average volume cannot be computed", () => {
    const input = passingInput();
    input.avgDollarVolume20 = undefined;
    const verdict = evaluate(input);
    assert.deepEqual(failedRules(input), ["liquidity"]);
    assert.match(
      verdict.checks.find((c) => c.rule === "liquidity")?.detail ?? "",
      /could not be computed/,
    );
  });

  it("an entry fails both rules when market data is unavailable", () => {
    const input = passingInput();
    input.marketDataAvailable = false;
    assert.deepEqual(failedRules(input), ["earnings_blackout", "liquidity"]);
  });
});
