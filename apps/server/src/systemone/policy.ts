import { noulConfidence, type Answer, type ChoiceAnswer, type NoulAnswer, type ScoreAnswer } from "./types.ts";

/**
 * Deterministic rules over Jev's answers. Every threshold lives here, each
 * with its reason, so tuning never means editing prompts or tools.
 */

// A pursue needs a better-than-fair setup: 2 is strong, 1 is fair, so 1.4 clears fair with margin.
export const CANDIDATE_PURSUE_MIN_SCORE = 1.4;
// Below this confidence Jev is guessing, so a pursue is never justified.
export const CANDIDATE_PURSUE_MIN_CONFIDENCE = 0.5;
// Above this extended probability a long entry chases the move instead of entering early.
export const CANDIDATE_EXTENDED_MAX_NOUL = 0.6;
// Below this trend-intact probability the uptrend premise is gone.
export const CANDIDATE_TREND_MIN_NOUL = 0.5;
// Below a weak setup there is nothing to watch; pass and save the attention.
export const CANDIDATE_PASS_MAX_SCORE = 0.8;
// A clearly broken trend fails the candidate whatever the setup score says.
export const CANDIDATE_TREND_FAIL_NOUL = 0.3;
// Confidence this low means Jev saw nothing usable; hold at watch, never pursue.
export const CANDIDATE_LOW_CONFIDENCE = 0.4;

// Materiality runs 0 noise to 3 thesis-changing, so 1.5 is at least solidly minor-plus.
export const TEXT_MATERIAL_MIN_SCORE = 1.5;
// Low-confidence materiality is usually Jev hedging on thin text; do not flag it.
export const TEXT_MATERIAL_MIN_CONFIDENCE = 0.4;
// A false injection alarm costs one read; a miss hands the agent a hijacked context, so flag at coin-flip.
export const TEXT_INJECTION_MIN_NOUL = 0.5;

// Contradiction this high with the thesis this low is the exit conversation, not a watch.
export const THESIS_EXIT_CONTRADICTED_MIN = 0.75;
// The thesis is no longer intact once Jev puts survival odds at or below a coin flip against.
export const THESIS_EXIT_INTACT_MAX = 0.3;
// Any serious contradiction, doubt about the thesis, or closeness to invalidation earns a review.
export const THESIS_REVIEW_CONTRADICTED_MIN = 0.5;
export const THESIS_REVIEW_INTACT_MIN = 0.5;
export const THESIS_REVIEW_INVALIDATION_MIN = 0.7;

export interface CandidateRead {
  quality: ScoreAnswer;
  extended: NoulAnswer;
  trendIntact: NoulAnswer;
}

export type CandidateTriage = "pursue" | "watch" | "pass";

export function triageCandidate(read: CandidateRead): CandidateTriage {
  const q = read.quality.score;
  if (q < CANDIDATE_PASS_MAX_SCORE || read.trendIntact.noul < CANDIDATE_TREND_FAIL_NOUL) return "pass";
  if (
    q >= CANDIDATE_PURSUE_MIN_SCORE &&
    read.quality.confidence >= CANDIDATE_PURSUE_MIN_CONFIDENCE &&
    read.quality.confidence >= CANDIDATE_LOW_CONFIDENCE &&
    read.extended.noul < CANDIDATE_EXTENDED_MAX_NOUL &&
    read.trendIntact.noul >= CANDIDATE_TREND_MIN_NOUL
  ) {
    return "pursue";
  }
  return "watch";
}

export interface TextRead {
  materiality: ScoreAnswer;
  injection: NoulAnswer;
}

export function triageText(read: TextRead): { material: boolean; injectionSuspected: boolean } {
  return {
    material: read.materiality.score >= TEXT_MATERIAL_MIN_SCORE && read.materiality.confidence >= TEXT_MATERIAL_MIN_CONFIDENCE,
    injectionSuspected: read.injection.noul >= TEXT_INJECTION_MIN_NOUL,
  };
}

export interface ThesisRead {
  intact: NoulAnswer;
  contradicted: NoulAnswer;
  nearInvalidation: NoulAnswer;
}

export type ThesisAction = "hold" | "review" | "exit_review";

export function triageThesis(read: ThesisRead): ThesisAction {
  if (read.contradicted.noul >= THESIS_EXIT_CONTRADICTED_MIN && read.intact.noul <= THESIS_EXIT_INTACT_MAX) {
    return "exit_review";
  }
  if (
    read.contradicted.noul >= THESIS_REVIEW_CONTRADICTED_MIN ||
    read.intact.noul < THESIS_REVIEW_INTACT_MIN ||
    read.nearInvalidation.noul >= THESIS_REVIEW_INVALIDATION_MIN
  ) {
    return "review";
  }
  return "hold";
}

/** Confidence on the 0..1 scale: distance from a coin flip for nouls, the reported confidence otherwise. */
export function confidenceOf(answer: Answer): number {
  if (answer.type === "noul") return noulConfidence(answer);
  const withConfidence = answer as ChoiceAnswer | ScoreAnswer;
  return withConfidence.confidence;
}
