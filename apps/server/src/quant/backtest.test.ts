import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "@rh/shared";
import { runBacktest, type BacktestExit } from "./backtest.ts";

function mkBars(closes: number[], opts?: { opens?: number[]; highs?: number[]; lows?: number[] }): Bar[] {
  return closes.map((close, i) => {
    const date = `2024-01-${String(i + 1).padStart(2, "0")}`;
    return {
      date,
      open: opts?.opens?.[i] ?? close,
      high: opts?.highs?.[i] ?? close + 0.5,
      low: opts?.lows?.[i] ?? close - 0.5,
      close,
      volume: 1_000_000,
    };
  });
}

const EXIT: BacktestExit = { stopAtr: 2, timeStopDays: 20 };

describe("breakout_20d", () => {
  it("fills_at_the_next_open_with_no_look_ahead", () => {
    const flat = new Array(20).fill(100);
    const bars = mkBars([...flat, 102, 101, 101, 101, 101]);
    const result = runBacktest(new Map([["AAA", bars]]), { entry: "breakout_20d", exit: EXIT, years: 3, costBps: 0 });
    assert.equal(result.symbols[0]?.trades, 1);
    const trade = result.symbols[0]?.lastTrades[0];
    assert.ok(trade);
    // Signal on bar 20 (close 102 breaks the 100.5 highs); fill at bar 21's open.
    assert.equal(trade.entryDate, "2024-01-22");
    assert.equal(trade.entryPrice, 101);
    assert.equal(trade.exitReason, "end");
  });

  it("fills_a_gap_through_the_stop_at_the_open", () => {
    const flat = new Array(20).fill(100);
    const bars = mkBars([...flat, 102, 101, 98, 98, 98], {
      opens: [...new Array(21).fill(100), 101, 98, 98, 98, 98],
      lows: [...new Array(21).fill(99.5), 100.5, 97, 97, 97, 97],
    });
    const result = runBacktest(new Map([["AAA", bars]]), { entry: "breakout_20d", exit: EXIT, years: 3, costBps: 0 });
    const trade = result.symbols[0]?.lastTrades[0];
    assert.ok(trade);
    assert.equal(trade.exitReason, "stop");
    assert.equal(trade.exitPrice, 98);
    assert.ok(trade.pnlR < 0);
  });

  it("exits_a_failed_breakout_at_the_time_stop_close", () => {
    const flat = new Array(20).fill(100);
    const bars = mkBars([...flat, 102, 101, 101, 101, 100.5, 100.5]);
    const exit: BacktestExit = { stopAtr: 10, timeStopDays: 3 };
    const result = runBacktest(new Map([["AAA", bars]]), { entry: "breakout_20d", exit, years: 3, costBps: 0 });
    const trade = result.symbols[0]?.lastTrades[0];
    assert.ok(trade);
    assert.equal(trade.exitReason, "time");
    assert.equal(trade.holdingDays, 3);
    // Third session after entry (bar 23) closes at 101.
    assert.equal(trade.exitPrice, 101);
  });

  it("hits_the_profit_target_intrabar", () => {
    const flat = new Array(20).fill(100);
    const bars = mkBars([...flat, 102, 101, 103, 110], {
      opens: [...new Array(21).fill(100), 101, 102, 103, 110],
      highs: [...new Array(22).fill(100.5), 112, 112],
    });
    const exit: BacktestExit = { stopAtr: 2, targetR: 1, timeStopDays: 20 };
    const result = runBacktest(new Map([["AAA", bars]]), { entry: "breakout_20d", exit, years: 3, costBps: 0 });
    const trade = result.symbols[0]?.lastTrades[0];
    assert.ok(trade);
    assert.equal(trade.exitReason, "target");
    assert.ok(trade.pnlR > 0.9 && trade.pnlR < 1.1, `expected ~1R, got ${trade.pnlR}`);
  });
});

describe("costs_and_r_accounting", () => {
  it("subtracts_costs_per_side_from_pnl_and_returns", () => {
    const flat = new Array(20).fill(100);
    const bars = mkBars([...flat, 102, 101, 105, 105]);
    const exit: BacktestExit = { stopAtr: 100, timeStopDays: 2 };
    const free = runBacktest(new Map([["AAA", bars]]), { entry: "breakout_20d", exit, years: 3, costBps: 0 });
    const paid = runBacktest(new Map([["AAA", bars]]), { entry: "breakout_20d", exit, years: 3, costBps: 50 });
    const t0 = free.symbols[0]?.lastTrades[0];
    const t1 = paid.symbols[0]?.lastTrades[0];
    assert.ok(t0 && t1);
    assert.ok(t1.returnPct < t0.returnPct);
    assert.ok(t1.pnlR < t0.pnlR);
    // 50bps per side on ~101 in and ~105 out.
    const expected = (105 * 0.995) / (101 * 1.005) - 1;
    assert.ok(Math.abs(t1.returnPct - expected) < 1e-9, `got ${t1.returnPct}, want ${expected}`);
  });
});

describe("pooled_stats", () => {
  it("pools_trades_warns_under_30_and_reports_buy_hold", () => {
    const flat = new Array(20).fill(100);
    const up = mkBars([...flat, 102, 101, 105, 105]);
    const down = mkBars([...flat, 102, 101, 95, 95], {
      opens: [...new Array(21).fill(100), 101, 95, 95, 95],
      lows: [...new Array(21).fill(99.5), 100.5, 94, 94, 94],
    });
    const result = runBacktest(
      new Map([
        ["AAA", up],
        ["BBB", down],
      ]),
      { entry: "breakout_20d", exit: { stopAtr: 2, timeStopDays: 20 }, years: 3, costBps: 0 },
    );
    assert.equal(result.pooled.trades, 2);
    assert.equal(result.pooled.wins, 1);
    assert.equal(result.pooled.winRate, 0.5);
    assert.ok((result.pooled.warning ?? "").includes("suggestive"));
    assert.equal(result.pooled.lastTrades.length, 2);
    assert.ok(result.pooled.maxDrawdownR !== undefined && result.pooled.maxDrawdownR <= 0);
    assert.ok(result.pooled.buyHoldReturn !== undefined);
    assert.ok(result.symbols.every((s) => s.lastTrades.length <= 5));
  });
});

describe("rsi2_mean_reversion", () => {
  it("enters_on_a_washout_and_exits_at_the_time_stop", () => {
    const closes = [...Array.from({ length: 30 }, (_, i) => 100 + i * 0.2), 100, 94, 95, 96];
    const bars = mkBars(closes);
    const result = runBacktest(new Map([["AAA", bars]]), {
      entry: "rsi2_mean_reversion",
      exit: { stopAtr: 2, timeStopDays: 2 },
      years: 3,
      costBps: 0,
    });
    assert.ok((result.symbols[0]?.trades ?? 0) >= 1);
  });
});
