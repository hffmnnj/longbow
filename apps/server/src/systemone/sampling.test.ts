import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SystemOneClient } from "./client.ts";
import { askAveraged } from "./sampling.ts";
import type { Answer, AskRequest, AskResult, QuestionMap } from "./types.ts";

const questions = {
  yes: { type: "noul", instructions: "Is it true?" },
  pick: { type: "choice", instructions: "Which?", criteria: { a: "A", b: "B", c: "C" } },
  level: { type: "score", instructions: "How much?", criteria: ["low", "mid", "high"] },
} as const;

type Draw = { yes: number; a: number; b: number; level: number };

function clientFrom(draws: (Draw | "fail")[], seen: AskRequest<QuestionMap>[] = []): SystemOneClient {
  let i = 0;
  return {
    ask: (async (request: AskRequest<QuestionMap>): Promise<AskResult<QuestionMap>> => {
      seen.push(request);
      const draw = draws[i++ % draws.length] as Draw | "fail";
      if (draw === "fail") return { ok: false, reason: "http", detail: "boom" };
      const answers: Record<string, Answer> = {
        yes: { type: "noul", noul: draw.yes },
        pick: { type: "choice", choice: draw.a >= draw.b ? "a" : "b", confidence: 0.5, probabilities: { a: draw.a, b: draw.b, c: 1 - draw.a - draw.b } },
        level: { type: "score", score: draw.level, confidence: 0.6, probabilities: { "0": 0.2, "1": 0.5, "2": 0.3 } },
      };
      return { ok: true, answers, model: "m", latencyMs: 10, inputTokens: 100, cached: false };
    }) as SystemOneClient["ask"],
    status: () => ({ state: "ok", model: "m", calls24h: 0, inputTokens24h: 0 }),
    available: () => true,
  };
}

describe("askAveraged", () => {
  it("averages each question type across fresh samples and asks without the cache", async () => {
    const seen: AskRequest<QuestionMap>[] = [];
    const result = await askAveraged(
      clientFrom([{ yes: 0.2, a: 0.7, b: 0.2, level: 1 }, { yes: 0.4, a: 0.5, b: 0.4, level: 1.2 }, { yes: 0.3, a: 0.6, b: 0.3, level: 0.8 }], seen),
      { label: "t", state: "x", questions },
      3,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(Math.abs(result.answers.yes.noul - 0.3) < 1e-9);
    assert.equal(result.answers.pick.choice, "a");
    assert.ok(Math.abs((result.answers.pick.probabilities["a"] ?? 0) - 0.6) < 1e-9);
    // three options, top 0.6: (3 * 0.6 - 1) / 2
    assert.ok(Math.abs(result.answers.pick.confidence - 0.4) < 1e-9);
    assert.ok(Math.abs(result.answers.level.score - 1) < 1e-9);
    assert.equal(result.inputTokens, 300);
    assert.equal(seen.length, 3);
    assert.ok(seen.every((r) => r.fresh === true));
  });

  it("drops failed samples and still answers from the rest", async () => {
    const result = await askAveraged(clientFrom([{ yes: 0.8, a: 0.5, b: 0.3, level: 2 }, "fail", { yes: 0.6, a: 0.5, b: 0.3, level: 2 }]), { label: "t", state: "x", questions }, 3);
    assert.equal(result.ok, true);
    if (result.ok) assert.ok(Math.abs(result.answers.yes.noul - 0.7) < 1e-9);
  });

  it("returns the failure when every sample fails", async () => {
    const result = await askAveraged(clientFrom(["fail"]), { label: "t", state: "x", questions }, 3);
    assert.equal(result.ok ? null : result.reason, "http");
  });
});
