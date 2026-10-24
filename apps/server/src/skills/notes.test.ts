import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ServerEvent } from "@rh/shared";
import type { Clock, EventBus } from "../ports.ts";
import { createNotes } from "./notes.ts";

const BASE = "/tmp/opencode";
let dir = "";

const events: ServerEvent[] = [];
const bus: EventBus = {
  publish: (event: ServerEvent) => {
    events.push(event);
  },
  subscribe: () => () => {},
};
const clock: Clock = { now: () => 1_791_234_567_000 };

before(() => {
  mkdirSync(BASE, { recursive: true });
  dir = mkdtempSync(join(BASE, "skills-notes-"));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("notes", () => {
  it("seeds_a_readme_explaining_the_layout", async () => {
    const notes = createNotes({ dir, bus, clock });
    const readme = await notes.read("README.md");
    assert.ok(readme);
    for (const layout of ["theses/<SYMBOL>.md", "plan.md", "lessons.md", "watchlist.md"]) {
      assert.ok(readme.content.includes(layout), `readme mentions ${layout}`);
    }
    const files = await notes.list();
    assert.ok(files.some((f) => f.path === "README.md"));
  });

  it("rejects_paths_that_escape_or_are_not_markdown", async () => {
    const notes = createNotes({ dir, bus, clock });
    await assert.rejects(() => notes.write("../evil.md", "x"), /invalid note path/);
    await assert.rejects(() => notes.write("/abs.md", "x"), /invalid note path/);
    await assert.rejects(() => notes.write("notes.txt", "x"), /invalid note path/);
    await assert.rejects(() => notes.read("../evil.md"), /invalid note path/);
  });

  it("writes_reads_and_publishes_a_note_event", async () => {
    events.length = 0;
    const notes = createNotes({ dir, bus, clock });
    const written = await notes.write("plan.md", "# Plan\n\nHold.\n");
    assert.equal(written.path, "plan.md");
    assert.equal(written.updatedAt, clock.now());
    assert.equal(written.size, Buffer.byteLength("# Plan\n\nHold.\n", "utf8"));

    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: "note", note: written });

    const read = await notes.read("plan.md");
    assert.ok(read);
    assert.equal(read.content, "# Plan\n\nHold.\n");
    assert.equal(await notes.read("missing.md"), undefined);
  });
});
