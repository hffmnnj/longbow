import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { metaProvider } from "@earendil-works/pi-ai/providers/meta";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import {
  createRegistry,
  Harness,
  type Conversation,
  type EntryRecord,
  type Extension,
  type Harness as HarnessType,
  type Registry,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CODEMODE_TOOL_NAME, createCodemodeExtension, type CodemodeNamespace } from "@earendil-works/pi-durable/codemode";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import type { AgentStatus, ChatMessage, CycleKind, StatusResponse, ToolCallSummary } from "@rh/shared";
import type { AgentControl, Clock, Config, EventBus, Logger, ModelSpec } from "../ports.ts";
import { HELPER_REPORT_ENTRY_KIND } from "./background-subagents.ts";
import {
  credentialFilePath,
  FileCredentialStore,
  isAuthFailure,
  isAuthFileNewer,
  seedMetaCredential,
} from "./credential-store.ts";

/** Entry kind marking a cycle prompt, so the transcript maps it to the `cycle` chat role. */
export const CYCLE_ENTRY_KIND = "trader.cycle";

const CTX = BACKGROUND_CONTEXT;
const MAX_TOOL_TEXT = 2000;

/** Tool groups for the Code Mode prompt section and `searchTools()`, by name prefix. */
const CODEMODE_NAMESPACES: CodemodeNamespace[] = [
  { name: "robinhood", prefix: "rh_", description: "Robinhood Trading MCP: accounts, portfolio, positions, quotes, historicals, news, fundamentals, orders (read, review, cancel)." },
  { name: "market", prefix: "market_", description: "Free market data with structured JSON: daily bars, indicators, comparisons, earnings and economic calendars, VIX, Treasury yields." },
  { name: "sec", prefix: "sec_", description: "SEC EDGAR filings and XBRL financial facts." },
  { name: "skills", prefix: "skills_", description: "Trading playbooks and reference resources. Load a skill before applying it." },
  { name: "notes", prefix: "notes_", description: "Durable markdown workspace: theses/<SYMBOL>.md, plan.md, lessons.md, watchlist.md." },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Nested calls from a finished Code Mode result's `details.calls` or the live `pi.live.nestedTools` slots. */
export function codemodeCalls(details: unknown): ToolCallSummary[] | undefined {
  if (!isRecord(details) || !Array.isArray(details["calls"])) return undefined;
  const calls: ToolCallSummary[] = [];
  for (const call of details["calls"]) {
    if (!isRecord(call) || typeof call["name"] !== "string") continue;
    const error = typeof call["error"] === "string" ? call["error"] : undefined;
    const args = typeof call["args"] === "string" ? call["args"] : undefined;
    calls.push({
      name: call["name"],
      ...(call["status"] === "error" ? { isError: true } : {}),
      ...(error ?? args ? { summary: truncate(error ?? args ?? "", 300) } : {}),
      ...(typeof call["durationMs"] === "number" ? { durationMs: call["durationMs"] } : {}),
    });
  }
  return calls;
}

export interface TradingAgentDeps {
  config: Config;
  log: Logger;
  bus: EventBus;
  clock: Clock;
  extensions: Extension[];
  /** Reuse the live credential store without seeding a second refresh token. */
  credentialFile?: string;
  onRegistry?: (registry: Registry) => void;
  cycleInput: (kind: CycleKind, cycleId: string) => Promise<string>;
}

function etMinute(now: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function userText(message: UserMessage): string {
  return typeof message.content === "string"
    ? message.content
    : message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

function toolResultText(message: ToolResultMessage): string {
  return message.content.map((part) => (part.type === "text" ? part.text : "[image]")).join("\n");
}

function truncate(text: string, max = MAX_TOOL_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Name and role carried by a helper-report entry, for the UI. */
function helperTag(entry: EntryRecord): Pick<ChatMessage, "helperName" | "agentRole"> {
  if (entry.kind !== HELPER_REPORT_ENTRY_KIND || !isRecord(entry.data)) return {};
  const { name, role } = entry.data;
  return {
    ...(typeof name === "string" ? { helperName: name } : {}),
    ...(typeof role === "string" ? { agentRole: role } : {}),
  };
}

/** Map one transcript entry to chat messages for the UI. */
export function entryToMessages(entry: EntryRecord, at: number): ChatMessage[] {
  const model = entry.model ?? [];
  const out: ChatMessage[] = [];
  for (const message of model) {
    if (message.role === "user") {
      out.push({
        id: String(entry.id),
        at,
        role: entry.kind === CYCLE_ENTRY_KIND ? "cycle" : entry.kind === HELPER_REPORT_ENTRY_KIND ? "helper" : "user",
        text: userText(message),
        ...helperTag(entry),
      });
    } else if (message.role === "assistant") {
      const text = assistantText(message);
      if (text.trim() !== "") {
        out.push({ id: `a-${String(entry.id)}`, at, role: "assistant", text });
      }
      for (const part of message.content) {
        if (part.type === "toolCall") {
          const code = part.name === CODEMODE_TOOL_NAME && isRecord(part.arguments) && typeof part.arguments["code"] === "string"
            ? part.arguments["code"]
            : undefined;
          out.push({
            id: `t-${String(entry.id)}-${part.id}`,
            at,
            role: "tool",
            text: code !== undefined ? "codemode" : `${part.name}(${JSON.stringify(part.arguments).slice(0, 500)})`,
            toolName: part.name,
            ...(code !== undefined ? { code } : {}),
          });
        }
      }
    } else if (message.role === "toolResult") {
      const calls = message.toolName === CODEMODE_TOOL_NAME ? codemodeCalls(message.details) : undefined;
      out.push({
        id: `r-${String(entry.id)}`,
        at,
        role: "tool",
        text: truncate(toolResultText(message)),
        toolName: message.toolName,
        isError: message.isError || undefined,
        ...(calls !== undefined ? { calls } : {}),
      });
    }
  }
  return out;
}

export class TradingAgent implements AgentControl {
  private readonly deps: TradingAgentDeps;
  private readonly clock: Clock;
  private harness: HarnessType | undefined;
  private conversation: Conversation | undefined;
  private activeCycleId: string | undefined;
  private runningCount = 0;
  private lastCycleAt: number | undefined;
  private lastCycleKind: CycleKind | undefined;
  private nextCycleAt: number | undefined;
  private nextCycleKind: CycleKind | undefined;
  private lastError: string | undefined;
  private authFailed: string | undefined;
  private activeModel: ModelSpec | undefined;
  private lastPublishedState: AgentStatus["state"] | undefined;
  private statusSnapshot: (() => Omit<StatusResponse, "agent"> | Promise<Omit<StatusResponse, "agent">>) | undefined;
  private sandbox: CodemodeSandbox | undefined;
  private readonly watched = new Set<string>();

  private constructor(deps: TradingAgentDeps, clock: Clock) {
    this.deps = deps;
    this.clock = clock;
  }

  static async open(deps: TradingAgentDeps): Promise<TradingAgent> {
    const agent = new TradingAgent(deps, deps.clock);
    await agent.openInner();
    return agent;
  }

  private async openInner(): Promise<void> {
    const { config, log } = this.deps;
    await mkdir(config.DATA_DIR, { recursive: true, mode: 0o700 });
    if (this.deps.credentialFile === undefined) await this.ensureCredential();
    const storage = await openNodeSqliteStorage(join(config.DATA_DIR, "durable.sqlite"));
    const credentials = new FileCredentialStore(this.deps.credentialFile ?? credentialFilePath(config.DATA_DIR));
    const models = createModels({ credentials });
    models.setProvider(metaProvider());
    models.setProvider(openaiCodexProvider());
    const main = await this.resolveMainModel(credentials);
    this.activeModel = main;
    const registry = createRegistry();
    for (const extension of this.deps.extensions) registry.install(extension);
    this.deps.onRegistry?.(registry);
    // Code Mode is the model's only tool: every other tool is called from its scripts.
    this.sandbox = new CodemodeSandbox({ memoryLimitBytes: 256 * 1024 * 1024 });
    const codemode = createCodemodeExtension({ sandbox: this.sandbox, namespaces: CODEMODE_NAMESPACES, models: false, inlineBudget: 8000 });
    registry.install(codemode);
    const codemodeTool = codemode.tools?.find((tool) => tool.name === CODEMODE_TOOL_NAME);
    if (codemodeTool === undefined) throw new Error("Code Mode tool missing from its extension");
    const harness = await Harness.open(
      storage,
      {
        models,
        registry,
        settings: {
          stream: { timeoutMs: 180_000 },
          retry: { maxRetries: 3 },
          compaction: { enabled: true, reserveTokens: 16384, backgroundTokens: 32768, keepRecentTokens: 40000 },
          toolExecution: "parallel",
        },
        onReport: (error) => {
          if (isAuthFailure(error)) {
            const message = error instanceof Error ? error.message : String(error);
            this.authFailed = message.split("\n")[0]?.slice(0, 200) ?? "Muse session expired";
          } else if (error instanceof Error) {
            this.lastError = error.message.slice(0, 300);
          } else {
            this.lastError = String(error).slice(0, 300);
          }
          this.maybePublishStatus();
        },
      },
      CTX,
    );
    this.harness = harness;
    const conversation = await harness.root(CTX, {
      agent: { model: { provider: main.provider, modelId: main.modelId }, thinkingLevel: main.thinkingLevel },
    });
    // An existing conversation keeps its stored model; pin it to the current one.
    await conversation.configure(
      { model: { provider: main.provider, modelId: main.modelId }, thinkingLevel: main.thinkingLevel, modelTools: [codemodeTool] },
      CTX,
    );
    this.conversation = conversation;
    await this.watchConversation(conversation);
    harness.resume();
    log.info("agent open", { model: `${main.provider}/${main.modelId}#${main.thinkingLevel}` });
  }

  /** The configured main model, or the subagent model when its provider has no stored login. */
  private async resolveMainModel(credentials: FileCredentialStore): Promise<ModelSpec> {
    const { MAIN_MODEL, SUBAGENT_MODEL } = this.deps.config;
    if (MAIN_MODEL.provider === "meta") return MAIN_MODEL;
    if ((await credentials.read(MAIN_MODEL.provider).catch(() => undefined)) !== undefined) return MAIN_MODEL;
    this.deps.log.warn("main model has no login; falling back to the subagent model", {
      main: `${MAIN_MODEL.provider}/${MAIN_MODEL.modelId}`,
      fallback: `${SUBAGENT_MODEL.provider}/${SUBAGENT_MODEL.modelId}`,
    });
    return SUBAGENT_MODEL;
  }

  /** Seed the Meta credential when missing or when the Muse auth file is newer. */
  private async ensureCredential(): Promise<void> {
    const { config, log } = this.deps;
    const store = new FileCredentialStore(credentialFilePath(config.DATA_DIR));
    const existing = await store.read("meta").catch(() => undefined);
    if (existing !== undefined && !(await isAuthFileNewer(config.MUSE_AUTH_FILE, config.DATA_DIR))) return;
    try {
      await seedMetaCredential(config.MUSE_AUTH_FILE, config.DATA_DIR);
      log.info("seeded meta credential from Muse auth file");
    } catch (error) {
      // No usable auth file: the agent will report needs_login on first model use.
      log.warn("could not seed meta credential", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  private requireConversation(): Conversation {
    if (this.conversation === undefined) throw new Error("Agent is not open");
    return this.conversation;
  }

  /** Cycle id of the run in progress, if any. */
  currentCycleId(): string | undefined {
    return this.activeCycleId;
  }

  /** Let main.ts feed scheduler output and status snapshots without widening the ports. */
  setStatusSnapshot(provider: () => Omit<StatusResponse, "agent"> | Promise<Omit<StatusResponse, "agent">>): void {
    this.statusSnapshot = provider;
  }

  setNextCycle(next: { at: number; kind: CycleKind } | undefined): void {
    this.nextCycleAt = next?.at;
    this.nextCycleKind = next?.kind;
    this.maybePublishStatus();
  }

  status(): AgentStatus {
    const running = this.runningCount > 0;
    let state: AgentStatus["state"];
    if (running) state = "running";
    else if (this.authFailed !== undefined) state = "needs_login";
    else if (this.lastError !== undefined) state = "error";
    else state = "idle";
    return {
      state,
      model: (this.activeModel ?? this.deps.config.MAIN_MODEL).modelId,
      ...(this.lastCycleAt !== undefined ? { lastCycleAt: this.lastCycleAt } : {}),
      ...(this.lastCycleKind !== undefined ? { lastCycleKind: this.lastCycleKind } : {}),
      ...(this.nextCycleAt !== undefined ? { nextCycleAt: this.nextCycleAt } : {}),
      ...(this.nextCycleKind !== undefined ? { nextCycleKind: this.nextCycleKind } : {}),
      ...(state === "needs_login" && this.authFailed !== undefined ? { lastError: this.authFailed } : {}),
      ...(state === "error" && this.lastError !== undefined ? { lastError: this.lastError } : {}),
    };
  }

  private maybePublishStatus(): void {
    const current = this.status().state;
    if (current === this.lastPublishedState) return;
    this.lastPublishedState = current;
    if (this.statusSnapshot === undefined) return;
    try {
      const snapshot = this.statusSnapshot();
      const publish = (rest: Omit<StatusResponse, "agent">): void => {
        try {
          this.deps.bus.publish({ type: "status", status: { ...rest, agent: this.status() } });
        } catch {
          // Publishing is best-effort; the HTTP layer always builds status fresh.
        }
      };
      if (snapshot instanceof Promise) void snapshot.then(publish).catch(() => {});
      else publish(snapshot);
    } catch {
      // Publishing is best-effort; the HTTP layer always builds status fresh.
    }
  }

  async runCycle(kind: CycleKind): Promise<void> {
    if (this.activeCycleId !== undefined) {
      this.deps.log.info("cycle skipped, a run is already in progress", {
        activeCycleId: this.activeCycleId,
        kind,
      });
      return;
    }
    const cycleId = `${kind}-${etMinute(this.clock.now())}`;
    const conversation = this.requireConversation();
    const content = await this.deps.cycleInput(kind, cycleId);
    this.activeCycleId = cycleId;
    this.runningCount += 1;
    this.lastCycleAt = this.clock.now();
    this.lastCycleKind = kind;
    this.maybePublishStatus();
    try {
      const submission = await conversation.submit(
        {
          type: "input",
          content,
          requestId: cycleId,
          entry: { kind: CYCLE_ENTRY_KIND, data: { cycleId } },
        },
        CTX,
      );
      // Clearing the flag is observer-owned: a settled wait means the run ended.
      void submission.wait(CTX).then(() => {
        if (this.activeCycleId === cycleId) this.activeCycleId = undefined;
        this.runningCount = Math.max(0, this.runningCount - 1);
        this.maybePublishStatus();
      }).catch(() => {
        if (this.activeCycleId === cycleId) this.activeCycleId = undefined;
        this.runningCount = Math.max(0, this.runningCount - 1);
        this.maybePublishStatus();
      });
    } catch (error) {
      this.activeCycleId = undefined;
      this.runningCount = Math.max(0, this.runningCount - 1);
      if (isAuthFailure(error)) {
        const message = error instanceof Error ? error.message : String(error);
        this.authFailed = message.split("\n")[0]?.slice(0, 200) ?? "Muse session expired";
      } else {
        this.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      }
      this.maybePublishStatus();
      throw error;
    }
  }

  async sendMessage(text: string): Promise<void> {
    const conversation = this.requireConversation();
    this.runningCount += 1;
    this.maybePublishStatus();
    try {
      const submission = await conversation.submit(
        { type: "input", content: text, requestId: randomUUID() },
        CTX,
      );
      void submission.wait(CTX).then(() => {
        this.runningCount = Math.max(0, this.runningCount - 1);
        this.maybePublishStatus();
      }).catch(() => {
        this.runningCount = Math.max(0, this.runningCount - 1);
        this.maybePublishStatus();
      });
    } catch (error) {
      this.runningCount = Math.max(0, this.runningCount - 1);
      if (isAuthFailure(error)) {
        const message = error instanceof Error ? error.message : String(error);
        this.authFailed = message.split("\n")[0]?.slice(0, 200) ?? "Muse session expired";
      } else {
        this.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      }
      this.maybePublishStatus();
      throw error;
    }
  }

  /** Accelerated replay must settle (including child work) before advancing its clock. */
  async abortCycle(): Promise<void> {
    await this.requireConversation().abort(CTX, { background: true });
  }

  /** Accelerated replay must settle (including child work) before advancing its clock. */
  async runCycleAndWait(kind: CycleKind, timeoutMs: number): Promise<"done" | "unanswered" | "timeout"> {
    if (this.activeCycleId !== undefined) throw new Error("A cycle is already in progress");
    const cycleId = `${kind}-${etMinute(this.clock.now())}`;
    const conversation = this.requireConversation();
    const content = await this.deps.cycleInput(kind, cycleId);
    this.activeCycleId = cycleId;
    this.runningCount += 1;
    this.lastCycleAt = this.clock.now();
    this.lastCycleKind = kind;
    this.maybePublishStatus();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const submission = await conversation.submit({ type: "input", content, requestId: cycleId,
        entry: { kind: CYCLE_ENTRY_KIND, data: { cycleId } } }, CTX);
      const outcome = await Promise.race([
        submission.wait(CTX).then((record) => record.status),
        new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); }),
      ]);
      if (outcome === "timeout") await conversation.abort(CTX, { background: true });
      return outcome;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.activeCycleId = undefined;
      this.runningCount = Math.max(0, this.runningCount - 1);
      this.maybePublishStatus();
    }
  }

  async listMessages(limit: number, conversationId?: string): Promise<ChatMessage[]> {
    const conversation = conversationId === undefined ? this.requireConversation() : await this.childConversation(conversationId);
    const newest: ChatMessage[] = [];
    let cursor: import("@earendil-works/pi-durable").Cursor | undefined;
    const take = Math.max(0, Math.floor(limit));
    if (take === 0) return [];
    const at = this.clock.now();
    while (newest.length < take) {
      const page = await conversation.entries({ order: "descending" }, 100, cursor, CTX);
      if (page.items.length === 0) break;
      for (const entry of page.items) {
        for (const message of entryToMessages(entry, at)) newest.push(message);
      }
      if (page.next === undefined) break;
      cursor = page.next;
    }
    // Newest-first walk: reverse to chronological, then cap.
    newest.reverse();
    return newest.slice(-take);
  }

  private async childConversation(id: string): Promise<Conversation> {
    const harness = this.harness;
    if (harness === undefined) throw new Error("Agent is not open");
    const numeric = Number(id);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new Error("Unknown conversation");
    const conversation = await harness.conversation(numeric as Parameters<HarnessType["conversation"]>[0], CTX);
    if (conversation === undefined) throw new Error("Unknown conversation");
    return conversation;
  }

  /** Stream a subagent's transcript to the UI while it runs. */
  async watchChild(id: string): Promise<void> {
    await this.watchConversation(await this.childConversation(id), id);
  }

  /** Publishes committed entries, streaming text, and live Code Mode calls for one conversation. */
  private async watchConversation(conversation: Conversation, childId?: string): Promise<void> {
    const key = childId ?? "root";
    if (this.watched.has(key)) return;
    this.watched.add(key);
    const scope = childId !== undefined ? { conversationId: childId } : {};
    const seenEntryIds = new Set<string>();
    let seenDelta = "";
    let seenCalls = "";
    const watch = await conversation.watch(CTX);
    // Baseline: committed entries already in the transcript need no replay.
    for (const entry of watch.value.entries) seenEntryIds.add(String(entry.id));
    watch.start(async (value) => {
      for (const entry of value.entries) {
        const id = String(entry.id);
        if (seenEntryIds.has(id)) continue;
        seenEntryIds.add(id);
        for (const message of entryToMessages(entry, this.clock.now())) {
          this.deps.bus.publish({ type: "message", message, ...scope });
        }
      }
      const live = value.docs["pi.live"] as
        | {
            generation?: { message?: { content?: { type?: string; text?: string }[] } };
            nestedTools?: { name: string; status: string; arguments?: unknown; summary?: { isError: boolean; durationMs?: number; error?: string } }[];
          }
        | undefined;
      const text = live?.generation?.message?.content
        ?.filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("") ?? "";
      if (text.startsWith(seenDelta) && text.length > seenDelta.length) {
        this.deps.bus.publish({ type: "delta", text: text.slice(seenDelta.length), ...scope });
        seenDelta = text;
      } else if (!text.startsWith(seenDelta)) {
        // New turn replaced the partial; resync without emitting a jump.
        seenDelta = text;
      }
      if (text === "") seenDelta = "";
      const calls: ToolCallSummary[] = (live?.nestedTools ?? []).map((slot) => ({
        name: slot.name,
        ...(slot.summary?.isError ? { isError: true } : {}),
        summary: truncate(slot.summary?.error ?? JSON.stringify(slot.arguments ?? {}), 300),
        ...(slot.summary?.durationMs !== undefined ? { durationMs: slot.summary.durationMs } : {}),
      }));
      const callsKey = JSON.stringify(calls);
      if (callsKey !== seenCalls) {
        seenCalls = callsKey;
        this.deps.bus.publish({ type: "calls", calls, ...scope });
      }
    });
  }

  async close(): Promise<void> {
    const harness = this.harness;
    this.harness = undefined;
    this.conversation = undefined;
    if (harness !== undefined) await harness.close(CTX);
    await this.sandbox?.close();
    this.sandbox = undefined;
  }
}

export type { Message };
