import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OrderIntent } from "@rh/shared";
import type { Logger } from "../ports.ts";
import type { SystemOneClient } from "./client.ts";
import { createEntryReview, entryState, judgeEntry, type EntryAnswers } from "./review.ts";
import type { AskResult, QuestionMap } from "./types.ts";

const NOW = Date.UTC(2026, 10, 2, 15, 0, 0);
const log: Logger = { info() {}, warn() {}, error() {}, child: () => log };

const intent: OrderIntent = {
  symbol: "AAPL",
  side: "buy",
  quantity: 3,
  orderType: "limit",
  limitPrice: 150,
  timeInForce: "day",
  invalidationPrice: 140,
  timeStopDate: "2026-11-12",
  thesis: "Pullback to the rising 20-day average in an uptrend with volume drying up on the dip.",
  probabilityWin: 0.58,
  expectedGainPct: 9,
  expectedLossPct: 4,
  estimatedCostPct: 0.4,
  evidence: ["market_indicators showed close above SMA50 and SMA200 at 14:50 ET", "rh_quote showed a 4 cent spread at 14:55 ET"],
};

const answers = (over: Partial<Record<keyof EntryAnswers, number>> = {}): EntryAnswers => {
  const base = { thesis_supported: 0.9, thesis_consistent: 0.9, evidence_specific: 0.8, chasing: 0.1, binary_event: 0.05, ...over };
  return Object.fromEntries(Object.entries(base).map(([id, noul]) => [id, { type: "noul", noul }])) as unknown as EntryAnswers;
};

function fakeClient(result: AskResult<QuestionMap> | (() => Promise<AskResult<QuestionMap>>), seen: unknown[] = []): SystemOneClient {
  return {
    ask: (async (request: { state: unknown }) => {
      seen.push(request.state);
      return typeof result === "function" ? result() : result;
    }) as SystemOneClient["ask"],
    status: () => ({ state: "ok", model: "m", calls24h: 0, inputTokens24h: 0 }),
    available: () => true,
  };
}

const ok = (a: EntryAnswers): AskResult<QuestionMap> => ({ ok: true, answers: a as never, model: "m", latencyMs: 5, inputTokens: 100, cached: false });

describe("judgeEntry", () => {
  it("is clear when every signal is healthy", () => {
    assert.deepEqual(judgeEntry(answers()), { verdict: "clear", flags: [] });
  });
  it("is a concern only when support or consistency is a confident no", () => {
    assert.equal(judgeEntry(answers({ thesis_supported: 0.1 })).verdict, "concern");
    assert.equal(judgeEntry(answers({ thesis_consistent: 0.2 })).verdict, "concern");
    assert.equal(judgeEntry(answers({ thesis_supported: 0.4 })).verdict, "caution");
  });
  it("cautions on chasing, vague evidence, and binary events without a concern", () => {
    for (const over of [{ chasing: 0.9 }, { evidence_specific: 0.2 }, { binary_event: 0.8 }] as const) {
      const judged = judgeEntry(answers(over));
      assert.equal(judged.verdict, "caution");
      assert.equal(judged.flags.length, 1);
    }
  });
});

describe("entryState", () => {
  it("sends bands and the agent's own text, with no raw price or quantity", () => {
    const state = JSON.stringify(entryState(intent, NOW));
    assert.match(state, /favorable, 2 to 3 to 1/);
    assert.match(state, /time stop within a (week|month)/);
    assert.ok(!state.includes("150"), "no price in state");
    assert.ok(!state.includes("2026-11-12"), "no calendar date in state");
  });
});

describe("createEntryReview", () => {
  it("advise mode reports a concern but never fails the check", async () => {
    const review = createEntryReview({ client: fakeClient(ok(answers({ thesis_supported: 0.1 }))), clock: { now: () => NOW }, log });
    const check = await review(intent, "advise");
    assert.equal(check?.rule, "system_one");
    assert.equal(check?.ok, true);
    assert.match(check?.detail ?? "", /^concern \(advice only\)/);
  });

  it("block mode fails the check on a concern and passes a clear read", async () => {
    const blocked = await createEntryReview({ client: fakeClient(ok(answers({ thesis_consistent: 0.1 }))), clock: { now: () => NOW }, log })(intent, "block");
    assert.equal(blocked?.ok, false);
    assert.match(blocked?.detail ?? "", /\(blocked\)/);
    const clear = await createEntryReview({ client: fakeClient(ok(answers())), clock: { now: () => NOW }, log })(intent, "block");
    assert.equal(clear?.ok, true);
    assert.match(clear?.detail ?? "", /^clear:/);
  });

  it("passes with a note when the model is unavailable", async () => {
    const review = createEntryReview({
      client: fakeClient({ ok: false, reason: "rate_limited", detail: "quota" }),
      clock: { now: () => NOW },
      log,
    });
    assert.deepEqual(await review(intent, "block"), { rule: "system_one", ok: true, detail: "not reviewed: rate_limited" });
  });

  it("passes with a note when the model is slower than the cap", async () => {
    const never = () => new Promise<AskResult<QuestionMap>>(() => {});
    const review = createEntryReview({ client: fakeClient(never), clock: { now: () => NOW }, log, timeoutMs: 20 });
    assert.deepEqual(await review(intent, "block"), { rule: "system_one", ok: true, detail: "not reviewed: timed out" });
  });

  it("does nothing when the gate is off", async () => {
    const seen: unknown[] = [];
    const review = createEntryReview({ client: fakeClient(ok(answers()), seen), clock: { now: () => NOW }, log });
    assert.equal(await review(intent, "off"), undefined);
    assert.equal(seen.length, 0);
  });
});
