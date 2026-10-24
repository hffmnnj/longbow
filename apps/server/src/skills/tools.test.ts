import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { ServerEvent } from "@rh/shared";
import type { Clock, EventBus } from "../ports.ts";
import { createNotes } from "./notes.ts";
import { createSkillLibrary } from "./library.ts";
import { createSkillsExtension } from "./tools.ts";

const BASE = "/tmp/opencode";
let skillsDir = "";
let notesDir = "";

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
  skillsDir = mkdtempSync(join(BASE, "skills-tools-lib-"));
  notesDir = mkdtempSync(join(BASE, "skills-tools-notes-"));
  mkdirSync(join(skillsDir, "trend"), { recursive: true });
  writeFileSync(
    join(skillsDir, "trend", "SKILL.md"),
    "---\nname: trend\ndescription: Trend following playbook.\n---\n\n# Trend\n\nFollow the trend.\n",
  );
  writeFileSync(join(skillsDir, "trend", "reference.md"), "# Reference\n");
});

after(() => {
  rmSync(skillsDir, { recursive: true, force: true });
  rmSync(notesDir, { recursive: true, force: true });
});

function extension() {
  return createSkillsExtension({ library: createSkillLibrary(skillsDir), notes: createNotes({ dir: notesDir, bus, clock }) });
}

function tool(name: string): ToolRegistration {
  const ext = extension();
  assert.equal(ext.name, "skills");
  const found = (ext.tools ?? []).find((t) => (t as { name: string }).name === name);
  assert.ok(found, `expected ${name} tool`);
  return found as unknown as ToolRegistration;
}

const api = {} as never;
const context = { abortSignal: new AbortController().signal } as never;

function textOf(result: { output?: readonly unknown[] }): string {
  return (result.output ?? []).map((part) => (part as { text?: string }).text ?? "").join("\n");
}

describe("skills extension", () => {
  it("renders_a_stable_section_listing_every_skill", async () => {
    const ext = extension();
    const section = (ext.sections ?? []).find((s) => s.key === "skills");
    assert.ok(section, "expected skills section");
    const first = await section.render({} as never, {} as never);
    const second = await section.render({} as never, {} as never);
    assert.equal(first, second);
    assert.ok(first?.includes("- trend: Trend following playbook."));
    assert.ok(first?.includes("skills_load"));
  });

  it("loads_a_skill_as_structured_output", async () => {
    const result = await tool("skills_load").execute({ name: "trend" }, api, context);
    assert.ok(!result.isError);
    const structured = result.structuredOutput as { name: string; description: string; body: string; files: string[] };
    assert.equal(structured.name, "trend");
    assert.equal(structured.body, "# Trend\n\nFollow the trend.\n");
    assert.deepEqual(structured.files, ["reference.md"]);
    assert.ok(textOf(result).includes("# Trend"));
  });

  it("errors_on_an_unknown_skill", async () => {
    const result = await tool("skills_load").execute({ name: "missing" }, api, context);
    assert.ok(result.isError);
  });

  it("reads_skill_files_and_rejects_escapes", async () => {
    const ok = await tool("skills_read_file").execute({ name: "trend", path: "reference.md" }, api, context);
    assert.ok(!ok.isError);
    assert.equal((ok.structuredOutput as { content: string }).content, "# Reference\n");
    const bad = await tool("skills_read_file").execute({ name: "trend", path: "../x" }, api, context);
    assert.ok(bad.isError);
  });

  it("writes_a_note_and_publishes_an_event_but_is_not_replay_safe", async () => {
    events.length = 0;
    const write = tool("notes_write");
    assert.equal(write.replay, undefined);
    const result = await write.execute({ path: "plan.md", content: "# Plan\n" }, api, context);
    assert.ok(!result.isError);
    assert.equal((result.structuredOutput as { path: string }).path, "plan.md");
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "note");
  });

  it("reads_notes_and_errors_when_missing", async () => {
    const found = await tool("notes_read").execute({ path: "plan.md" }, api, context);
    assert.ok(!found.isError);
    assert.equal((found.structuredOutput as { content: string }).content, "# Plan\n");
    const missing = await tool("notes_read").execute({ path: "nope.md" }, api, context);
    assert.ok(missing.isError);
  });

  it("appends_dated_paragraphs_and_lists_notes", async () => {
    const append = tool("notes_append");
    await append.execute({ path: "lessons.md", text: "First lesson." }, api, context);
    const second = await append.execute({ path: "lessons.md", text: "Second lesson." }, api, context);
    assert.ok(!second.isError);
    const content = (await tool("notes_read").execute({ path: "lessons.md" }, api, context).then(
      (r) => r.structuredOutput as { content: string },
    )).content;
    assert.ok(content.includes("First lesson."));
    assert.ok(content.includes("Second lesson."));
    assert.match(content, /## \d{4}-\d{2}-\d{2}/);

    const listed = await tool("notes_list").execute({}, api, context);
    const files = (listed.structuredOutput as { files: { path: string }[] }).files.map((f) => f.path);
    assert.ok(files.includes("lessons.md"));
    assert.ok(files.includes("plan.md"));
  });

  it("marks_reads_replay_safe_and_writes_not", () => {
    for (const name of ["skills_load", "skills_read_file", "notes_list", "notes_read"]) {
      assert.equal(tool(name).replay, "safe", `${name} should be replay safe`);
    }
    for (const name of ["notes_write", "notes_append"]) {
      assert.notEqual(tool(name).replay, "safe", `${name} must not rerun after a crash`);
    }
  });
});
