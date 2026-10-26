import type { OrderIntent, RiskCheck, SystemOneGate } from "@rh/shared";
import type { Clock, Logger } from "../ports.ts";
import { rewardToRiskBand } from "./buckets.ts";
import type { SystemOneClient } from "./client.ts";
import { askAveraged } from "./sampling.ts";
import type { NoulAnswer, NoulQuestion } from "./types.ts";

/**
 * System One second opinion on an entry the risk engine already approved. Jev reads the intent's own
 * thesis and evidence list and answers five literal yes/no questions. Code turns the probabilities into
 * clear, caution, or concern. The review adds one `system_one` risk check; it can tighten (gate "block"
 * and a concern) but never loosen, and an outage passes with a note.
 */

/** Below this a supporting or consistent answer is a confident no, so the thesis has a real problem. */
export const CONCERN_BELOW = 0.25;
/** Weaker signals that deserve a read but not a rejection. */
export const CAUTION_SUPPORT_BELOW = 0.5;
export const CAUTION_SPECIFIC_BELOW = 0.4;
export const CAUTION_ABOVE = 0.75;

const DAY_MS = 86_400_000;

const TRUE_FALSE = (yes: string, no: string): NoulQuestion["criteria"] => ({ true: yes, false: no });

export const ENTRY_QUESTIONS = {
  thesis_supported: {
    type: "noul",
    instructions: "Do the evidence items in the state support the main claim of the thesis?",
    criteria: TRUE_FALSE(
      "The evidence items state facts that back the thesis's main claim",
      "The evidence is missing, unrelated to the thesis, or points the other way",
    ),
  },
  thesis_consistent: {
    type: "noul",
    instructions: "Is the thesis free of internal contradictions, for example a bullish claim resting on bearish facts?",
    criteria: TRUE_FALSE("The claims in the thesis agree with each other", "Two or more claims in the thesis contradict each other"),
  },
  evidence_specific: {
    type: "noul",
    instructions: "Does each evidence item name a specific tool output and say what it showed?",
    criteria: TRUE_FALSE(
      "Every evidence item names a source and states a concrete observation",
      "At least one evidence item is a vague claim without a named source or observation",
    ),
  },
  chasing: {
    type: "noul",
    instructions: "Does the thesis describe buying after an extended run-up rather than entering early or on a pullback?",
    criteria: TRUE_FALSE("The entry follows a move that has already run", "The entry is early or on a pullback"),
  },
  binary_event: {
    type: "noul",
    instructions: "Does the thesis depend on the outcome of a scheduled binary event such as an earnings report or a regulatory decision?",
    criteria: TRUE_FALSE("The trade works only if a scheduled event goes the right way", "The thesis does not hinge on one scheduled event"),
  },
} as const satisfies Record<string, NoulQuestion>;

export type EntryAnswers = { [K in keyof typeof ENTRY_QUESTIONS]: NoulAnswer };
export type EntryVerdict = "clear" | "caution" | "concern";

export interface EntryJudgement {
  verdict: EntryVerdict;
  flags: string[];
}

/** Pure rule over the five probabilities. */
export function judgeEntry(answers: EntryAnswers): EntryJudgement {
  const flags: string[] = [];
  let concern = false;
  if (answers.thesis_supported.noul < CONCERN_BELOW) {
    concern = true;
    flags.push("evidence does not support the thesis");
  } else if (answers.thesis_supported.noul < CAUTION_SUPPORT_BELOW) flags.push("evidence only weakly supports the thesis");
  if (answers.thesis_consistent.noul < CONCERN_BELOW) {
    concern = true;
    flags.push("thesis contradicts itself");
  }
  if (answers.evidence_specific.noul < CAUTION_SPECIFIC_BELOW) flags.push("evidence is vague");
  if (answers.chasing.noul >= CAUTION_ABOVE) flags.push("looks like chasing");
  if (answers.binary_event.noul >= CAUTION_ABOVE) flags.push("hinges on a binary event");
  return { verdict: concern ? "concern" : flags.length > 0 ? "caution" : "clear", flags };
}

function horizonPhrase(timeStopDate: string, now: number): string {
  const days = Math.round((Date.parse(`${timeStopDate}T12:00:00Z`) - now) / DAY_MS);
  if (!Number.isFinite(days)) return "unknown";
  if (days <= 7) return "time stop within a week";
  if (days <= 31) return "time stop within a month";
  return "time stop beyond a month";
}

function winProbabilityPhrase(p: number): string {
  return p >= 0.65 ? "high" : p >= 0.5 ? "moderate" : "low";
}

export function entryState(intent: OrderIntent, now: number): Record<string, unknown> {
  const reward = intent.expectedLossPct > 0 ? intent.expectedGainPct / intent.expectedLossPct : undefined;
  return {
    trade: {
      action: "buy to open a new long position",
      thesis: intent.thesis,
      reward_to_risk: rewardToRiskBand(reward),
      time_horizon: horizonPhrase(intent.timeStopDate, now),
      stated_win_probability: winProbabilityPhrase(intent.probabilityWin),
    },
    evidence: intent.evidence.map((item) => item.slice(0, 400)),
  };
}

const fmt = (answer: NoulAnswer): string => answer.noul.toFixed(2);

export interface EntryReviewDeps {
  client: SystemOneClient;
  clock: Clock;
  log: Logger;
  /** Hard cap on the whole review so a slow model never stalls an order; default 4000 ms. */
  timeoutMs?: number;
}

export type EntryReview = (intent: OrderIntent, gate: SystemOneGate) => Promise<RiskCheck | undefined>;

export function createEntryReview(deps: EntryReviewDeps): EntryReview {
  const timeoutMs = deps.timeoutMs ?? 4000;
  return async (intent, gate) => {
    if (gate === "off") return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const asked = askAveraged(deps.client, {
      label: "entry_review",
      state: entryState(intent, deps.clock.now()) as never,
      questions: ENTRY_QUESTIONS,
    });
    const result = await Promise.race([asked, timeout]);
    if (timer !== undefined) clearTimeout(timer);
    if (result === "timeout") {
      deps.log.warn("system one entry review timed out", { symbol: intent.symbol, timeoutMs });
      return { rule: "system_one", ok: true, detail: "not reviewed: timed out" };
    }
    if (!result.ok) return { rule: "system_one", ok: true, detail: `not reviewed: ${result.reason}` };
    const a = result.answers;
    const { verdict, flags } = judgeEntry(a);
    const numbers = `supported ${fmt(a.thesis_supported)}, consistent ${fmt(a.thesis_consistent)}, specific ${fmt(a.evidence_specific)}, chasing ${fmt(a.chasing)}, binary event ${fmt(a.binary_event)}`;
    const blocked = gate === "block" && verdict === "concern";
    const tail = flags.length === 0 ? "" : `; ${flags.join(", ")}`;
    return {
      rule: "system_one",
      ok: !blocked,
      detail: `${verdict}${blocked ? " (blocked)" : gate === "advise" ? " (advice only)" : ""}: ${numbers}${tail}`,
    };
  };
}
