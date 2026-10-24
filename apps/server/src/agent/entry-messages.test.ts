import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { entryToMessages } from "./runtime.ts";
import { HELPER_REPORT_ENTRY_KIND } from "./background-subagents.ts";

function inputEntry(kind: string, data?: Record<string, string>): EntryRecord {
  return {
    id: 7,
    kind,
    ...(data === undefined ? {} : { data }),
    model: [{ role: "user", content: "Background helper \"nvda-date\" (researcher) reported.", timestamp: 0 }],
  } as unknown as EntryRecord;
}

describe("entryToMessages", () => {
  it("shows a helper report as the helper's message, not the owner's", () => {
    const [message] = entryToMessages(inputEntry(HELPER_REPORT_ENTRY_KIND, { name: "nvda-date", role: "researcher" }), 1);
    assert.equal(message?.role, "helper");
    assert.equal(message?.helperName, "nvda-date");
    assert.equal(message?.agentRole, "researcher");
  });

  it("keeps an untagged input as the owner's message", () => {
    const [message] = entryToMessages(inputEntry("input"), 1);
    assert.equal(message?.role, "user");
    assert.equal(message?.helperName, undefined);
  });
});
