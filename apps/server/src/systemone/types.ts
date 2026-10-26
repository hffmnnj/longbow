import { z } from "zod";

/**
 * Wire types for a System One decision model (TypeSafe's Jev). State goes in as JSON or text,
 * typed questions go in beside it, typed answers with probabilities come back. The response
 * shapes were captured from the live API (see client.test.ts); `noul` is the probability of yes.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  /** What a yes and a no mean; sharpens literal-minded reading. */
  criteria?: { true: string; false: string };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** Option id to what it means. At least two. */
  criteria: Readonly<Record<string, string>>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  /** Ordered level descriptions, 2 to 10; the answer is a zero-based position between them. */
  criteria: readonly string[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type QuestionMap = Record<string, Question>;

export const NoulAnswerSchema = z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) });
export const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number()),
});
export const ScoreAnswerSchema = z.object({
  type: z.literal("score"),
  /** Expected zero-based level index; fractional between levels. */
  score: z.number(),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number()),
  legend: z.record(z.string(), z.string()).optional(),
});
export const AnswerSchema = z.discriminatedUnion("type", [NoulAnswerSchema, ChoiceAnswerSchema, ScoreAnswerSchema]);

export type NoulAnswer = z.infer<typeof NoulAnswerSchema>;
export type ChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;
export type ScoreAnswer = z.infer<typeof ScoreAnswerSchema>;
export type Answer = z.infer<typeof AnswerSchema>;

export const SystemOneResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), AnswerSchema),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
});

/** The answer type a question produces. */
export type AnswerFor<Q extends Question> = Q extends NoulQuestion
  ? NoulAnswer
  : Q extends ChoiceQuestion
    ? ChoiceAnswer
    : ScoreAnswer;

export type AnswersFor<M extends QuestionMap> = { [K in keyof M]: AnswerFor<M[K]> };

export interface AskRequest<M extends QuestionMap> {
  /** Short call label for stats and logs, such as "candidate" or "entry_review". Never sent to the model. */
  label: string;
  state: JsonValue;
  questions: M;
}

export type AskFailure =
  | "unconfigured"
  | "rate_limited"
  | "payment"
  | "timeout"
  | "invalid_request"
  | "bad_response"
  | "http";

export type AskResult<M extends QuestionMap> =
  | { ok: true; answers: AnswersFor<M>; model: string; latencyMs: number; inputTokens: number; cached: boolean }
  | { ok: false; reason: AskFailure; detail: string; retryAfterMs?: number };

/** Confidence for a noul on the same 0..1 scale as choice and score: distance from a coin flip. */
export function noulConfidence(answer: NoulAnswer): number {
  return Math.abs(2 * answer.noul - 1);
}
