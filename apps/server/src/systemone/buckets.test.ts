import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  atrBand,
  distanceFromHighBand,
  earningsBand,
  realizedVolBand,
  relativeStrengthBand,
  returnBand,
  rewardToRiskBand,
  rsiBand,
  stopDistanceBand,
  trendBand,
  vixBand,
  volumeBand,
  yieldBand,
} from "./buckets.ts";

describe("returnBand edges", () => {
  it("returnBand_names_bands_at_inclusive_lower_edges", () => {
    assert.equal(returnBand(-10.5), "strongly down");
    assert.equal(returnBand(-10), "down");
    assert.equal(returnBand(-3.1), "down");
    assert.equal(returnBand(-3), "flat");
    assert.equal(returnBand(0), "flat");
    assert.equal(returnBand(2.99), "flat");
    assert.equal(returnBand(3), "up");
    assert.equal(returnBand(9.99), "up");
    assert.equal(returnBand(10), "strongly up");
  });

  it("returnBand_reports_unknown_for_missing_or_nonfinite_input", () => {
    assert.equal(returnBand(undefined), "unknown");
    assert.equal(returnBand(NaN), "unknown");
    assert.equal(returnBand(Infinity), "unknown");
  });
});

describe("momentum and risk bands", () => {
  it("rsiBand_names_momentum_at_inclusive_lower_edges", () => {
    assert.equal(rsiBand(29.9), "oversold");
    assert.equal(rsiBand(30), "weak");
    assert.equal(rsiBand(44.9), "weak");
    assert.equal(rsiBand(45), "neutral");
    assert.equal(rsiBand(54.9), "neutral");
    assert.equal(rsiBand(55), "firm");
    assert.equal(rsiBand(69.9), "firm");
    assert.equal(rsiBand(70), "overbought");
    assert.equal(rsiBand(undefined), "unknown");
    assert.equal(rsiBand(NaN), "unknown");
  });

  it("distanceFromHighBand_names_proximity_to_the_high", () => {
    assert.equal(distanceFromHighBand(0), "at the 52-week high");
    assert.equal(distanceFromHighBand(0.99), "at the 52-week high");
    assert.equal(distanceFromHighBand(1), "just under the high");
    assert.equal(distanceFromHighBand(4.99), "just under the high");
    assert.equal(distanceFromHighBand(5), "moderately below the high");
    assert.equal(distanceFromHighBand(14.99), "moderately below the high");
    assert.equal(distanceFromHighBand(15), "far below the high");
    assert.equal(distanceFromHighBand(undefined), "unknown");
  });

  it("atrBand_names_volatility_regimes", () => {
    assert.equal(atrBand(1.49), "low");
    assert.equal(atrBand(1.5), "moderate");
    assert.equal(atrBand(2.99), "moderate");
    assert.equal(atrBand(3), "high");
    assert.equal(atrBand(4.99), "high");
    assert.equal(atrBand(5), "very high");
    assert.equal(atrBand(undefined), "unknown");
  });

  it("volumeBand_names_activity_regimes", () => {
    assert.equal(volumeBand(0.69), "quiet");
    assert.equal(volumeBand(0.7), "normal");
    assert.equal(volumeBand(1.29), "normal");
    assert.equal(volumeBand(1.3), "elevated");
    assert.equal(volumeBand(1.99), "elevated");
    assert.equal(volumeBand(2), "heavy");
    assert.equal(volumeBand(undefined), "unknown");
  });

  it("relativeStrengthBand_names_market_comparison", () => {
    assert.equal(relativeStrengthBand(-8.1), "much weaker than the market");
    assert.equal(relativeStrengthBand(-8), "weaker than the market");
    assert.equal(relativeStrengthBand(-2.1), "weaker than the market");
    assert.equal(relativeStrengthBand(-2), "in line with the market");
    assert.equal(relativeStrengthBand(1.99), "in line with the market");
    assert.equal(relativeStrengthBand(2), "stronger than the market");
    assert.equal(relativeStrengthBand(7.99), "stronger than the market");
    assert.equal(relativeStrengthBand(8), "much stronger than the market");
    assert.equal(relativeStrengthBand(undefined), "unknown");
  });

  it("rewardToRiskBand_names_deal_quality", () => {
    assert.equal(rewardToRiskBand(0.99), "unfavorable, under 1 to 1");
    assert.equal(rewardToRiskBand(1), "marginal, 1 to 2 to 1");
    assert.equal(rewardToRiskBand(1.99), "marginal, 1 to 2 to 1");
    assert.equal(rewardToRiskBand(2), "favorable, 2 to 3 to 1");
    assert.equal(rewardToRiskBand(2.99), "favorable, 2 to 3 to 1");
    assert.equal(rewardToRiskBand(3), "very favorable, 3 to 1 or better");
    assert.equal(rewardToRiskBand(undefined), "unknown");
  });
});

describe("trend and calendar bands", () => {
  it("trendBand_names_all_four_average_positions", () => {
    assert.equal(trendBand(true, true), "above both the 50-day and 200-day averages");
    assert.equal(trendBand(false, true), "above the 200-day but below the 50-day average");
    assert.equal(trendBand(true, false), "above the 50-day but below the 200-day average");
    assert.equal(trendBand(false, false), "below both averages");
  });

  it("trendBand_reports_unknown_when_a_trend_leg_is_missing", () => {
    assert.equal(trendBand(undefined, true), "unknown");
    assert.equal(trendBand(true, undefined), "unknown");
    assert.equal(trendBand(undefined, undefined), "unknown");
  });

  it("earningsBand_names_the_reporting_window", () => {
    assert.equal(earningsBand(undefined), "no report scheduled soon");
    assert.equal(earningsBand(11), "no report scheduled soon");
    assert.equal(earningsBand(10), "report within 10 trading days");
    assert.equal(earningsBand(4), "report within 10 trading days");
    assert.equal(earningsBand(3), "report within 3 trading days");
    assert.equal(earningsBand(0), "report within 3 trading days");
    assert.equal(earningsBand(-1), "no report scheduled soon");
    assert.equal(earningsBand(NaN), "unknown");
  });

  it("stopDistanceBand_names_room_to_the_stop", () => {
    assert.equal(stopDistanceBand(0.5), "under 1 percent from the stop");
    assert.equal(stopDistanceBand(-2), "under 1 percent from the stop");
    assert.equal(stopDistanceBand(1), "1 to 3 percent from the stop");
    assert.equal(stopDistanceBand(3), "1 to 3 percent from the stop");
    assert.equal(stopDistanceBand(3.1), "more than 3 percent from the stop");
    assert.equal(stopDistanceBand(undefined), "unknown");
  });

  it("regime_bands_name_volatility_and_rate_regimes", () => {
    assert.equal(realizedVolBand(11.9), "calm");
    assert.equal(realizedVolBand(12), "normal");
    assert.equal(realizedVolBand(20), "elevated");
    assert.equal(realizedVolBand(30), "stressed");
    assert.equal(realizedVolBand(undefined), "unknown");
    assert.equal(vixBand(14.9), "calm");
    assert.equal(vixBand(15), "normal");
    assert.equal(vixBand(22), "elevated");
    assert.equal(vixBand(30), "stressed");
    assert.equal(vixBand(undefined), "unknown");
    assert.equal(yieldBand(2.99), "low");
    assert.equal(yieldBand(3), "normal");
    assert.equal(yieldBand(5), "elevated");
    assert.equal(yieldBand(undefined), "unknown");
  });
});
