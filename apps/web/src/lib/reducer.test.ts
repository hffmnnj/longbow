import { describe, expect, it } from "vitest";
import type { ChatMessage, JournalEntry, OrderRecord, StatusResponse } from "@rh/shared";
import { addOutbox, applyEvent, emptyState, failOutbox } from "./reducer.ts";
import { fixtureOrder, fixtureStatus } from "./mock/fixtures.ts";

const msg = (id: string, at: number, role: ChatMessage["role"], text = id): ChatMessage => ({
  id,
  at,
  role,
  text,
});
const entry = (id: string, at: number, summary = id): JournalEntry => ({
  id,
  at,
  action: "hold",
  summary,
  rationale: "r",
  evidence: [],
});

describe("applyEvent", () => {
  it("replaces status wholesale", () => {
    const a = fixtureStatus("default");
    const b: StatusResponse = { ...a, halts: ["kill_switch"] };
    const s = applyEvent(applyEvent(emptyState(), { type: "status", status: a }), {
      type: "status",
      status: b,
    });
    expect(s.status).toBe(b);
  });

  it("upserts messages by id and keeps chronological order", () => {
    let s = emptyState();
    s = applyEvent(s, { type: "message", message: msg("b", 20, "user") });
    s = applyEvent(s, { type: "message", message: msg("a", 10, "cycle") });
    s = applyEvent(s, { type: "message", message: msg("b", 20, "user", "edited") });
    expect(s.messages.map((m) => m.id)).toEqual(["a", "b"]);
    expect(s.messages[1]?.text).toBe("edited");
  });

  it("accumulates deltas until the committed assistant message arrives", () => {
    let s = emptyState();
    s = applyEvent(s, { type: "delta", text: "Looking at " });
    s = applyEvent(s, { type: "delta", text: "SPY." });
    expect(s.draft).toBe("Looking at SPY.");
    s = applyEvent(s, { type: "message", message: msg("t1", 5, "tool") });
    expect(s.draft).toBe("Looking at SPY.");
    s = applyEvent(s, { type: "message", message: msg("m1", 6, "assistant", "Looking at SPY.") });
    expect(s.draft).toBe("");
    expect(s.messages).toHaveLength(2);
  });

  it("drops a stale draft when the agent stops running", () => {
    const running = fixtureStatus("default");
    running.agent.state = "running";
    const idle = fixtureStatus("default");
    idle.agent.state = "idle";
    let s = applyEvent(emptyState(), { type: "delta", text: "partial" });
    s = applyEvent(s, { type: "status", status: running });
    expect(s.draft).toBe("partial");
    s = applyEvent(s, { type: "status", status: idle });
    expect(s.draft).toBe("");
  });

  it("keeps journal and orders newest first and updates in place", () => {
    let s = emptyState();
    s = applyEvent(s, { type: "journal", entry: entry("j1", 100) });
    s = applyEvent(s, { type: "journal", entry: entry("j2", 200) });
    s = applyEvent(s, { type: "journal", entry: entry("j1", 100, "updated") });
    expect(s.journal.map((j) => j.id)).toEqual(["j2", "j1"]);
    expect(s.journal[1]?.summary).toBe("updated");

    const o1: OrderRecord = { ...fixtureOrder("o1", "pending_approval"), createdAt: 1 };
    const o2: OrderRecord = { ...fixtureOrder("o2", "pending_approval"), createdAt: 2 };
    s = applyEvent(s, { type: "order", order: o1 });
    s = applyEvent(s, { type: "order", order: o2 });
    s = applyEvent(s, { type: "order", order: { ...o1, status: "submitted" } });
    expect(s.orders.map((o) => o.id)).toEqual(["o2", "o1"]);
    expect(s.orders[1]?.status).toBe("submitted");
  });

  it("does not mutate the previous state", () => {
    const before = emptyState();
    applyEvent(before, { type: "delta", text: "x" });
    expect(before.draft).toBe("");
  });
});

describe("applyEvent: agent work", () => {
  const call = (name: string, durationMs?: number) => ({ name, summary: "{}", ...(durationMs ? { durationMs } : {}) });
  const codeMsg = (id: string, at: number): ChatMessage => ({ ...msg(id, at, "tool"), toolName: "codemode", code: "run()" });
  const resultMsg = (id: string, at: number): ChatMessage => ({ ...msg(id, at, "tool"), toolName: "codemode", calls: [call("a", 5)] });

  it("keeps live calls while the script runs and replaces them with the committed result", () => {
    let s = applyEvent(emptyState(), { type: "calls", calls: [call("a"), call("b", 9)] });
    expect(s.calls).toHaveLength(2);
    s = applyEvent(s, { type: "message", message: codeMsg("c1", 1) });
    expect(s.calls).toHaveLength(2);
    s = applyEvent(s, { type: "message", message: resultMsg("c2", 2) });
    expect(s.calls).toEqual([]);
  });

  it("upserts subagent runs newest first", () => {
    const run = (id: string, startedAt: number, status: "running" | "done" = "running") => ({
      id, role: "bull" as const, task: "t", startedAt, status,
    });
    let s = applyEvent(emptyState(), { type: "subagent", run: run("x", 10) });
    s = applyEvent(s, { type: "subagent", run: run("y", 20) });
    s = applyEvent(s, { type: "subagent", run: run("x", 10, "done") });
    expect(s.subagents.map((r) => [r.id, r.status])).toEqual([["y", "running"], ["x", "done"]]);
  });

  it("routes scoped message, delta and calls to the subagent transcript only", () => {
    let s = emptyState();
    s = applyEvent(s, { type: "delta", text: "lead ", conversationId: undefined });
    s = applyEvent(s, { type: "delta", text: "bull ", conversationId: "c-bull" });
    s = applyEvent(s, { type: "delta", text: "case", conversationId: "c-bull" });
    s = applyEvent(s, { type: "calls", calls: [call("q")], conversationId: "c-bull" });
    expect(s.draft).toBe("lead ");
    expect(s.calls).toEqual([]);
    expect(s.transcripts["c-bull"]).toMatchObject({ draft: "bull case", calls: [call("q")] });

    s = applyEvent(s, { type: "message", message: msg("a1", 5, "assistant", "final"), conversationId: "c-bull" });
    expect(s.messages).toEqual([]);
    expect(s.transcripts["c-bull"]?.messages.map((m) => m.id)).toEqual(["a1"]);
    expect(s.transcripts["c-bull"]?.draft).toBe("");
  });

  it("upserts notes by path and sorts them", () => {
    let s = applyEvent(emptyState(), { type: "note", note: { path: "theses/NVDA.md", size: 1, updatedAt: 1 } });
    s = applyEvent(s, { type: "note", note: { path: "plan.md", size: 1, updatedAt: 2 } });
    s = applyEvent(s, { type: "note", note: { path: "plan.md", size: 9, updatedAt: 3 } });
    expect(s.notes.map((n) => [n.path, n.size])).toEqual([["plan.md", 9], ["theses/NVDA.md", 1]]);
  });

  it("drops the matching outbox entry when the committed user message arrives", () => {
    let s = addOutbox(emptyState(), { id: "o1", text: "hello", at: 1 });
    s = addOutbox(s, { id: "o2", text: "again", at: 2 });
    s = applyEvent(s, { type: "message", message: msg("u1", 3, "user", "hello") });
    expect(s.outbox.map((o) => o.id)).toEqual(["o2"]);
    expect(failOutbox(s, "o2").outbox[0]?.failed).toBe(true);
  });
});
