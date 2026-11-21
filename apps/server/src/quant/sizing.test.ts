import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RISK, type RiskConfig } from "@rh/shared";
import { computeSize, type SizeInputs } from "./sizing.ts";

function base(over: Partial<SizeInputs> = {}): SizeInputs {
  return {
    symbol: "MSFT",
    entry: 100,
    stop: 95,
    atrMultiple: 2,
    riskPct: 1,
    equity: 10_000,
    buyingPower: 10_000,
    existingMarketValue: 0,
    risk: structuredClone(DEFAULT_RISK) as RiskConfig,
    ...over,
  };
}

describe("computeSize", () => {
  it("sizes_from_dollar_risk_over_r_per_share", () => {
    const out = computeSize(base());
    assert.ok(!("error" in out));
    // $100 risk / $5 per share = 20 shares, but the $500 notional cap binds first.
    assert.equal(out.quantity, 5);
    assert.equal(out.notional, 500);
    assert.equal(out.equityPct, 5);
    assert.equal(out.riskDollars, 25);
    assert.equal(out.rPerShare, 5);
    assert.equal(out.boundBy, "notional");
    assert.ok(out.checks.every((c) => c.ok));
  });

  it("binds_on_risk_when_caps_are_loose", () => {
    const risk = { ...structuredClone(DEFAULT_RISK), maxOrderNotionalUsd: 1_000_000, maxPositionPct: 100 as const };
    const out = computeSize(base({ risk: risk as RiskConfig }));
    assert.ok(!("error" in out));
    assert.equal(out.quantity, 20);
    assert.equal(out.boundBy, "risk");
  });

  it("binds_on_the_position_cap_with_an_existing_holding", () => {
    const risk = { ...structuredClone(DEFAULT_RISK), maxOrderNotionalUsd: 1_000_000 };
    const out = computeSize(base({ risk: risk as RiskConfig, existingMarketValue: 2900 }));
    assert.ok(!("error" in out));
    // 30% of 10k = 3000; headroom 100 -> 1 share.
    assert.equal(out.quantity, 1);
    assert.equal(out.boundBy, "position");
  });

  it("binds_on_buying_power_when_cash_is_short", () => {
    const risk = { ...structuredClone(DEFAULT_RISK), maxOrderNotionalUsd: 1_000_000, maxPositionPct: 100 as const };
    const out = computeSize(base({ risk: risk as RiskConfig, buyingPower: 250 }));
    assert.ok(!("error" in out));
    assert.equal(out.quantity, 2.5);
    assert.equal(out.boundBy, "buying_power");
  });

  it("derives_the_stop_from_atr_when_missing", () => {
    const out = computeSize({ ...base(), stop: undefined, atr: 2.5 });
    assert.ok(!("error" in out));
    assert.equal(out.stop, 95);
    assert.equal(out.quantity, 5);
  });

  it("rejects_stops_at_or_above_entry", () => {
    for (const stop of [100, 105]) {
      const out = computeSize(base({ stop }));
      assert.ok("error" in out);
      assert.match(out.error, /at or above entry/);
    }
  });

  it("floors_to_6_decimals_and_flags_failing_rules", () => {
    const risk = {
      ...structuredClone(DEFAULT_RISK),
      maxOrderNotionalUsd: 1_000_000,
      maxPositionPct: 100 as const,
      minOrderNotionalUsd: 500,
    };
    const out = computeSize(base({ risk: risk as RiskConfig, entry: 33.3333333, stop: 30, riskPct: 0.1 }));
    assert.ok(!("error" in out));
    assert.equal(out.quantity, Math.floor(out.quantity * 1e6) / 1e6);
    const min = out.checks.find((c) => c.rule === "min_notional");
    assert.ok(min);
    // About 3 shares at $33.33 is ~$100, below the $500 minimum.
    assert.equal(min.ok, false);
  });
});

describe("computeSize advisory caps", () => {
  it("uses_settled_cash_when_it_is_below_buying_power", () => {
    const risk = { ...structuredClone(DEFAULT_RISK), maxOrderNotionalUsd: 1_000_000, maxPositionPct: 100 as const };
    const out = computeSize(base({ risk: risk as RiskConfig, buyingPower: 10_000, settledCash: 250 }));
    assert.ok(!("error" in out));
    assert.equal(out.quantity, 2.5);
    assert.equal(out.notional, 250);
    assert.equal(out.boundBy, "buying_power");
    // The suggested order must not fail the settled-cash rule it was sized against.
    assert.ok(out.checks.every((c) => c.ok));
  });

  it("caps_requested_risk_at_the_per_trade_max_and_names_the_effective_cap", () => {
    const risk = { ...structuredClone(DEFAULT_RISK), maxOrderNotionalUsd: 1_000_000, maxPositionPct: 100 as const };
    const out = computeSize(base({ risk: risk as RiskConfig, riskPct: 3 }));
    assert.ok(!("error" in out));
    // Requested 3% would risk $300 (60 shares); the 1.5% cap allows $150 (30 shares).
    assert.equal(out.quantity, 30);
    assert.equal(out.notional, 3_000);
    assert.equal(out.riskDollars, 150);
    assert.equal(out.boundBy, "risk");
    const check = out.checks.find((c) => c.rule === "risk_per_trade");
    assert.ok(check);
    assert.equal(check.ok, true);
    assert.match(check.detail, /1\.5% of equity/);
    assert.match(check.detail, /requested 3% capped at maxRiskPerTradePct 1\.5%/);
  });

  it("keeps_a_failing_min_notional_visible_when_risk_is_capped", () => {
    const risk = { ...structuredClone(DEFAULT_RISK), maxOrderNotionalUsd: 1_000_000, maxPositionPct: 100 as const };
    const out = computeSize(base({ risk: risk as RiskConfig, riskPct: 3, equity: 10 }));
    assert.ok(!("error" in out));
    const min = out.checks.find((c) => c.rule === "min_notional");
    assert.ok(min);
    assert.equal(min.ok, false);
  });
});
