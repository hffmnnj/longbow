import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { confidenceOf, triageCandidate, triageText, triageThesis } from "./policy.ts";

describe("policy", () => {
  const quality = (score: number, confidence: number) => ({ type: "score" as const, score, confidence, probabilities: {} });
  const noul = (n: number) => ({ type: "noul" as const, noul: n });
  const choice = (c: string, confidence: number) => ({ type: "choice" as const, choice: c, confidence, probabilities: { [c]: 1 } });

  it("triageCandidate_pursues_only_a_confident_clean_setup", () => {
    assert.equal(
      triageCandidate({ quality: quality(1.8, 0.8), extended: noul(0.2), trendIntact: noul(0.7) }),
      "pursue",
    );
    assert.equal(
      triageCandidate({ quality: quality(1.8, 0.35), extended: noul(0.2), trendIntact: noul(0.7) }),
      "watch",
      "low confidence is never a pursue",
    );
    assert.equal(
      triageCandidate({ quality: quality(1.8, 0.8), extended: noul(0.7), trendIntact: noul(0.7) }),
      "watch",
      "an extended move is a watch, not a pursue",
    );
  });

  it("triageCandidate_passes_weak_or_broken_setups", () => {
    assert.equal(
      triageCandidate({ quality: quality(0.5, 0.9), extended: noul(0.1), trendIntact: noul(0.9) }),
      "pass",
    );
    assert.equal(
      triageCandidate({ quality: quality(1.9, 0.9), extended: noul(0.1), trendIntact: noul(0.2) }),
      "pass",
      "a broken trend passes whatever the score says",
    );
    assert.equal(
      triageCandidate({ quality: quality(1.0, 0.6), extended: noul(0.3), trendIntact: noul(0.6) }),
      "watch",
    );
  });

  it("triageText_flags_material_news_and_coin_flip_injections", () => {
    assert.deepEqual(triageText({ materiality: quality(2.2, 0.8), injection: noul(0.1) }), {
      material: true,
      injectionSuspected: false,
    });
    assert.deepEqual(triageText({ materiality: quality(2.2, 0.2), injection: noul(0.1) }), {
      material: false,
      injectionSuspected: false,
    });
    assert.deepEqual(triageText({ materiality: quality(0.4, 0.9), injection: noul(0.5) }), {
      material: false,
      injectionSuspected: true,
    });
  });

  it("triageThesis_escalates_from_hold_to_review_to_exit_review", () => {
    assert.equal(triageThesis({ intact: noul(0.8), contradicted: noul(0.2), nearInvalidation: noul(0.2) }), "hold");
    assert.equal(triageThesis({ intact: noul(0.4), contradicted: noul(0.2), nearInvalidation: noul(0.2) }), "review");
    assert.equal(triageThesis({ intact: noul(0.8), contradicted: noul(0.6), nearInvalidation: noul(0.2) }), "review");
    assert.equal(triageThesis({ intact: noul(0.8), contradicted: noul(0.2), nearInvalidation: noul(0.8) }), "review");
    assert.equal(triageThesis({ intact: noul(0.2), contradicted: noul(0.8), nearInvalidation: noul(0.2) }), "exit_review");
    assert.equal(
      triageThesis({ intact: noul(0.4), contradicted: noul(0.8), nearInvalidation: noul(0.2) }),
      "review",
      "a high contradiction alone is a review until the thesis itself reads broken",
    );
  });

  it("confidenceOf_uses_distance_from_coin_flip_for_nouls", () => {
    assert.equal(confidenceOf(noul(0.86)), 0.72);
    assert.equal(confidenceOf(noul(0.5)), 0);
    assert.equal(confidenceOf(choice("positive", 0.8)), 0.8);
    assert.equal(confidenceOf(quality(1.04, 0.8)), 0.8);
  });
});
