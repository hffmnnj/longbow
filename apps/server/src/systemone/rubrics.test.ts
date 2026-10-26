import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { candidateRubric, regimeRubric, textRubric, thesisRubric } from "./rubrics.ts";
import type { ChoiceQuestion, Question, ScoreQuestion } from "./types.ts";

const TICKER_LIKE = /\b[A-Z]{2,5}\b/;
const CALENDAR_DATE = /\b\d{4}-\d{2}-\d{2}\b/;

function assertBlind(state: unknown): void {
  const flat = JSON.stringify(state);
  assert.ok(!TICKER_LIKE.test(flat), `state leaks a ticker-like token: ${flat}`);
  assert.ok(!CALENDAR_DATE.test(flat), `state leaks a calendar date: ${flat}`);
}

function assertWellFormed(questions: Record<string, Question>): void {
  for (const [id, q] of Object.entries(questions)) {
    assert.match(id, /^[a-z][a-z0-9_]*$/, `question id is not snake_case: ${id}`);
    if (q.type === "choice") {
      assert.ok(Object.keys((q as ChoiceQuestion).criteria).length >= 2, `${id} needs at least two options`);
    }
    if (q.type === "score") {
      const levels = (q as ScoreQuestion).criteria.length;
      assert.ok(levels >= 2 && levels <= 10, `${id} needs 2 to 10 levels, has ${levels}`);
    }
    if (q.type === "noul") {
      assert.ok(q.criteria?.true && q.criteria?.false, `${id} needs true/false criteria`);
    }
    assert.ok(q.instructions.length >= 8, `${id} instructions are too short to be self-contained`);
  }
}

describe("candidateRubric", () => {
  it("candidate_state_holds_only_bucket_phrases_with_fixed_ids_and_types", () => {
    const { state, questions } = candidateRubric({
      return1m: 4.2,
      return3m: 12.5,
      relativeStrength3m: 5,
      distanceFromHigh: 2,
      atrPct: 2.2,
      rsi14: 62,
      above50: true,
      above200: true,
      volumeRatio: 1.5,
      earningsDaysAway: 20,
      rewardRisk: 2.5,
    });
    assert.deepEqual(Object.keys(questions).sort(), ["extended", "setup_quality", "setup_type", "trend_intact"]);
    assert.equal(questions.setup_quality.type, "score");
    assert.equal(questions.extended.type, "noul");
    assert.equal(questions.trend_intact.type, "noul");
    assert.equal(questions.setup_type.type, "choice");
    assert.equal(questions.setup_quality.criteria.length, 3);
    assert.equal(Object.keys(questions.setup_type.criteria).length, 5);
    assert.equal(state.setup_context.trend, "above both the 50-day and 200-day averages");
    assert.equal(state.setup_context.one_month_return, "up");
    assert.equal(state.setup_context.momentum, "firm");
    assert.equal(state.setup_context.reward_to_risk, "favorable, 2 to 3 to 1");
    assertBlind(state);
    assertWellFormed(questions);
  });

  it("candidate_state_stays_blind_when_inputs_are_missing", () => {
    const { state, questions } = candidateRubric({});
    assert.equal(state.setup_context.trend, "unknown");
    assert.equal(state.setup_context.earnings, "no report scheduled soon");
    assertBlind(state);
    assertWellFormed(questions);
  });
});

describe("textRubric", () => {
  it("text_state_truncates_and_keeps_fixed_questions", () => {
    const { state, questions } = textRubric(
      { text: "x".repeat(2000), source: "wire service" },
      "holding this name on a growth thesis",
    );
    assert.equal(state.text.length, 1500);
    assert.equal(state.source, "wire service");
    assert.equal(state.context, "holding this name on a growth thesis");
    assert.deepEqual(Object.keys(questions).sort(), [
      "addresses_ai_agent",
      "direction_for_holders",
      "event_type",
      "is_promotional",
      "materiality",
    ]);
    assert.equal(questions.event_type.type, "choice");
    assert.equal(questions.materiality.criteria.length, 4);
    assertWellFormed(questions);
  });

  it("text_state_stays_blind_for_plain_reporting_inputs", () => {
    const { state } = textRubric({
      text: "The company raised its quarterly outlook as demand improved across regions.",
    });
    assert.equal(state.source, undefined);
    assertBlind(state);
  });
});

describe("thesisRubric", () => {
  it("thesis_state_caps_and_truncates_news", () => {
    const { state, questions } = thesisRubric({
      thesis: "Growth reaccelerates on new products while margins hold.",
      invalidation: "Two weak quarters in a row.",
      position: {
        pnlBand: "up",
        holdingBand: "held a few days",
        stopDistanceBand: "1 to 3 percent from the stop",
        targetDistanceBand: "up",
      },
      news: Array.from({ length: 7 }, (_, i) => `story ${i} `.repeat(100)),
    });
    assert.equal(state.news.length, 5);
    assert.ok(state.news.every((n) => n.length <= 400));
    assert.deepEqual(Object.keys(questions).sort(), ["near_invalidation", "news_contradicts", "thesis_intact"]);
    assert.ok(questions.thesis_intact.instructions.includes("thesis"));
    assert.ok(questions.thesis_intact.instructions.includes("position"));
    assert.ok(questions.news_contradicts.instructions.includes("news"));
    assertBlind(state);
    assertWellFormed(questions);
  });
});

describe("regimeRubric", () => {
  it("regime_state_bands_volatility_and_skips_absent_optionals", () => {
    const { state, questions } = regimeRubric({
      above50: true,
      above200: true,
      return1m: 2,
      return3m: 6,
      realizedVolAnn: 14,
      distanceFromHigh: 1.5,
      vix: 16,
    });
    assert.equal(state.market_context.volatility, "normal");
    assert.equal(state.market_context.vix, "normal");
    assert.equal(state.market_context.bond_yield, undefined);
    assert.deepEqual(Object.keys(questions).sort(), ["disorderly", "regime", "trend_clean"]);
    assert.equal(Object.keys(questions.regime.criteria).length, 5);
    assertBlind(state);
    assertWellFormed(questions);
  });

  it("regime_state_bands_a_stressed_market", () => {
    const { state } = regimeRubric({
      above50: false,
      above200: false,
      return1m: -12,
      return3m: -18,
      realizedVolAnn: 35,
      distanceFromHigh: 20,
      vix: 34,
      yield10y: 5.2,
    });
    assert.equal(state.market_context.volatility, "stressed");
    assert.equal(state.market_context.vix, "stressed");
    assert.equal(state.market_context.bond_yield, "elevated");
    assertBlind(state);
  });
});

