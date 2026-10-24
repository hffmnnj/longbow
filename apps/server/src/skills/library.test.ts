import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSkillLibrary } from "./library.ts";

const BASE = "/tmp/opencode";
let root = "";

function skillMd(name: string, description: string | undefined, body: string): string {
  const front = description === undefined ? `name: ${name}` : `name: ${name}\ndescription: ${description}`;
  return `---\n${front}\n---\n\n${body}`;
}

before(() => {
  mkdirSync(BASE, { recursive: true });
  root = mkdtempSync(join(BASE, "skills-lib-"));
  mkdirSync(join(root, "trend", "data"), { recursive: true });
  writeFileSync(join(root, "trend", "SKILL.md"), skillMd("trend", "Trend following playbook.", "# Trend\n\nFollow the trend.\n"));
  writeFileSync(join(root, "trend", "reference.md"), "# Reference\n\nDetails.\n");
  writeFileSync(join(root, "trend", "data", "notes.txt"), "notes\n");
  mkdirSync(join(root, "bad"));
  writeFileSync(join(root, "bad", "SKILL.md"), skillMd("wrong", "Mismatched name.", "body\n"));
  mkdirSync(join(root, "nodesc"));
  writeFileSync(join(root, "nodesc", "SKILL.md"), skillMd("nodesc", undefined, "body\n"));
  mkdirSync(join(root, "empty"));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("skill library", () => {
  it("lists_valid_skills_and_skips_invalid_ones", () => {
    const library = createSkillLibrary(root);
    assert.deepEqual(library.list(), [{ name: "trend", description: "Trend following playbook." }]);
  });

  it("returns_an_empty_list_when_the_folder_is_missing", () => {
    assert.deepEqual(createSkillLibrary(join(root, "nope")).list(), []);
  });

  it("loads_a_skill_body_without_frontmatter_and_its_files", () => {
    const skill = createSkillLibrary(root).get("trend");
    assert.ok(skill);
    assert.equal(skill.name, "trend");
    assert.equal(skill.description, "Trend following playbook.");
    assert.equal(skill.body, "# Trend\n\nFollow the trend.\n");
    assert.deepEqual(skill.files, ["data/notes.txt", "reference.md"]);
  });

  it("returns_undefined_for_mismatched_and_missing_skills", () => {
    const library = createSkillLibrary(root);
    assert.equal(library.get("bad"), undefined);
    assert.equal(library.get("nodesc"), undefined);
    assert.equal(library.get("missing"), undefined);
  });

  it("reads_a_skill_file", async () => {
    const text = await createSkillLibrary(root).readFile("trend", "reference.md");
    assert.equal(text, "# Reference\n\nDetails.\n");
  });

  it("rejects_parent_and_absolute_paths", async () => {
    const library = createSkillLibrary(root);
    await assert.rejects(() => library.readFile("trend", "../x"), /invalid skill file path/);
    await assert.rejects(() => library.readFile("trend", "/abs/path.md"), /invalid skill file path/);
  });

  it("rejects_symlinks_that_escape_the_skill_folder", async () => {
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "secret\n");
    symlinkSync(outside, join(root, "trend", "link.md"));
    await assert.rejects(() => createSkillLibrary(root).readFile("trend", "link.md"), /escapes/);
  });
});
