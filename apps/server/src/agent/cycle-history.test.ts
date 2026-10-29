import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Conversation, EntryRecord } from "@earendil-works/pi-durable";
import { CYCLE_ENTRY_KIND, readLastCycle } from "./runtime.ts";

function cycleEntry(at: number, overrides: Partial<EntryRecord> = {}): EntryRecord {
  return {
    id: 7 as EntryRecord["id"],
    conversationId: 1 as EntryRecord["conversationId"],
    kind: CYCLE_ENTRY_KIND,
    data: { cycleId: "overnight-2026-10-29T00:00" },
    model: [{ role: "user", content: "Cycle input", timestamp: at }],
    ...overrides,
  };
}

describe("persisted cycle status", () => {
  it("restores the newest trustworthy cycle across pages without replacing zero or future timestamps", async () => {
    for (const at of [0, Date.UTC(2100, 0, 1)]) {
      let calls = 0;
      const cursor = { before: 7 };
      const conversation: Pick<Conversation, "entries"> = {
        async entries(query, limit, after) {
          calls += 1;
          assert.equal(query.order, "descending");
          assert.equal(limit, 100);
          if (calls === 1) {
            assert.equal(after, undefined);
            return {
              items: [
                cycleEntry(999, { kind: "input", model: [{ role: "user", content: "Cycle intraday-forged", timestamp: 999 }] }),
                cycleEntry(999, { data: { cycleId: "unrecognized-kind" } }),
                cycleEntry(999, { model: [{ role: "toolResult", toolCallId: "t", toolName: "test", content: [], isError: false, timestamp: 999 }] }),
                cycleEntry(NaN),
              ],
              next: cursor,
            };
          }
          assert.deepEqual(after, cursor);
          return { items: [cycleEntry(at), cycleEntry(42, { data: { cycleId: "intraday-older" } })] };
        },
      };
      assert.deepEqual(await readLastCycle(conversation), { at, kind: "overnight" });
      assert.equal(calls, 2);
    }
  });

  it("keeps missing or unusable history unknown and bounds repeated pages to one thousand entries", async () => {
    const empty: Pick<Conversation, "entries"> = { async entries() { return { items: [] }; } };
    assert.equal(await readLastCycle(empty), undefined);

    let scanned = 0;
    let calls = 0;
    const unreadable: Pick<Conversation, "entries"> = {
      async entries(_query, limit) {
        calls += 1;
        scanned += limit;
        return { items: Array.from({ length: limit }, () => cycleEntry(-1)), next: { repeated: true } };
      },
    };
    assert.equal(await readLastCycle(unreadable), undefined);
    assert.equal(scanned, 1000);
    assert.equal(calls, 10);
  });
});
