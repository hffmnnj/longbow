import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { Skill, SkillSummary } from "@rh/shared";
import type { SkillLibrary } from "../ports.ts";

/**
 * File-backed trading skills. Each skill is a folder
 * `<rootDir>/<name>/SKILL.md` with simple `name:`/`description:` frontmatter.
 * The folder is rescanned on every call, so new skills appear without a restart.
 */

const NAME_PATTERN = /^[a-z0-9-]{1,64}$/;
const MAX_READ_FILE_BYTES = 256 * 1024;

interface ParsedSkill {
  name: string | undefined;
  description: string | undefined;
  body: string;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Split `---\nname: x\ndescription: y\n---\nbody`. Only single-line values. */
function parseSkillFile(raw: string): ParsedSkill | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) return undefined;
  let name: string | undefined;
  let description: string | undefined;
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!field) continue;
    if (field[1] !== "name" && field[1] !== "description") continue;
    const value = unquote((field[2] ?? "").trim());
    if (field[1] === "name" && name === undefined) name = value;
    if (field[1] === "description" && description === undefined) description = value;
  }
  return { name, description, body: raw.slice(match[0].length).replace(/^\r?\n/, "") };
}

function walkFiles(dir: string, base: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, base, out);
    } else if (entry.isFile()) {
      out.push(relative(base, full).split(sep).join("/"));
    }
  }
}

function loadSkill(rootDir: string, name: string): Skill | undefined {
  if (!NAME_PATTERN.test(name)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(join(rootDir, name, "SKILL.md"), "utf8");
  } catch {
    return undefined;
  }
  const parsed = parseSkillFile(raw);
  if (!parsed) return undefined;
  // The frontmatter name must equal the folder name.
  if (parsed.name !== name) return undefined;
  if (parsed.description === undefined || parsed.description.length === 0) return undefined;
  const skillDir = join(rootDir, name);
  const files: string[] = [];
  try {
    walkFiles(skillDir, skillDir, files);
  } catch {
    return undefined;
  }
  return {
    name,
    description: parsed.description,
    body: parsed.body,
    files: files.filter((f) => f !== "SKILL.md").sort(),
  };
}

export function createSkillLibrary(rootDir: string): SkillLibrary {
  return {
    list(): SkillSummary[] {
      let entries;
      try {
        entries = readdirSync(rootDir, { withFileTypes: true });
      } catch {
        return [];
      }
      const out: SkillSummary[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!NAME_PATTERN.test(entry.name)) continue;
        const skill = loadSkill(rootDir, entry.name);
        if (!skill) {
          console.warn(`skipping invalid skill: ${entry.name}`);
          continue;
        }
        out.push({ name: skill.name, description: skill.description });
      }
      out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return out;
    },

    get(name: string): Skill | undefined {
      return loadSkill(rootDir, name);
    },

    async readFile(name: string, path: string): Promise<string> {
      if (!NAME_PATTERN.test(name)) throw new Error(`unknown skill: ${name}`);
      if (typeof path !== "string" || path.length === 0 || isAbsolute(path)) {
        throw new Error(`invalid skill file path: ${path}`);
      }
      if (path.split("/").some((s) => s === "" || s === "." || s === "..")) {
        throw new Error(`invalid skill file path: ${path}`);
      }
      const skillDir = join(rootDir, name);
      if (!loadSkill(rootDir, name)) throw new Error(`unknown skill: ${name}`);
      const full = join(skillDir, path);
      let real: string;
      try {
        real = realpathSync(full);
      } catch {
        throw new Error(`skill file not found: ${path}`);
      }
      const base = realpathSync(skillDir);
      if (real !== base && !real.startsWith(base + sep)) {
        throw new Error(`skill file path escapes the skill folder: ${path}`);
      }
      if (statSync(real).size > MAX_READ_FILE_BYTES) {
        throw new Error(`skill file too large: ${path}`);
      }
      return readFileSync(real, "utf8");
    },
  };
}
