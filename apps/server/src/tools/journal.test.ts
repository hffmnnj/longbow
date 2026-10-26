import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { JournalEntry, ServerEvent } from "@rh/shared";
import type { Clock, EventBus, Store } from "../ports.ts";
import { createJournalExtension } from "./journal.ts";

function fakeStore() {
  const entries: JournalEntry[] = [];
  const store = {
    addJournal: (entry: Omit<JournalEntry, "id">) => {
      const full: JournalEntry = { ...entry, id: `j${entries.length + 1}` };
      entries.push(full);
      return full;
    },
  } as unknown as Store;
  return { entries, store };
}

function fakeBus() {
  const events: ServerEvent[] = [];
  const bus = {
    publish: (event: ServerEvent) => {
      events.push(event);
    },
    subscribe: () => () => {},
  } as unknown as EventBus;
  return { events, bus };
}

const clock: Clock = { now: () => 1_791_234_567_000 };

function recordTool(deps: Parameters<typeof createJournalExtension>[0]): ToolRegistration {
  const ext = createJournalExtension(deps);
  assert.equal(ext.name, "journal");
  const tool = (ext.tools ?? []).find((t) => (t as { name: string }).name === "record_decision");
  assert.ok(tool, "expected record_decision tool");
  assert.equal((tool as unknown as ToolRegistration).replay, undefined);
  return tool as unknown as ToolRegistration;
}

const api = {} as never;
const context = { abortSignal: new AbortController().signal } as never;

describe("record_decision", () => {
  it("stores_and_publishes_an_entry_with_the_cycle_id", async () => {
    const { entries, store } = fakeStore();
    const { events, bus } = fakeBus();
    const tool = recordTool({ store, bus, clock, currentCycleId: () => "cycle-42" });

    const result = await tool.execute(
      {
        action: "hold",
        symbol: "SPY",
        summary: "Holding SPY into the close, no trigger hit",
        rationale: "Price stayed above invalidation and no planned trigger fired, so the protocol says hold.",
        confidence: 0.8,
        evidence: ["rh_quote showed SPY bid 500.10 ask 500.14 at 15:55 ET"],
        regime: "risk-on trend",
      },
      api,
      context,
    );

    assert.equal(entries.length, 1);
    const entry = entries[0]!;
    assert.equal(entry.cycleId, "cycle-42");
    assert.equal(entry.at, clock.now());
    assert.equal(entry.action, "hold");
    assert.equal(entry.symbol, "SPY");
    assert.equal(entry.regime, "risk-on trend");
    assert.deepEqual(entry.evidence, ["rh_quote showed SPY bid 500.10 ask 500.14 at 15:55 ET"]);

    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: "journal", entry });

    const text = (result.output ?? []).map((part) => (part as { text?: string }).text ?? "").join("\n");
    assert.ok(text.includes(entry.id), "result names the entry id");
  });

  it("works_without_optional_fields_and_without_a_cycle", async () => {
    const { entries, store } = fakeStore();
    const { events, bus } = fakeBus();
    const tool = recordTool({ store, bus, clock, currentCycleId: () => undefined });

    const result = await tool.execute(
      {
        action: "none",
        summary: "Overnight scan, nothing to do",
        rationale: "Market closed and no thesis changed.",
        evidence: ["web_search returned no new SPY news at 02:10 ET"],
      },
      api,
      context,
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.cycleId, undefined);
    assert.equal(entries[0]!.action, "none");
    assert.ok(!result.isError);
    assert.equal(events.length, 1);
  });
});
