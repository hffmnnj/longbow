import type { SystemOneClient } from "./client.ts";
import type { Answer, AnswersFor, AskRequest, AskResult, QuestionMap } from "./types.ts";

/**
 * Jev is not deterministic: TradeRank saw five identical requests differ by up to 0.07 in probability
 * and averages five samples before acting. Decisions that gate or advise on a threshold average a few
 * fresh samples here instead of trusting one draw. Samples run in parallel, so latency stays one call.
 */

export const DEFAULT_SAMPLES = 3;

const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

function meanProbabilities(all: Record<string, number>[]): Record<string, number> {
  const keys = new Set(all.flatMap((p) => Object.keys(p)));
  return Object.fromEntries([...keys].map((key) => [key, mean(all.map((p) => p[key] ?? 0))]));
}

function averageAnswers(samples: Answer[]): Answer {
  const first = samples[0] as Answer;
  if (first.type === "noul") {
    return { type: "noul", noul: mean(samples.map((a) => (a as typeof first).noul)) };
  }
  if (first.type === "choice") {
    const probabilities = meanProbabilities(samples.map((a) => (a as typeof first).probabilities));
    const entries = Object.entries(probabilities);
    const [choice, top] = entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best), entries[0] as [string, number]);
    const k = entries.length;
    // TypeSafe's choice confidence: 1 when all mass is on one option, 0 when spread evenly.
    const confidence = k > 1 ? Math.min(1, Math.max(0, (k * top - 1) / (k - 1))) : 1;
    return { type: "choice", choice, confidence, probabilities };
  }
  const scores = samples as (typeof first)[];
  const legend = (scores.find((a) => (a as { legend?: unknown }).legend !== undefined) as { legend?: Record<string, string> } | undefined)?.legend;
  return {
    type: "score",
    score: mean(scores.map((a) => (a as { score: number }).score)),
    confidence: mean(scores.map((a) => (a as { confidence: number }).confidence)),
    probabilities: meanProbabilities(scores.map((a) => (a as { probabilities: Record<string, number> }).probabilities)),
    ...(legend === undefined ? {} : { legend }),
  };
}

/** Asks `samples` times without the cache and averages the answers; failed samples are dropped, all failing returns the first failure. */
export async function askAveraged<M extends QuestionMap>(
  client: SystemOneClient,
  request: AskRequest<M>,
  samples: number = DEFAULT_SAMPLES,
): Promise<AskResult<M>> {
  const n = Math.max(1, Math.floor(samples));
  const results = await Promise.all(Array.from({ length: n }, () => client.ask({ ...request, fresh: true })));
  const good = results.filter((r): r is Extract<AskResult<M>, { ok: true }> => r.ok);
  const firstFailure = results.find((r) => !r.ok);
  if (good.length === 0) return firstFailure ?? { ok: false, reason: "http", detail: "no samples" };
  const answers = Object.fromEntries(
    Object.keys(request.questions).map((id) => [id, averageAnswers(good.map((r) => (r.answers as Record<string, Answer>)[id] as Answer))]),
  );
  return {
    ok: true,
    answers: answers as AnswersFor<M>,
    model: good[0]?.model ?? "",
    latencyMs: Math.max(...good.map((r) => r.latencyMs)),
    inputTokens: good.reduce((sum, r) => sum + r.inputTokens, 0),
    cached: false,
  };
}
