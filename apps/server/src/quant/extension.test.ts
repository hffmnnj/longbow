import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { DEFAULT_RISK, type AccountSnapshot, type Bar, type RiskConfig } from "@rh/shared";
import type { MarketData } from "../ports.ts";
import { createQuantExtension, type QuantDeps } from "./extension.ts";
import { DEFAULT_UNIVERSE } from "./universe.ts";

const API = undefined as unknown as ToolExecutionApi;
const CTX = undefined as unknown as Context;

function bars(n: number, from: number, step: number, jitter = 0.4): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = from + i * step + (i % 2 === 0 ? jitter : -jitter);
    return {
      date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      open: close,
      high: close + 0.6,
      low: close - 0.6,
      close,
      volume: 2_000_000,
    };
  });
}

function fakeMarket(): MarketData {
  return {
    history: async (symbol) => ({ symbol, bars: bars(300, 100, 0.25), source: "fake", asOf: 0 }),
    nextEarnings: async () => undefined,
    avgDollarVolume: async () => 50_000_000,
  };
}

function deps(over: Partial<QuantDeps> = {}): QuantDeps {
  const account: AccountSnapshot = {
    at: 0,
    equity: 10_000,
    cash: 4000,
    buyingPower: 6000,
    positions: [
      { symbol: "NVDA", quantity: 10, averageCost: 100, marketValue: 3000, unrealizedPnl: 2000 },
      { symbol: "AAPL", quantity: 10, averageCost: 100, marketValue: 2000, unrealizedPnl: 1000 },
    ],
  };
  return {
    market: fakeMarket(),
    getAccount: async () => account,
    getRisk: () => structuredClone(DEFAULT_RISK) as RiskConfig,
    universe: () => ["NVDA", "AAPL", "MSFT"],
    sectorOf: (s) => (s === "NVDA" ? "Technology" : s === "AAPL" ? "Technology" : undefined),
    benchmark: () => "SPY",
    clock: { now: () => 0 },
    log: { info: () => {}, warn: () => {}, error: () => {}, child: () => ({ info: () => {}, warn: () => {}, error: () => {}, child: () => undefined as never }) as never },
    ...over,
  };
}

function textOf(result: { output?: readonly unknown[] }): string {
  return ((result.output ?? []) as { type: string; text?: string }[])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

describe("quant extension", () => {
  it("exposes_the_four_read_only_tools", () => {
    const ext = createQuantExtension(deps());
    assert.equal(ext.name, "quant");
    assert.deepEqual(
      ext.tools?.map((t) => t.name).sort(),
      ["market_screen", "portfolio_risk", "quant_backtest", "size_position"],
    );
    for (const tool of ext.tools ?? []) assert.equal(tool.replay, "safe");
  });

  it("universe_covers_sectors_and_index_etfs", () => {
    assert.ok(DEFAULT_UNIVERSE.length >= 60);
    for (const etf of ["XLK", "XLV", "XLF", "XLY", "XLP", "XLE", "XLI", "XLB", "XLU", "XLRE", "XLC", "SPY", "QQQ", "IWM", "DIA"]) {
      assert.ok(DEFAULT_UNIVERSE.includes(etf), `missing ${etf}`);
    }
  });

  it("market_screen_returns_ranked_rows", async () => {
    const ext = createQuantExtension(deps());
    const tool = ext.tools?.find((t) => t.name === "market_screen");
    assert.ok(tool);
    const result = await tool.execute({ preset: "trend_template", symbols: ["NVDA", "AAPL"] }, API, CTX);
    const structured = (result as { structuredOutput: { rows: { symbol: string; sector?: string }[] } }).structuredOutput;
    assert.ok(structured.rows.length > 0);
    assert.equal(structured.rows[0]?.sector, "Technology");
    assert.match(textOf(result), /trend_template/);
  });

  it("quant_backtest_reports_pooled_stats_and_a_warning", async () => {
    const ext = createQuantExtension(deps());
    const tool = ext.tools?.find((t) => t.name === "quant_backtest");
    assert.ok(tool);
    const result = await tool.execute(
      { symbols: ["SPY", "QQQ", "NVDA"], entry: "breakout_20d", years: 3 },
      API,
      CTX,
    );
    const structured = (result as { structuredOutput: { pooled: { trades: number; warning?: string } } }).structuredOutput;
    assert.ok(structured.pooled.trades >= 0);
    assert.match(textOf(result), /breakout_20d/);
  });

  it("portfolio_risk_reports_beta_var_and_candidate_deltas", async () => {
    const ext = createQuantExtension(deps());
    const tool = ext.tools?.find((t) => t.name === "portfolio_risk");
    assert.ok(tool);
    const result = await tool.execute({ candidate: { symbol: "MSFT", notional: 200 } }, API, CTX);
    const structured = (result as { structuredOutput: { beta: number | null; candidate?: { symbol: string } } }).structuredOutput;
    assert.ok(structured.beta !== null);
    assert.equal(structured.candidate?.symbol, "MSFT");
    assert.match(textOf(result), /VaR/);
  });

  it("portfolio_risk_is_plain_without_an_account", async () => {
    const ext = createQuantExtension(deps({ getAccount: async () => null }));
    const tool = ext.tools?.find((t) => t.name === "portfolio_risk");
    assert.ok(tool);
    const result = await tool.execute({ candidate: { symbol: "MSFT", notional: 200 } }, API, CTX);
    assert.match(textOf(result), /No account snapshot/);
  });

  it("size_position_sizes_and_names_the_binding_cap", async () => {
    const ext = createQuantExtension(deps());
    const tool = ext.tools?.find((t) => t.name === "size_position");
    assert.ok(tool);
    const result = await tool.execute({ symbol: "MSFT", entry: 200 }, API, CTX);
    const structured = (result as { structuredOutput: { quantity: number; boundBy: string; checks: { rule: string; ok: boolean }[] } }).structuredOutput;
    assert.ok(structured.quantity > 0);
    assert.ok(structured.boundBy.length > 0);
    assert.ok(structured.checks.some((c) => c.rule === "risk_per_trade"));
    assert.match(textOf(result), /MSFT/);
  });

  it("size_position_rejects_a_bad_stop", async () => {
    const ext = createQuantExtension(deps());
    const tool = ext.tools?.find((t) => t.name === "size_position");
    assert.ok(tool);
    const result = await tool.execute({ symbol: "MSFT", entry: 200, stop: 210 }, API, CTX);
    assert.equal((result as { isError?: boolean }).isError, true);
  });
});
