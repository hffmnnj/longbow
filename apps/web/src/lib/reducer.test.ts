import { describe, expect, it } from "vitest";
import type { ChatMessage, JournalEntry, OrderRecord, StatusResponse } from "@rh/shared";
import { applyEvent, emptyState } from "./reducer.ts";
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
