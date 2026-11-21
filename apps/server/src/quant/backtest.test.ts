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

  it("includes a final-session entry that reaches the end without hitting a stop or target", () => {
    const bars = mkBars([...new Array(20).fill(100), 102, 102], {
      opens: [...new Array(21).fill(100), 101],
      lows: [...new Array(21).fill(99.5), 100.5],
    });
    const result = runBacktest(new Map([["AAA", bars]]), {
      entry: "breakout_20d", exit: EXIT, years: 3, costBps: 10,
    });
    assert.equal(result.pooled.trades, 1);
    const trade = result.pooled.lastTrades[0];
    assert.equal(trade?.entryDate, "2024-01-22");
    assert.equal(trade?.exitDate, "2024-01-22");
    assert.equal(trade?.exitReason, "end");
    assert.equal(trade?.holdingDays, 1);
    assert.equal(trade?.returnPct, (102 * 0.999) / (101 * 1.001) - 1);
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
    // One losing close still draws down from the zero starting point.
    assert.equal(result.pooled.trades, 1);
    assert.equal(result.pooled.maxDrawdownR, trade.pnlR);
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

describe("daily trailing stops", () => {
  it("does not use a session's eventual high to stop at that session's earlier open", () => {
    const bars = mkBars([...new Array(20).fill(100), 102, 111, 99], {
      opens: [...new Array(20).fill(100), 102, 102, 99],
      highs: [...new Array(20).fill(100.5), 102.5, 112, 100],
      lows: [...new Array(20).fill(99.5), 101.5, 101, 98],
    });
    const result = runBacktest(new Map([["AAA", bars]]), {
      entry: "breakout_20d", exit: { stopAtr: 5, trailAtr: 2, timeStopDays: 20 }, years: 1, costBps: 0,
    });
    const trade = result.symbols[0]?.lastTrades[0];
    assert.equal(result.symbols[0]?.trades, 1);
    assert.ok(trade);
    assert.equal(trade.entryPrice, 102);
    assert.equal(trade.exitDate, "2024-01-23");
    assert.equal(trade.exitPrice, 99);
    assert.equal(trade.exitReason, "trail");
    assert.ok(trade.pnlR < 0);
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

  it("drawdown_uses_one_net_total_for_same_day_exits_whatever_the_symbol_order", () => {
    const signal = [...new Array(20).fill(100), 102];
    // Both fill at 101 on the signal's next open and time-stop at that same day's close.
    const winner = mkBars([...signal, 102], { opens: [...new Array(21).fill(100), 101] });
    const loser = mkBars([...signal, 99.5], {
      opens: [...new Array(21).fill(100), 101],
      highs: [...new Array(20).fill(100.5), 102.5, 101.5],
      lows: [...new Array(20).fill(99.5), 101.5, 99.1],
    });
    const run = (entries: Map<string, Bar[]>) =>
      runBacktest(entries, {
        entry: "breakout_20d",
        exit: { stopAtr: 2, timeStopDays: 1 },
        years: 3,
        costBps: 0,
      });

    const forward = run(new Map([["WIN", winner], ["LOSS", loser]]));
    const reverse = run(new Map([["LOSS", loser], ["WIN", winner]]));

    assert.equal(forward.pooled.trades, 2);
    for (const trade of forward.pooled.lastTrades) {
      assert.equal(trade.exitDate, "2024-01-22");
      assert.equal(trade.exitReason, "time");
    }
    const winR = forward.pooled.lastTrades.find((t) => t.symbol === "WIN")?.pnlR;
    const lossR = forward.pooled.lastTrades.find((t) => t.symbol === "LOSS")?.pnlR;
    assert.ok(winR !== undefined);
    assert.ok(lossR !== undefined);
    assert.ok(winR > 0 && lossR < 0, `expected one winner and one loser, got ${winR} and ${lossR}`);
    const dayR = winR + lossR;
    assert.ok(dayR < 0, `expected the day to net a loss, got ${dayR}R`);
    // Both close on the same date, so the trough is that day's net loss,
    // not the first trade's excursion nor a function of insertion order.
    assert.equal(forward.pooled.maxDrawdownR, dayR);
    assert.equal(reverse.pooled.maxDrawdownR, dayR);
  });
});

describe("large open-gap warning", () => {
  it("flags a 50% gap without changing the trade outcome and keeps the small-sample caveat", () => {
    const flat = new Array(20).fill(100);
    const gapped = mkBars([...flat, 102, 100, 50], {
      opens: [...new Array(20).fill(100), 100, 101, 50],
      highs: [...new Array(20).fill(100.5), 102.5, 101.5, 50.5],
      lows: [...new Array(20).fill(99.5), 101.5, 99.5, 49.5],
    });
    const control = mkBars([...flat, 102, 101, 101, 101]);
    const result = runBacktest(
      new Map([
        ["AAA", gapped],
        ["BBB", control],
      ]),
      { entry: "breakout_20d", exit: EXIT, years: 3, costBps: 0 },
    );
    const warning = result.pooled.warning ?? "";
    // The small-sample caveat survives the appended data-quality note.
    assert.ok(warning.includes("suggestive"), warning);
    assert.ok(warning.includes("at least 35%"), warning);
    assert.ok(warning.includes("AAA 2024-01-23 -50%"), warning);
    assert.ok(warning.includes("corporate actions"), warning);
    assert.ok(warning.includes("independently verified"), warning);
    // The normal control has no gap, so it is not named.
    assert.ok(!warning.includes("BBB"), warning);
    // The raw gap still drives the stop fill and the buy-and-hold return.
    const aaa = result.symbols.find((s) => s.symbol === "AAA");
    assert.ok(aaa);
    const trade = aaa.lastTrades[0];
    assert.ok(trade);
    assert.equal(trade.exitReason, "stop");
    assert.equal(trade.exitPrice, 50);
    assert.ok(trade.pnlR < -20, `expected the raw gap loss, got ${trade.pnlR}R`);
    assert.ok(aaa.buyHoldReturn !== undefined && Math.abs(aaa.buyHoldReturn + 0.5) < 1e-9);
  });

  it("caps examples at three, counts the rest, and ignores invalid prices", () => {
    const flat = new Array(20).fill(100);
    const upGap = (open: number) => mkBars([...flat, 150], { opens: [...flat, open] });
    const result = runBacktest(
      new Map([
        ["A1", upGap(150)],
        ["A2", upGap(150)],
        ["A3", upGap(150)],
        ["A4", upGap(150)],
        ["BAD", upGap(0)],
      ]),
      { entry: "breakout_20d", exit: EXIT, years: 3, costBps: 0 },
    );
    const warning = result.pooled.warning ?? "";
    assert.equal(warning.split("2024-01-21").length - 1, 3);
    assert.ok(warning.includes("1 more omitted"), warning);
    assert.ok(!warning.includes("A4"), warning);
    assert.ok(!warning.includes("BAD"), warning);
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
