import { z } from "zod";

/**
 * Wire contract between the server and the web UI. Every HTTP body and SSE
 * event is one of these types. Money is USD numbers, times are epoch ms unless
 * the field name says otherwise (ISO dates are `YYYY-MM-DD` in America/New_York).
 */

// ---------------------------------------------------------------------------
// Settings and risk limits

/** off: research only, never orders. approve: risk-approved orders wait for a human. auto: risk-approved orders are placed. */
export const TradingModeSchema = z.enum(["off", "approve", "auto"]);
export type TradingMode = z.infer<typeof TradingModeSchema>;

export const RiskConfigSchema = z.object({
  /** Max loss to the invalidation price, as % of equity, per entry. */
  maxRiskPerTradePct: z.number().positive().max(5),
  /** Max market value of one symbol after the order, as % of equity. */
  maxPositionPct: z.number().positive().max(100),
  /** Max market value of one sector after the order, as % of equity. */
  maxSectorPct: z.number().positive().max(100),
  maxPositions: z.number().int().positive().max(50),
  /** Absolute fat-finger cap on one order's notional. */
  maxOrderNotionalUsd: z.number().positive(),
  /** Halt new entries when equity is this % below the ET day's starting equity. */
  dailyLossHaltPct: z.number().positive().max(50),
  /** Halt new entries when equity is this % below the month's peak equity. Needs a human re-arm. */
  monthlyDrawdownHaltPct: z.number().positive().max(80),
  maxEntriesPerDay: z.number().int().nonnegative().max(50),
  /** Sells of a lot younger than this are blocked unless the quote is at or below the invalidation price. */
  minHoldDays: z.number().int().nonnegative().max(30),
  /** Max ask-bid spread in basis points of mid. */
  maxSpreadBps: z.number().positive().max(1000),
  /** Limit price may sit at most this many bps through the mid (above mid for buys, below for sells). */
  maxSlippageBps: z.number().nonnegative().max(500),
  /** No new entries this many minutes after the regular open. */
  noTradeOpenMinutes: z.number().int().nonnegative().max(120),
  /** No new entries this many minutes before the regular close. */
  noTradeCloseMinutes: z.number().int().nonnegative().max(120),
  /** Max same-day round trips in 5 business days (classic PDT rule for margin accounts under $25k). */
  maxDayTrades5d: z.number().int().nonnegative().max(10),
  /** Entries need expected value after costs above this multiple of estimated round-trip costs. */
  minEvToCost: z.number().nonnegative().max(20),
});
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

export const DEFAULT_RISK: RiskConfig = {
  maxRiskPerTradePct: 1,
  maxPositionPct: 5,
  maxSectorPct: 20,
  maxPositions: 5,
  maxOrderNotionalUsd: 2500,
  dailyLossHaltPct: 2,
  monthlyDrawdownHaltPct: 6,
  maxEntriesPerDay: 2,
  minHoldDays: 1,
  maxSpreadBps: 20,
  maxSlippageBps: 10,
  noTradeOpenMinutes: 30,
  noTradeCloseMinutes: 15,
  maxDayTrades5d: 3,
  minEvToCost: 2,
};

export const SettingsSchema = z.object({
  mode: TradingModeSchema,
  /** When true no order of any kind is submitted and scheduled cycles still run as research only. */
  killSwitch: z.boolean(),
  /** Set when the monthly drawdown breaker trips; cleared only by a human (PATCH { drawdownHalted: false }). */
  drawdownHalted: z.boolean(),
  cycleMinutesOpen: z.number().int().min(5).max(240),
  cycleMinutesClosed: z.number().int().min(30).max(1440),
  watchlist: z.array(z.string().regex(/^[A-Z.]{1,10}$/)).max(50),
  risk: RiskConfigSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  mode: "approve",
  killSwitch: false,
  drawdownHalted: false,
  cycleMinutesOpen: 30,
  cycleMinutesClosed: 240,
  watchlist: ["SPY", "QQQ"],
  risk: DEFAULT_RISK,
};

/** PATCH /api/settings body. `risk` merges field by field. */
export const SettingsPatchSchema = SettingsSchema.omit({ risk: true }).partial().extend({
  risk: RiskConfigSchema.partial().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

// ---------------------------------------------------------------------------
// Market, broker, account

export type MarketSession = "pre" | "regular" | "post" | "closed";

export interface MarketClock {
  now: number;
  session: MarketSession;
  /** True only during the regular session of an NYSE trading day. */
  isOpen: boolean;
  /** ET date of the current or next trading day, YYYY-MM-DD. */
  tradingDay: string;
  nextOpen: number;
  nextClose: number;
  earlyClose: boolean;
}

export type BrokerState = "disconnected" | "needs_auth" | "connecting" | "connected" | "error";

export interface BrokerStatus {
  state: BrokerState;
  /** Robinhood MCP tool names visible after connect. */
  tools: string[];
  error?: string;
}

export interface Position {
  symbol: string;
  quantity: number;
  averageCost: number;
  marketValue: number;
  unrealizedPnl: number;
  sector?: string;
}

export interface AccountSnapshot {
  at: number;
  equity: number;
  cash: number;
  buyingPower: number;
  settledCash?: number;
  positions: Position[];
}

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  at: number;
}

// ---------------------------------------------------------------------------
// Orders and the risk gate

export const OrderIntentSchema = z.object({
  symbol: z.string().regex(/^[A-Z.]{1,10}$/),
  side: z.enum(["buy", "sell"]),
  quantity: z.number().positive(),
  orderType: z.enum(["limit", "stop_limit"]),
  limitPrice: z.number().positive(),
  /** Trigger price, required for stop_limit. */
  stopPrice: z.number().positive().optional(),
  timeInForce: z.enum(["day", "gtc"]),
  /** Price at which the thesis is wrong; risk per share = |limitPrice - invalidationPrice|. */
  invalidationPrice: z.number().positive(),
  /** ET date by which the thesis must have worked, YYYY-MM-DD. */
  timeStopDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  thesis: z.string().min(20).max(2000),
  /** Probability the trade reaches its target before invalidation, 0..1. */
  probabilityWin: z.number().min(0).max(1),
  /** Expected % gain to target and % loss to invalidation, both positive numbers. */
  expectedGainPct: z.number().nonnegative(),
  expectedLossPct: z.number().nonnegative(),
  /** Estimated round-trip costs (spread, slippage, fees) in % of notional. */
  estimatedCostPct: z.number().nonnegative(),
  sector: z.string().max(60).optional(),
  /** Citations to tool outputs: tool name plus what it showed and when. */
  evidence: z.array(z.string().min(3).max(400)).min(1).max(20),
});
export type OrderIntent = z.infer<typeof OrderIntentSchema>;

export interface RiskCheck {
  rule: string;
  ok: boolean;
  detail: string;
}

export interface RiskVerdict {
  approved: boolean;
  /** True when the order reduces or closes an existing long. */
  isExit: boolean;
  checks: RiskCheck[];
  /** Largest quantity the sizing rules would allow, when computable. */
  maxQuantity?: number;
  quote?: Quote;
}

export type OrderStatus =
  | "pending_approval"
  | "rejected_risk"
  | "rejected_user"
  | "expired"
  | "submitted"
  | "failed";

export interface OrderRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  cycleId?: string;
  intent: OrderIntent;
  verdict: RiskVerdict;
  status: OrderStatus;
  /** Text of Robinhood's review (pre-trade warnings), when run. */
  review?: string;
  brokerOrderId?: string;
  error?: string;
}

export const OrderDecisionSchema = z.object({ reason: z.string().max(500).optional() });
export type OrderDecision = z.infer<typeof OrderDecisionSchema>;

// ---------------------------------------------------------------------------
// Journal, agent, chat

export type JournalAction = "hold" | "buy" | "sell" | "watch" | "none";

export interface JournalEntry {
  id: string;
  at: number;
  cycleId?: string;
  action: JournalAction;
  symbol?: string;
  /** One-line headline. */
  summary: string;
  rationale: string;
  /** 0..1 */
  confidence?: number;
  evidence: string[];
  orderId?: string;
  regime?: string;
}

export type CycleKind = "pre_open" | "intraday" | "post_close" | "overnight" | "manual";

export interface AgentStatus {
  state: "idle" | "running" | "error" | "needs_login";
  model: string;
  lastCycleAt?: number;
  lastCycleKind?: CycleKind;
  nextCycleAt?: number;
  nextCycleKind?: CycleKind;
  lastError?: string;
}

export type ChatRole = "user" | "assistant" | "tool" | "cycle";

/** One tool call a Code Mode script made, shown nested under the script. */
export interface ToolCallSummary {
  name: string;
  isError?: boolean;
  /** Short human summary of the arguments or result. */
  summary?: string;
  durationMs?: number;
}

export interface ChatMessage {
  id: string;
  at: number;
  role: ChatRole;
  text: string;
  toolName?: string;
  isError?: boolean;
  /** For `codemode` tool messages: the script the agent ran. */
  code?: string;
  /** For `codemode` tool messages: the nested tool calls the script made, in order. */
  calls?: ToolCallSummary[];
  /** For `delegate` tool messages: the subagent conversation, readable at GET /api/conversations/:id/messages. */
  childConversationId?: string;
  /** For `delegate` tool messages: the subagent role, for example "bear". */
  agentRole?: string;
}

export type SubagentRole = "analyst" | "bull" | "bear" | "risk_reviewer" | "researcher";

/** One `delegate` run: a read-only subagent conversation working for the lead agent. */
export interface SubagentRun {
  /** The child conversation id; its transcript is GET /api/conversations/:id/messages. */
  id: string;
  role: SubagentRole;
  symbol?: string;
  task: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "done" | "failed";
  /** Final answer, when done. */
  answer?: string;
}

// ---------------------------------------------------------------------------
// Market data, skills, notes

export const HistoryRangeSchema = z.enum(["1m", "3m", "6m", "1y", "2y", "5y"]);
export type HistoryRange = z.infer<typeof HistoryRangeSchema>;

/** One daily bar; `date` is the ET trading date YYYY-MM-DD. */
export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceHistory {
  symbol: string;
  /** Oldest first. */
  bars: Bar[];
  source: string;
  asOf: number;
}

export interface SkillSummary {
  name: string;
  description: string;
}

export interface Skill extends SkillSummary {
  /** SKILL.md body (markdown, frontmatter removed). */
  body: string;
  /** Extra files in the skill folder, relative to it. */
  files: string[];
}

/** A file in the agent's durable notes workspace (theses, plans, lessons). */
export interface NoteFile {
  path: string;
  size: number;
  updatedAt: number;
}

export interface NoteContent {
  path: string;
  content: string;
  updatedAt: number;
}

export const SendMessageSchema = z.object({ text: z.string().min(1).max(8000) });
export type SendMessage = z.infer<typeof SendMessageSchema>;

/** Why new entries are blocked right now, if they are. Exits may still be allowed. */
export type HaltReason = "kill_switch" | "mode_off" | "daily_loss" | "drawdown" | "broker_disconnected";

export interface StatusResponse {
  agent: AgentStatus;
  broker: BrokerStatus;
  market: MarketClock;
  settings: Settings;
  account: AccountSnapshot | null;
  halts: HaltReason[];
  /** P&L vs the ET day's starting equity, when known. */
  dayPnl?: number;
  dayPnlPct?: number;
}

// ---------------------------------------------------------------------------
// HTTP and SSE

/** Mutating requests must send this header; it forces a CORS preflight the server never allows cross-origin. */
export const CSRF_HEADER = "x-harness";

export type ServerEvent =
  | { type: "status"; status: StatusResponse }
  /** `conversationId` is set for subagent transcripts and absent for the lead agent. */
  | { type: "message"; message: ChatMessage; conversationId?: string }
  /** Streaming assistant text for the in-flight turn; replaced by the committed `message`. */
  | { type: "delta"; text: string; conversationId?: string }
  | { type: "subagent"; run: SubagentRun }
  /** Live nested calls of the running Code Mode script, replaced by the committed tool message. */
  | { type: "calls"; calls: ToolCallSummary[]; conversationId?: string }
  | { type: "journal"; entry: JournalEntry }
  | { type: "order"; order: OrderRecord }
  | { type: "note"; note: NoteFile };

export interface ConnectResponse {
  /** Robinhood sign-in URL to open in the browser. */
  url: string;
}
