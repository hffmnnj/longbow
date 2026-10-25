import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type {
  AccountSnapshot,
  AgentStatus,
  BrokerStatus,
  ChatMessage,
  CycleKind,
  HaltReason,
  HistoryRange,
  JournalEntry,
  NoteContent,
  NoteFile,
  PriceHistory,
  Skill,
  SkillSummary,
  MarketClock,
  OrderIntent,
  OrderRecord,
  Quote,
  Report,
  ReportKind,
  ReportSummary,
  ServerEvent,
  Settings,
  SettingsPatch,
} from "@rh/shared";
import type { OpenStopOrder, PnlTrade } from "./robinhood/mapping.ts";

/**
 * Server-internal contract. Each slice implements one port and consumes the
 * others only through these interfaces, so slices never import each other's
 * internals. Composition happens in `main.ts`.
 */

/** A model and its thinking level, parsed from "provider/model#thinking". */
export interface ModelSpec {
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
}

export interface Config {
  /** HTTP port, default 4520. */
  PORT: number;
  /** Listen addresses, default ["127.0.0.1"] plus the Tailnet address when HARNESS_TAILNET_HOST is set. */
  HOSTS: string[];
  /** Origin the browser uses, for the OAuth redirect URI and Origin checks, default http://127.0.0.1:4520. */
  PUBLIC_URL: string;
  /** Extra browser origins allowed on mutating requests, such as the Tailscale HTTPS URL (HARNESS_ORIGINS, comma separated). */
  ALLOWED_ORIGINS: string[];
  /** State directory (mode 0700), default ~/.local/share/robinhood-harness. */
  DATA_DIR: string;
  /** Real orders and cancels reach Robinhood only when HARNESS_LIVE_TRADING=1; otherwise the broker is read-only. */
  LIVE_TRADING: boolean;
  /** Main agent model, MAIN_MODEL as "provider/model#thinking", default openai-codex/gpt-6.1-sol#xhigh. */
  MAIN_MODEL: ModelSpec;
  /** Subagent fleet model, SUBAGENT_MODEL, default meta/muse-spark-1.3-contributor#xhigh; also the main fallback. */
  SUBAGENT_MODEL: ModelSpec;
  /** Muse CLI auth file to seed the Meta credential from, default ~/.config/muse/auth.json. */
  MUSE_AUTH_FILE: string;
  /** OpenCode config holding mcp.servers.openai_websearch {url, headers}, default ~/.config/opencode-v2/opencode.json. */
  WEBSEARCH_CONFIG_FILE: string;
  ROBINHOOD_MCP_URL: string;
  /** Built SvelteKit app to serve, default apps/web/build. */
  WEB_DIR: string;
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export interface Clock {
  now(): number;
}

export interface EventBus {
  publish(event: ServerEvent): void;
  subscribe(listener: (event: ServerEvent) => void): () => void;
}

/** NYSE calendar (2026-2027 holidays and early closes) in America/New_York. */
export interface MarketCalendar {
  clock(now: number): MarketClock;
  /** ET date YYYY-MM-DD of an instant. */
  etDate(now: number): string;
  /** Number of NYSE trading days strictly between two ET dates. */
  tradingDaysBetween(fromEtDate: string, toEtDate: string): number;
}

/** App state in one SQLite file (`${DATA_DIR}/app.sqlite`), synchronous like node:sqlite. */
export interface Store {
  getSettings(): Settings;
  /** Applies a validated patch (risk merges per field) and returns the result. */
  patchSettings(patch: SettingsPatch): Settings;

  addJournal(entry: Omit<JournalEntry, "id">): JournalEntry;
  listJournal(limit: number): JournalEntry[];

  addOrder(order: Omit<OrderRecord, "id">): OrderRecord;
  updateOrder(id: string, patch: Partial<Omit<OrderRecord, "id" | "createdAt">>): OrderRecord;
  getOrder(id: string): OrderRecord | undefined;
  /** Newest first. */
  listOrders(limit: number): OrderRecord[];
  /** Oldest first, createdAt >= since. */
  ordersSince(since: number): OrderRecord[];

  /** Records an equity observation; the first of each ET day and the max of each ET month are kept. */
  markEquity(at: number, etDate: string, equity: number): void;
  /** Starting equity of an ET day and peak equity of its month (YYYY-MM), when observed. */
  equityMarks(etDate: string): { dayStart?: number; monthPeak?: number };
  /** Every recorded ET day oldest first: the day's starting and peak observed equity. */
  /** One row per ET day; dayLast is the latest observed equity, the closest thing to a close. */
  equitySeries(): { etDate: string; dayStart: number; dayHigh: number; dayLast: number }[];

  /** Stores a report, replacing any report with the same id (ids are deterministic per period). */
  saveReport(report: Report): void;
  report(id: string): Report | undefined;
  /** Report summaries, newest first. */
  reports(query: { kind?: ReportKind; limit: number }): ReportSummary[];
}

/**
 * The Robinhood Trading MCP connection. Read tools are exposed to the model as
 * a pi-durable extension; order placement is only reachable through
 * `reviewOrder`/`placeOrder`, which the order gate calls after the risk engine.
 */
export interface Broker {
  status(): BrokerStatus;
  /** Starts OAuth (dynamic client registration + PKCE) and returns the sign-in URL. */
  beginConnect(): Promise<string>;
  /** Completes OAuth from the callback query string, then connects. */
  completeConnect(params: URLSearchParams): Promise<void>;
  disconnect(): Promise<void>;
  /** Fresh account view of the MCP trading account. Throws when disconnected. */
  snapshot(): Promise<AccountSnapshot>;
  quote(symbol: string): Promise<Quote>;
  /** Robinhood's pre-trade review; returns its text including any warnings. */
  reviewOrder(intent: OrderIntent): Promise<string>;
  /** Places the order and returns the broker order id. */
  placeOrder(intent: OrderIntent): Promise<{ brokerOrderId: string; raw: string }>;
  /** Closed trades from the broker's trade history, oldest first. Absent when the broker cannot serve them. */
  tradeHistory?(): Promise<PnlTrade[]>;
  /** Open sell stop orders resting at the broker. Absent when the broker cannot serve them. */
  openStopOrders?(): Promise<OpenStopOrder[]>;
  /** Called whenever status or the tool list changes. */
  onChange(listener: () => void): () => void;
}

export interface OrderGate {
  /** Runs the risk engine; stores and returns the order (rejected, pending approval, submitted, or failed). */
  submit(intent: OrderIntent, cycleId?: string): Promise<OrderRecord>;
  approve(id: string): Promise<OrderRecord>;
  reject(id: string, reason?: string): Promise<OrderRecord>;
  /** Current halts for new entries. */
  halts(): Promise<HaltReason[]>;
}

/** Free public market data (Nasdaq daily bars and earnings calendar), cached under `${DATA_DIR}/cache`. */
export interface MarketData {
  history(symbol: string, range: HistoryRange): Promise<PriceHistory>;
  /** Next scheduled earnings date (ET, YYYY-MM-DD) within the next 30 days, or undefined when none is found. */
  nextEarnings(symbol: string): Promise<string | undefined>;
  /** Average daily dollar volume (close times volume) over the last `days` sessions. */
  avgDollarVolume(symbol: string, days: number): Promise<number | undefined>;
}

/** Trading skills and resources shipped in `apps/server/skills/<name>/SKILL.md`. Read-only. */
export interface SkillLibrary {
  list(): SkillSummary[];
  get(name: string): Skill | undefined;
  /** A file inside a skill folder; rejects paths that escape it. */
  readFile(name: string, path: string): Promise<string>;
}

/** The agent's writable notes workspace in `${DATA_DIR}/workspace`, markdown files only. */
export interface Notes {
  list(): Promise<NoteFile[]>;
  read(path: string): Promise<NoteContent | undefined>;
  write(path: string, content: string): Promise<NoteFile>;
}

export interface AgentControl {
  status(): AgentStatus;
  /** User chat message into the trading agent's conversation. */
  sendMessage(text: string): Promise<void>;
  /** Starts a cycle now; idempotent per cycle id. */
  runCycle(kind: CycleKind): Promise<void>;
  /** The lead agent's transcript, or a subagent's when `conversationId` is given. */
  listMessages(limit: number, conversationId?: string): Promise<ChatMessage[]>;
}
