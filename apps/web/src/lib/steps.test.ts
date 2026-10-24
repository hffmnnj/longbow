import { describe, expect, it } from "vitest";
import type { ChatMessage, SubagentRun } from "@rh/shared";
import { buildItems, cycleLabel, liveStepKey, matchRuns } from "./steps.ts";

const d = (role: string) => ({ name: "delegate", summary: `{"role":"${role}","symbol":"NVDA"}`, durationMs: 100 });

describe("matchRuns", () => {
  const run = (id: string, role: SubagentRun["role"], startedAt: number): SubagentRun => ({
    id, role, task: "t", startedAt, status: "done",
  });
  it("matches by role and order inside the step window", () => {
    const runs = [run("old", "bull", 1_000), run("b1", "bull", 100_000), run("r1", "bear", 100_200), run("b2", "bull", 100_400)];
    const hits = matchRuns([d("bear"), d("bull"), d("bull")], runs, 99_000, 105_000);
    expect(hits.map((h) => h?.id)).toEqual(["r1", "b1", "b2"]);
  });
});

describe("cycleLabel", () => {
  it.each([
    ["Cycle intraday-2026-10-26T10:30 (intraday).\nbody", "Intraday"],
    ["Cycle pre_open-2026-10-26T08:00 (pre_open).", "Pre-open"],
    ["Cycle x (post_close).", "Post-close"],
    ["Cycle y (overnight).", "Overnight"],
    ["Cycle z (manual).", "Manual"],
    ["Something else entirely", "Something else entirely"],
  ])("%s", (text, label) => expect(cycleLabel(text)).toBe(label));
});

describe("buildItems", () => {
  const m = (id: string, role: ChatMessage["role"], extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, at: 1, role, text: id, ...extra });
  it("pairs codemode script and result, and groups other tools", () => {
    const items = buildItems([
      m("t1", "tool", { toolName: "get_quote" }),
      m("t2", "tool", { toolName: "web_search" }),
      m("c1", "tool", { toolName: "codemode", code: "x" }),
      m("c2", "tool", { toolName: "codemode", calls: [] }),
      m("c3", "tool", { toolName: "codemode", code: "y" }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["tools", "step", "step"]);
    const [, a, b] = items;
    expect(a?.kind === "step" && a.result?.id).toBe("c2");
    expect(b?.kind === "step" && b.result).toBeUndefined();
  });

  it("pairs a late result with its script across assistant text and tracks the live step", () => {
    const items = buildItems([
      m("c1", "tool", { toolName: "codemode", code: "a" }),
      m("a1", "assistant"),
      m("c2", "tool", { toolName: "codemode", code: "b" }),
      m("r1", "tool", { toolName: "codemode", calls: [] }),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["step", "assistant", "step"]);
    const [first, , second] = items;
    expect(first?.kind === "step" && first.result?.id).toBe("r1");
    expect(liveStepKey(items)).toBe("c2");
  });
});
