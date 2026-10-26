import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { NoteContent, NoteFile } from "@rh/shared";
import type { Clock, EventBus, Notes } from "../ports.ts";

/**
 * The agent's writable notes workspace: markdown files only, addressed by
 * relative `.md` paths. Writes are atomic (temp file then rename) and publish
 * a `{ type: "note", note }` event on the bus.
 */

const PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const MAX_SEGMENTS = 4;
const MAX_FILE_BYTES = 200 * 1024;
const MAX_FILES = 500;

const README = [
  "# Workspace",
  "",
  "The agent's durable notes workspace.",
  "",
  "- `theses/<SYMBOL>.md`: one living thesis per symbol, updated in place as the view changes.",
  "- `plan.md`: today's plan: regime, candidates, trigger levels, and entry budget.",
  "- `lessons.md`: durable lessons learned. Append dated paragraphs; never rewrite history.",
  "- `watchlist.md`: candidate notes for names under review.",
  "",
].join("\n");

let tmpCounter = 0;

function validateNotePath(path: string): string {
  if (typeof path !== "string" || !PATH_PATTERN.test(path) || !path.endsWith(".md")) {
    throw new Error(`invalid note path: ${path}`);
  }
  const segments = path.split("/");
  if (segments.length > MAX_SEGMENTS || segments.some((s) => s === "" || s === "." || s === "..")) {
    throw new Error(`invalid note path: ${path}`);
  }
  return path;
}

function countFiles(dir: string): number {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(full);
    else if (entry.isFile()) count += 1;
  }
  return count;
}

function collectNotes(dir: string, base: string, out: NoteFile[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectNotes(full, base, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const st = statSync(full);
      out.push({
        path: relative(base, full).split(sep).join("/"),
        size: st.size,
        updatedAt: Math.floor(st.mtimeMs),
      });
    }
  }
}

export function createNotes(deps: { dir: string; bus: EventBus; clock: Clock }): Notes {
  const { dir, bus, clock } = deps;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Best effort: the mode is already set when the directory is created.
  }
  // Seed the layout readme once; later edits belong to the agent.
  try {
    statSync(join(dir, "README.md"));
  } catch {
    writeFileSync(join(dir, "README.md"), README, "utf8");
  }

  async function writeNote(path: string, content: string): Promise<NoteFile> {
    const valid = validateNotePath(path);
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_FILE_BYTES) throw new Error(`note too large: ${valid}`);
    const full = join(dir, valid);
    let exists = true;
    try {
      statSync(full);
    } catch {
      exists = false;
    }
    if (!exists && countFiles(dir) >= MAX_FILES) {
      throw new Error(`workspace file limit reached (${MAX_FILES})`);
    }
    mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
    const tmp = join(dirname(full), `.tmp-${process.pid}-${tmpCounter++}`);
    try {
      writeFileSync(tmp, content, "utf8");
      renameSync(tmp, full);
    } catch (error) {
      try {
        unlinkSync(tmp);
      } catch {
        // The temp file may never have been created; nothing to clean up.
      }
      throw error;
    }
    const note: NoteFile = { path: valid, size: bytes, updatedAt: clock.now() };
    bus.publish({ type: "note", note });
    return note;
  }

  return {
    async list(): Promise<NoteFile[]> {
      const out: NoteFile[] = [];
      collectNotes(dir, dir, out);
      out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      return out;
    },

    async read(path: string): Promise<NoteContent | undefined> {
      const valid = validateNotePath(path);
      const full = join(dir, valid);
      let raw: string;
      try {
        raw = readFileSync(full, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
      const st = statSync(full);
      return { path: valid, content: raw, updatedAt: Math.floor(st.mtimeMs) };
    },

    write: writeNote,
  };
}
