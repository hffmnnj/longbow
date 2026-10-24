import type { ChatMessage, CycleKind, SubagentRun, ToolCallSummary } from "@rh/shared";
import { delegateRole } from "./toolMeta";

export const isRunning = (c: ToolCallSummary) => c.durationMs === undefined && !c.isError;

/**
 * Match a step's delegate calls, in order, to subagent runs of the same role that started
 * inside the step's window. Returns one run (or undefined) per delegate call.
 */
export function matchRuns(
  calls: readonly ToolCallSummary[],
  runs: readonly SubagentRun[],
  from: number,
  to: number,
): (SubagentRun | undefined)[] {
  const slack = 5_000;
  const pool = runs
    .filter((r) => r.startedAt >= from - slack && r.startedAt <= to + slack)
    .sort((a, b) => a.startedAt - b.startedAt);
  const used = new Set<string>();
  return calls.map((c) => {
    if (!c.name.endsWith("delegate")) return undefined;
    const role = delegateRole(c);
    const hit = pool.find((r) => !used.has(r.id) && (role === undefined || r.role === role));
    if (hit) used.add(hit.id);
    return hit;
  });
}

const CYCLE_LABEL: Record<CycleKind, string> = {
  pre_open: "Pre-open",
  intraday: "Intraday",
  post_close: "Post-close",
  overnight: "Overnight",
  manual: "Manual",
};

/** Divider label from a cycle message whose first line is `Cycle <id> (<kind>).` */
export function cycleLabel(text: string): string {
  const first = (text.split("\n", 1)[0] ?? "").replace(/^#+\s*/, "").trim();
  const kind = first.match(/\(([a-z_]+)\)/)?.[1] as CycleKind | undefined;
  if (kind && kind in CYCLE_LABEL) return CYCLE_LABEL[kind];
  return first.replace(/\.$/, "").slice(0, 80) || "Cycle";
}

export type FeedItem =
  | { kind: "cycle" | "user" | "assistant"; key: string; message: ChatMessage }
  | { kind: "step"; key: string; code: ChatMessage; result?: ChatMessage }
  | { kind: "tools"; key: string; messages: ChatMessage[] };

export const isCode = (m: ChatMessage) => m.role === "tool" && m.toolName === "codemode" && m.code !== undefined;
const isCodeResult = (m: ChatMessage) => m.role === "tool" && m.toolName === "codemode" && m.code === undefined;

/**
 * Fold the transcript into render items: Code Mode steps pair script and result; other tools group.
 * A result attaches to the oldest script still waiting for one, even when assistant text arrived in between.
 */
export function buildItems(messages: readonly ChatMessage[]): FeedItem[] {
  const out: FeedItem[] = [];
  const waiting: Extract<FeedItem, { kind: "step" }>[] = [];
  for (const m of messages) {
    if (isCode(m)) {
      const step: Extract<FeedItem, { kind: "step" }> = { kind: "step", key: m.id, code: m };
      out.push(step);
      waiting.push(step);
    } else if (isCodeResult(m)) {
      const step = waiting.shift();
      if (step) step.result = m;
      else out.push({ kind: "step", key: m.id, code: { ...m, code: "" }, result: m });
    } else if (m.role === "tool") {
      const last = out[out.length - 1];
      if (last?.kind === "tools") last.messages.push(m);
      else out.push({ kind: "tools", key: m.id, messages: [m] });
    } else {
      out.push({ kind: m.role, key: m.id, message: m });
    }
  }
  return out;
}

/** Key of the step that is still running: the newest script without a result. */
export function liveStepKey(items: readonly FeedItem[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.kind === "step" && !it.result) return it.key;
  }
  return undefined;
}
