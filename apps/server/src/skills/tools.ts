import { Type, type Static } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section, type Extension } from "@earendil-works/pi-durable";
import type { Notes, SkillLibrary } from "../ports.ts";

/**
 * The "skills" extension: trading playbooks plus the agent's durable notes
 * workspace. Every tool declares a `structuredOutputSchema` so Code Mode
 * scripts (`await tools.skills_load({ name })`) get typed values. Only
 * `notes_write` and `notes_append` are not replay-safe (a rerun could duplicate a write); the rest are reads.
 */

export interface SkillsExtensionDeps {
  library: SkillLibrary;
  notes: Notes;
}

const skillSchema = Type.Object({
  name: Type.String({ description: "Skill folder name." }),
  description: Type.String({ description: "One-line summary from the skill frontmatter." }),
  body: Type.String({ description: "SKILL.md body with the frontmatter removed." }),
  files: Type.Array(Type.String(), { description: "Other files in the skill folder, relative to it." }),
});

const skillFileSchema = Type.Object({
  name: Type.String({ description: "Skill folder name." }),
  path: Type.String({ description: "File path relative to the skill folder." }),
  content: Type.String({ description: "File content." }),
});

const noteFileSchema = Type.Object({
  path: Type.String({ description: "Note path relative to the workspace." }),
  size: Type.Number({ description: "Content size in bytes." }),
  updatedAt: Type.Number({ description: "Last write time, epoch milliseconds." }),
});

const noteContentSchema = Type.Object({
  path: Type.String({ description: "Note path relative to the workspace." }),
  content: Type.String({ description: "Markdown content." }),
  updatedAt: Type.Number({ description: "Last write time, epoch milliseconds." }),
});

const notesListSchema = Type.Object({
  files: Type.Array(noteFileSchema, { description: "Notes in the workspace, oldest path first." }),
});

const skillsLoadSchema = Type.Object({
  name: Type.String({ description: "Skill folder name to load.", minLength: 1 }),
});

const skillsReadFileSchema = Type.Object({
  name: Type.String({ description: "Skill folder name.", minLength: 1 }),
  path: Type.String({ description: "File path relative to the skill folder.", minLength: 1 }),
});

const notesReadSchema = Type.Object({
  path: Type.String({ description: "Note path, a relative .md path such as theses/SPY.md.", minLength: 1 }),
});

const notesWriteSchema = Type.Object({
  path: Type.String({ description: "Note path, a relative .md path such as plan.md.", minLength: 1 }),
  content: Type.String({ description: "Full markdown content, replacing the note.", maxLength: 200 * 1024 }),
});

const notesAppendSchema = Type.Object({
  path: Type.String({ description: "Note path, a relative .md path such as lessons.md.", minLength: 1 }),
  text: Type.String({ description: "Paragraph to append under a dated heading.", minLength: 1 }),
});

function errorResult(text: string) {
  return { output: [{ type: "text" as const, text }], isError: true };
}

function skillsSectionText(library: SkillLibrary): string {
  const lines = library.list().map((skill) => `- ${skill.name}: ${skill.description}`);
  return [
    "Trading skills:",
    ...(lines.length > 0 ? lines : ["(none installed)"]),
    "Load a skill with skills_load before applying it; do not act on this catalog alone.",
  ].join("\n");
}

export function createSkillsExtension(deps: SkillsExtensionDeps): Extension {
  const { library, notes } = deps;

  const skillsLoad = defineTool({
    name: "skills_load",
    description: "Load a trading skill by name. Returns the full SKILL.md body and its file list.",
    parameters: skillsLoadSchema,
    structuredOutputSchema: skillSchema,
    replay: "safe",
    async execute(args: Static<typeof skillsLoadSchema>) {
      const skill = library.get(args.name);
      if (!skill) return errorResult(`Unknown skill: ${args.name}.`);
      const fileList =
        skill.files.length === 0 ? "(no additional files)" : skill.files.map((f) => `- ${f}`).join("\n");
      return {
        output: [{ type: "text" as const, text: `${skill.body}\n\nFiles:\n${fileList}` }],
        structuredOutput: { name: skill.name, description: skill.description, body: skill.body, files: [...skill.files] },
      };
    },
  });

  const skillsReadFile = defineTool({
    name: "skills_read_file",
    description: "Read one file inside a skill folder, such as a referenced example or checklist.",
    parameters: skillsReadFileSchema,
    structuredOutputSchema: skillFileSchema,
    replay: "safe",
    async execute(args: Static<typeof skillsReadFileSchema>) {
      let content: string;
      try {
        content = await library.readFile(args.name, args.path);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : `Cannot read ${args.path}.`);
      }
      return {
        output: [{ type: "text" as const, text: content }],
        structuredOutput: { name: args.name, path: args.path, content },
      };
    },
  });

  const notesList = defineTool({
    name: "notes_list",
    description: "List the notes in the durable workspace (theses, plan, lessons, watchlist).",
    parameters: Type.Object({}),
    structuredOutputSchema: notesListSchema,
    replay: "safe",
    async execute() {
      const files = await notes.list();
      const text =
        files.length === 0 ? "No notes yet." : files.map((f) => `- ${f.path} (${f.size} bytes)`).join("\n");
      return {
        output: [{ type: "text" as const, text }],
        structuredOutput: { files: files.map((f) => ({ path: f.path, size: f.size, updatedAt: f.updatedAt })) },
      };
    },
  });

  const notesRead = defineTool({
    name: "notes_read",
    description: "Read one note from the durable workspace by its relative .md path.",
    parameters: notesReadSchema,
    structuredOutputSchema: noteContentSchema,
    replay: "safe",
    async execute(args: Static<typeof notesReadSchema>) {
      let note;
      try {
        note = await notes.read(args.path);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : `Cannot read note ${args.path}.`);
      }
      if (!note) return errorResult(`Note not found: ${args.path}.`);
      return {
        output: [{ type: "text" as const, text: note.content }],
        structuredOutput: { path: note.path, content: note.content, updatedAt: note.updatedAt },
      };
    },
  });

  const notesWrite = defineTool({
    name: "notes_write",
    description:
      "Write a note in the durable workspace, replacing its content. Use for theses and the daily plan.",
    parameters: notesWriteSchema,
    structuredOutputSchema: noteFileSchema,
    async execute(args: Static<typeof notesWriteSchema>) {
      let note;
      try {
        note = await notes.write(args.path, args.content);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : `Cannot write note ${args.path}.`);
      }
      return {
        output: [{ type: "text" as const, text: `Wrote ${note.path} (${note.size} bytes).` }],
        structuredOutput: { path: note.path, size: note.size, updatedAt: note.updatedAt },
      };
    },
  });

  const notesAppend = defineTool({
    name: "notes_append",
    description:
      "Append a dated paragraph to a note, creating it when missing. Use for lessons.md; never rewrite history.",
    parameters: notesAppendSchema,
    structuredOutputSchema: noteFileSchema,
    async execute(args: Static<typeof notesAppendSchema>) {
      let existing;
      try {
        existing = await notes.read(args.path);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : `Cannot read note ${args.path}.`);
      }
      const date = new Date().toISOString().slice(0, 10);
      const entry = `## ${date}\n\n${args.text}\n`;
      const base = existing?.content ?? "";
      const sep = base === "" ? "" : base.endsWith("\n\n") ? "" : base.endsWith("\n") ? "\n" : "\n\n";
      let note;
      try {
        note = await notes.write(args.path, `${base}${sep}${entry}`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : `Cannot write note ${args.path}.`);
      }
      return {
        output: [{ type: "text" as const, text: `Appended to ${note.path} (${note.size} bytes).` }],
        structuredOutput: { path: note.path, size: note.size, updatedAt: note.updatedAt },
      };
    },
  });

  return defineExtension({
    name: "skills",
    sections: [section("skills", () => skillsSectionText(library))],
    tools: [skillsLoad, skillsReadFile, notesList, notesRead, notesWrite, notesAppend],
  });
}
