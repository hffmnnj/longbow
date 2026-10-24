import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { metaProvider } from "@earendil-works/pi-ai/providers/meta";
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
import type { AgentStatus, ChatMessage, CycleKind, StatusResponse } from "@rh/shared";
import type { AgentControl, Clock, Config, EventBus, Logger } from "../ports.ts";
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

export interface TradingAgentDeps {
  config: Config;
  log: Logger;
  bus: EventBus;
  clock: Clock;
  extensions: Extension[];
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

/** Map one transcript entry to chat messages for the UI. */
export function entryToMessages(entry: EntryRecord, at: number): ChatMessage[] {
  const model = entry.model ?? [];
  const out: ChatMessage[] = [];
  for (const message of model) {
    if (message.role === "user") {
      out.push({
        id: String(entry.id),
        at,
        role: entry.kind === CYCLE_ENTRY_KIND ? "cycle" : "user",
        text: userText(message),
      });
    } else if (message.role === "assistant") {
      const text = assistantText(message);
      if (text.trim() !== "") {
        out.push({ id: `a-${String(entry.id)}`, at, role: "assistant", text });
      }
      for (const part of message.content) {
        if (part.type === "toolCall") {
          out.push({
            id: `t-${String(entry.id)}-${part.id}`,
            at,
            role: "tool",
            text: `${part.name}(${JSON.stringify(part.arguments).slice(0, 500)})`,
            toolName: part.name,
          });
        }
      }
    } else if (message.role === "toolResult") {
      out.push({
        id: `r-${String(entry.id)}`,
        at,
        role: "tool",
        text: truncate(toolResultText(message)),
        toolName: message.toolName,
        isError: message.isError || undefined,
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
  private lastPublishedState: AgentStatus["state"] | undefined;
  private statusSnapshot: (() => Omit<StatusResponse, "agent"> | Promise<Omit<StatusResponse, "agent">>) | undefined;
  private seenEntryIds = new Set<string>();
  private seenDelta = "";

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
    await this.ensureCredential();
    const storage = await openNodeSqliteStorage(join(config.DATA_DIR, "durable.sqlite"));
    const credentials = new FileCredentialStore(credentialFilePath(config.DATA_DIR));
    const models = createModels({ credentials });
    models.setProvider(metaProvider());
    const registry = createRegistry();
    for (const extension of this.deps.extensions) registry.install(extension);
    this.deps.onRegistry?.(registry);
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
      agent: { model: { provider: "meta", modelId: config.MUSE_MODEL }, thinkingLevel: "high" },
    });
    // An existing conversation keeps its stored model; pin it to the current one.
    await conversation.configure(
      { model: { provider: "meta", modelId: config.MUSE_MODEL }, thinkingLevel: "high" },
      CTX,
    );
    this.conversation = conversation;
    await this.watch();
    harness.resume();
    log.info("agent open", { model: config.MUSE_MODEL });
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
      model: this.deps.config.MUSE_MODEL,
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

  async listMessages(limit: number): Promise<ChatMessage[]> {
    const conversation = this.requireConversation();
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

  private async watch(): Promise<void> {
    const conversation = this.requireConversation();
    const watch = await conversation.watch(CTX);
    // Baseline: committed entries already in the transcript need no replay.
    for (const entry of watch.value.entries) this.seenEntryIds.add(String(entry.id));
    watch.start(async (value) => {
      for (const entry of value.entries) {
        const id = String(entry.id);
        if (this.seenEntryIds.has(id)) continue;
        this.seenEntryIds.add(id);
        for (const message of entryToMessages(entry, this.clock.now())) {
          this.deps.bus.publish({ type: "message", message });
        }
      }
      const partial = value.docs["pi.live"] as
        | { generation?: { message?: { content?: { type?: string; text?: string }[] } } }
        | undefined;
      const text = partial?.generation?.message?.content
        ?.filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("") ?? "";
      if (text.startsWith(this.seenDelta) && text.length > this.seenDelta.length) {
        this.deps.bus.publish({ type: "delta", text: text.slice(this.seenDelta.length) });
        this.seenDelta = text;
      } else if (!text.startsWith(this.seenDelta)) {
        // New turn replaced the partial; resync without emitting a jump.
        this.seenDelta = text;
      }
      if (text === "") {
        // A committed answer supersedes the partial it streamed from.
        this.seenDelta = "";
      }
    });
  }

  async close(): Promise<void> {
    const harness = this.harness;
    this.harness = undefined;
    this.conversation = undefined;
    if (harness !== undefined) await harness.close(CTX);
  }
}

export type { Message };
