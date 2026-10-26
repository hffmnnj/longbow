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
  /** Smallest order notional worth sending (fractional orders below this are noise). */
  minOrderNotionalUsd: z.number().nonnegative(),
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
  /** Block entries this many trading days before a scheduled earnings report. 0 disables. */
  earningsBlackoutDays: z.number().int().nonnegative().max(20),
  /** Block entries when the 20-session average daily dollar volume is below this USD floor. 0 disables. */
  minAvgDollarVolumeUsd: z.number().nonnegative(),
});
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

/** Tuned for a small cash account trading fractional shares of liquid ETFs and mega caps. */
export const DEFAULT_RISK: RiskConfig = {
  maxRiskPerTradePct: 1.5,
  maxPositionPct: 30,
  maxSectorPct: 60,
  maxPositions: 4,
  maxOrderNotionalUsd: 500,
  minOrderNotionalUsd: 5,
  dailyLossHaltPct: 3,
  monthlyDrawdownHaltPct: 8,
  maxEntriesPerDay: 2,
  minHoldDays: 1,
  maxSpreadBps: 20,
  maxSlippageBps: 10,
  noTradeOpenMinutes: 30,
  noTradeCloseMinutes: 15,
  maxDayTrades5d: 3,
  minEvToCost: 2,
  earningsBlackoutDays: 5,
  minAvgDollarVolumeUsd: 20_000_000,
};

/**
 * System One (Jev) second opinion on entries. `off` skips it, `advise` records it as a passing
 * `system_one` risk check, `block` lets a high-confidence concern reject the entry. The gate fails
 * open: an outage never blocks an order, and exits are never reviewed.
 */
export const SystemOneGateSchema = z.enum(["off", "advise", "block"]);
export type SystemOneGate = z.infer<typeof SystemOneGateSchema>;

export const SystemOneSettingsSchema = z.object({
  /** Master switch for the System One tools and the entry review. */
  enabled: z.boolean(),
  gate: SystemOneGateSchema,
});
export type SystemOneSettings = z.infer<typeof SystemOneSettingsSchema>;

export const DEFAULT_SYSTEM_ONE: SystemOneSettings = { enabled: true, gate: "advise" };

export const SettingsSchema = z.object({
  mode: TradingModeSchema,
  /** When true no order of any kind is submitted and scheduled cycles still run as research only. */
  killSwitch: z.boolean(),
  /** Set when the monthly drawdown breaker trips; clears itself in the next ET month, or by PATCH { drawdownHalted: false }. */
  drawdownHalted: z.boolean(),
  /** ET month (YYYY-MM) the drawdown breaker tripped in. */
  drawdownHaltedMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  cycleMinutesOpen: z.number().int().min(5).max(240),
  cycleMinutesClosed: z.number().int().min(30).max(1440),
  watchlist: z.array(z.string().regex(/^[A-Z.]{1,10}$/)).max(50),
  risk: RiskConfigSchema,
  systemOne: SystemOneSettingsSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  mode: "auto",
  killSwitch: false,
  drawdownHalted: false,
  cycleMinutesOpen: 30,
  cycleMinutesClosed: 240,
  watchlist: ["SPY", "QQQ", "IWM", "SMH", "XLK", "XLF", "XLE", "NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL"],
  risk: DEFAULT_RISK,
  systemOne: DEFAULT_SYSTEM_ONE,
};

/** PATCH /api/settings body. `risk` and `systemOne` merge field by field. */
export const SettingsPatchSchema = SettingsSchema.omit({ risk: true, systemOne: true }).partial().extend({
  risk: RiskConfigSchema.partial().optional(),
  systemOne: SystemOneSettingsSchema.partial().optional(),
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
  sharesAvailableForSells?: number;
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
  | "held"
  | "triggering"
  | "partially_filled"
  | "filled"
  | "cancelled"
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
  filledQuantity?: number;
  averageFillPrice?: number;
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

/** "helper" is a long-running subagent's report delivered to the lead agent, never something the user wrote. */
export type ChatRole = "user" | "assistant" | "tool" | "cycle" | "helper";

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
  /** For `delegate` tool messages and helper reports: the subagent role, for example "bear". */
  agentRole?: string;
  /** For helper reports: the long-running helper's name. */
  helperName?: string;
}

export type SubagentRole = "analyst" | "bull" | "bear" | "risk_reviewer" | "researcher";

/** One `delegate` run, or one named long-running `subagent` helper: a read-only conversation working for the lead agent. */
export interface SubagentRun {
  /** The child conversation id; its transcript is GET /api/conversations/:id/messages. */
  id: string;
  role: SubagentRole;
  /** Long-running helpers only: the name the lead agent gave it. */
  name?: string;
  /** True for a long-running helper that keeps its context between messages; "done" then means idle and ready for more. */
  background?: boolean;
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

/**
 * Health of the System One (decision model) connection. `rate_limited` and `payment` carry a
 * `cooldownUntil`; calls skip the network until then and tools tell the agent to proceed without it.
 */
export type SystemOneState = "ok" | "degraded" | "rate_limited" | "payment" | "unconfigured";

export interface SystemOneStatus {
  state: SystemOneState;
  /** Model id sent on the wire, such as jev-latest. */
  model: string;
  /** Calls answered in the last 24 hours, and the median latency of the last 200. */
  calls24h: number;
  medianLatencyMs?: number;
  /** Input tokens billed in the last 24 hours. */
  inputTokens24h: number;
  cooldownUntil?: number;
  lastError?: string;
  lastOkAt?: number;
}

export interface StatusResponse {
  agent: AgentStatus;
  /** System One connection health; absent only from servers older than this field. */
  systemOne?: SystemOneStatus;
  broker: BrokerStatus;
  market: MarketClock;
  settings: Settings;
  account: AccountSnapshot | null;
  halts: HaltReason[];
  /** P&L vs the ET day's starting equity, when known. */
  dayPnl?: number;
  dayPnlPct?: number;
  /** False while the server's hard lock keeps Robinhood read-only (HARNESS_LIVE_TRADING unset), whatever the mode. */
  liveTrading: boolean;
  /** Model specs as "provider/model#thinking": the lead agent and the subagent fleet. */
  models: { main: string; subagents: string };
}

// ---------------------------------------------------------------------------
// Analytics: the live account's history, performance, and market context.

export type AnalyticsRange = "1m" | "3m" | "1y" | "all";

export interface EquityPoint {
  at: number;
  date: string;
  equity: number;
  /** SPY buy-and-hold scaled to the first point's equity. */
  benchmark?: number;
}

export interface EquityHistory {
  /** Harness equity marks (recorded since the harness first connected), one per ET day at most for ranges over 1m. */
  points: EquityPoint[];
  /** What today's holdings plus today's cash would have been worth on each past day: a replay, not the account's real history. */
  holdingsReplay: { date: string; value: number }[];
  returnPct?: number;
  benchmarkReturnPct?: number;
  maxDrawdownPct?: number;
}

export interface ClosedTrade {
  symbol: string;
  openedAt?: number;
  closedAt: number;
  quantity: number;
  entryPrice?: number;
  exitPrice: number;
  /** Realized P&L net of regulatory fees. */
  pnl: number;
  pnlPct?: number;
  /** Regulatory fees on both legs, dollars, when known (harness trades); already subtracted from pnl. */
  fees?: number;
  /** Realized P&L over planned risk (entry minus invalidation), for harness trades with a plan. */
  rMultiple?: number;
  holdingDays?: number;
  /** The agent's stated probability of a win at entry, for harness trades. */
  probabilityWin?: number;
  /** "harness" for trades this system opened, "robinhood" for older ones read from the broker's trade history. */
  source: "harness" | "robinhood";
}

export interface CalibrationBucket {
  /** Predicted win-probability bucket, for example 0.5 to 0.6. */
  from: number;
  to: number;
  predicted: number;
  realized: number;
  count: number;
}

export interface ExposureRow {
  symbol: string;
  sector?: string;
  marketValue: number;
  weightPct: number;
  unrealizedPnl: number;
  /** Stop price from a held stop, a Robinhood stop order, or the thesis invalidation. */
  stopPrice?: number;
  /** Loss to the stop as a percent of equity. */
  riskToStopPct?: number;
}

export interface PerformanceSummary {
  trades: ClosedTrade[];
  realizedPnl: number;
  winRatePct?: number;
  avgR?: number;
  expectancy?: number;
  profitFactor?: number;
  avgHoldingDays?: number;
  brier?: number;
  calibration: CalibrationBucket[];
  exposure: ExposureRow[];
  sectors: { sector: string; weightPct: number }[];
  /** Portfolio heat: total loss to all stops as a percent of equity. */
  heatPct?: number;
  ordersByStatus: Partial<Record<OrderStatus, number>>;
}

/** Returns, changes and relative strength are percents (1.5 means 1.5%), like every *Pct field. */
export interface TrendRow {
  symbol: string;
  name?: string;
  last: number;
  changePct1d: number;
  return1m: number;
  return3m: number;
  aboveSma50: boolean;
  aboveSma200: boolean;
  rsi14?: number;
  /** 3-month return minus SPY's. */
  relStrength3m?: number;
  /** Last 60 daily closes, oldest first. */
  spark: number[];
}

export interface MarketOverview {
  asOf: number;
  /** One-line regime label such as "Sideways, elevated volatility", from the same rules as the market-regime skill. */
  regime: string;
  indices: TrendRow[];
  sectors: TrendRow[];
  volatility: {
    vix: number;
    vix9d?: number;
    vix3m?: number;
    /** Percentile of today's VIX over the past year. */
    percentile?: number;
    contango: boolean;
    history: { date: string; value: number }[];
  };
  /** Treasury curve, short to long tenor. */
  yields: { tenor: string; yieldPct: number }[];
  tenYearHistory: { date: string; value: number }[];
  breadth: { aboveSma50: number; total: number };
  /** Economic calendar for the next 7 days. */
  calendar: { date: string; time?: string; event: string; importance?: "high" | "medium" | "low" }[];
  /** Earnings in the next 30 days for held and watchlist names. */
  earnings: { symbol: string; date: string; time?: string; held: boolean }[];
}

// ---------------------------------------------------------------------------
// Reports: the agent writes the narrative, the server computes every number.

export const ReportKindSchema = z.enum(["daily", "weekly", "trade"]);
export type ReportKind = z.infer<typeof ReportKindSchema>;

/** Decision quality, judged apart from the outcome: a loss on a well-run plan can earn an A. */
export const ReportGradeSchema = z.enum(["A", "B", "C", "D", "F"]);
export type ReportGrade = z.infer<typeof ReportGradeSchema>;

/** What the agent submits through the `publish_report` tool. */
export const ReportNarrativeSchema = z.object({
  kind: ReportKindSchema,
  /** Trade reports only: the closed symbol. */
  symbol: z.string().regex(/^[A-Z.]{1,10}$/).optional(),
  /** Weekly reports only: the Monday (ET date) of the week covered; defaults to the current week. */
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** One plain sentence, the first thing the owner reads. */
  headline: z.string().min(1).max(140),
  /** Two to four sentences of markdown. The limits keep reports readable at a glance. */
  summary: z.string().min(1).max(600),
  grade: ReportGradeSchema.optional(),
  /** Why the grade, in one sentence. */
  gradeReason: z.string().max(220).optional(),
  /** Short titled sections in markdown, for example "What worked", "What didn't", "Market". */
  sections: z.array(z.object({ title: z.string().min(1).max(40), body: z.string().min(1).max(700) })).max(4),
  lessons: z.array(z.string().min(1).max(200)).max(3),
  nextSteps: z.array(z.string().min(1).max(200)).max(3),
});
export type ReportNarrative = z.infer<typeof ReportNarrativeSchema>;

/** Server-computed figures for the report's period; never written by the model. */
export interface ReportFacts {
  /** ET dates, inclusive. A trade report spans entry to exit. */
  periodStart: string;
  periodEnd: string;
  startEquity?: number;
  endEquity?: number;
  /** The account's P&L over the period; for a trade report, the trade's own realized P&L. */
  pnl?: number;
  pnlPct?: number;
  /** SPY's percent change over the same period. */
  benchmarkPct?: number;
  /** Daily equity marks in the period (dayLast), oldest first. */
  equityCurve: { date: string; equity: number }[];
  /** Trades closed in the period. */
  trades: ClosedTrade[];
  realizedPnl: number;
  winRatePct?: number;
  avgR?: number;
  orders: { submitted: number; filled: number; rejected: number; cancelled: number; failed: number };
  /** Holdings at the end of the period. */
  positions: { symbol: string; weightPct: number; unrealizedPnl: number; sector?: string }[];
  heatPct?: number;
  /** The decisions journaled in the period, newest first, at most 20. */
  decisions: Pick<JournalEntry, "id" | "at" | "action" | "symbol" | "summary">[];
  /** Trade reports only. */
  trade?: {
    trade: ClosedTrade;
    /** The entry order's plan as submitted. */
    plan?: Pick<OrderIntent, "thesis" | "invalidationPrice" | "timeStopDate" | "probabilityWin" | "expectedGainPct" | "expectedLossPct">;
    entryOrderId?: string;
    exitOrderId?: string;
    /** Daily bars from 20 trading days before entry to 5 after exit, for the price-path chart. */
    bars: Bar[];
  };
}

export interface ReportSummary {
  id: string;
  kind: ReportKind;
  at: number;
  /** Trade reports: the symbol. */
  symbol?: string;
  periodStart: string;
  periodEnd: string;
  headline: string;
  grade?: ReportGrade;
  pnl?: number;
  pnlPct?: number;
}

export interface Report extends ReportSummary {
  cycleId?: string;
  narrative: ReportNarrative;
  facts: ReportFacts;
}

export interface SymbolDetail {
  symbol: string;
  name?: string;
  quote?: Quote;
  position?: Position;
  history: PriceHistory;
  indicators: {
    sma20?: number;
    sma50?: number;
    sma200?: number;
    rsi14?: number;
    atr14?: number;
    avgDollarVolume?: number;
    /** Percent, like TrendRow. */
    return1m?: number;
    return3m?: number;
    high52w?: number;
    low52w?: number;
  };
  /** theses/<SYMBOL>.md from the agent's notes, when it exists. */
  thesis?: NoteContent;
  orders: OrderRecord[];
  journal: JournalEntry[];
  nextEarnings?: { date: string; time?: string };
  stop?: { price: number; source: "held" | "robinhood" | "thesis" };
}

// ---------------------------------------------------------------------------
// Simulation: an accelerated, point-in-time replay of past trading days with a paper broker.

const EtDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Ticker = z.string().regex(/^[A-Z.]{1,10}$/);

/**
 * historical: real dates and tickers. blind: the same history on a fictional future calendar with aliased tickers and
 * rescaled prices, so the model's memory of real events cannot help. bootstrap: a synthetic market resampled in blocks
 * from ten years of joint daily returns (seeded), also aliased and on a fictional calendar.
 */
export const SimModeSchema = z.enum(["historical", "blind", "bootstrap"]);
export type SimMode = z.infer<typeof SimModeSchema>;

/** realistic: liquidity-based spreads, slippage, trade-through fills, gap-through stops, seeded intraday path. ideal: fills at the limit. */
export const SimExecutionSchema = z.enum(["realistic", "ideal"]);
export type SimExecution = z.infer<typeof SimExecutionSchema>;

/** A named historical regime from the scenario library (GET /api/sim/scenarios). */
export interface SimScenario {
  id: string;
  name: string;
  /** One sentence on what the window tests. */
  description: string;
  startDate: string;
  days: number;
  regime: "crash" | "bear" | "bull" | "chop" | "rotation" | "shock";
}

export const SimRunConfigSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  /** Scenario library id; supplies startDate and days unless they are given. */
  scenario: z.string().min(1).max(40).optional(),
  mode: SimModeSchema.default("historical"),
  execution: SimExecutionSchema.default("realistic"),
  /** Seeds the intraday path, aliases, price scales and bootstrap draws; random when omitted, recorded on the run. */
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
  /** "main" runs the lead model, "subagent" the cheaper subagent model (useful for large suites). */
  model: z.enum(["main", "subagent"]).default("main"),
  /** First simulated NYSE trading day (ET) of the source history; required for historical and blind unless a scenario is given; ignored by bootstrap. */
  startDate: EtDate.optional(),
  /** Trading days to simulate. */
  days: z.number().int().min(1).max(120),
  startingCash: z.number().positive().max(1_000_000),
  /** 2: open check (10:15 ET) and close review (15:45 ET); 3 adds pre-open (09:00); 4 adds midday (12:30). */
  cyclesPerDay: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  watchlist: z.array(Ticker).min(1).max(30).optional(),
  /** Extra instructions for this run's agent, for testing a strategy hypothesis. */
  strategy: z.string().max(2000).optional(),
  /** Overrides on the live risk settings for this run. */
  risk: RiskConfigSchema.partial().optional(),
});
export type SimRunConfig = z.infer<typeof SimRunConfigSchema>;
/** What callers pass in: defaulted fields (mode, execution, model) may be omitted. */
export type SimRunConfigInput = z.input<typeof SimRunConfigSchema>;

export type SimRunStatus = "queued" | "running" | "done" | "failed" | "stopped";

/** End-of-day marks; `benchmark` is SPY buy-and-hold scaled to the starting cash. */
export interface SimEquityPoint {
  date: string;
  equity: number;
  cash: number;
  benchmark: number;
}

export interface SimFill {
  at: number;
  date: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  orderId: string;
  /** Mid price when the fill happened. */
  mid?: number;
  /** Dollars paid versus the mid: half-spread plus slippage (always >= 0 in realistic execution). */
  cost?: number;
  /** Regulatory fees charged on this fill (SEC, FINRA TAF, CAT), dollars; deducted from cash. */
  fees?: number;
}

export interface SimMetrics {
  returnPct: number;
  benchmarkReturnPct: number;
  maxDrawdownPct: number;
  /** Annualized from daily returns; absent under 5 days. */
  sharpe?: number;
  trades: number;
  /** Closed round trips that made money, percent. */
  winRatePct?: number;
  /** Average multiple of initial risk on closed round trips. */
  avgR?: number;
  /** Average share of equity invested at the close. */
  exposurePct: number;
  ordersSubmitted: number;
  ordersRejected: number;
  /** Brier score of entry `probabilityWin` against closed outcomes; lower is better. */
  brier?: number;
  /** Annualized, from daily returns; absent under 5 days. */
  sortino?: number;
  /** Annualized return over max drawdown; absent without a drawdown. */
  calmar?: number;
  /** Annualized volatility of daily returns, percent. */
  volatilityPct?: number;
  /** Beta of daily returns to the benchmark. */
  beta?: number;
  /** Return minus beta times the benchmark's return over the run, percent. */
  alphaPct?: number;
  /** Closed round trips. */
  roundTrips: number;
  /** Gross profit over gross loss on closed round trips. */
  profitFactor?: number;
  /** Average dollars per closed round trip. */
  expectancy?: number;
  avgHoldingDays?: number;
  maxConsecutiveLosses?: number;
  /** Traded notional over average equity, percent. */
  turnoverPct: number;
  /** Spread, slippage and regulatory fees paid, dollars and percent of starting cash. */
  costsPaid: number;
  costsPct: number;
  /** Risk-engine rejections by rule, for example { sector: 2, max_positions: 1 }. */
  riskBlocks: Record<string, number>;
  /** Regulatory fees alone, dollars (included in costsPaid). */
  feesPaid?: number;
}

export interface SimRun {
  id: string;
  createdAt: number;
  startedBy: "user" | "agent";
  config: SimRunConfig;
  /** The seed actually used. */
  seed?: number;
  /** For blind and bootstrap runs: alias to real symbol (bootstrap: the source symbol), filled in only when the run ends. */
  aliases?: Record<string, string>;
  /** For blind and bootstrap runs: the fictional calendar's first day and the source window it maps from. */
  calendar?: { firstDay: string; sourceStart?: string; sourceEnd?: string };
  suiteId?: string;
  /** Suite variant label, for example "A". */
  variant?: string;
  status: SimRunStatus;
  /** Simulated ET date currently running. */
  currentDate?: string;
  progress: { day: number; days: number; cycle: number; cyclesPerDay: number };
  equity: SimEquityPoint[];
  positions: Position[];
  fills: SimFill[];
  metrics?: SimMetrics;
  error?: string;
  finishedAt?: number;
}

export const SimVariantSchema = z.object({
  label: z.string().min(1).max(24),
  strategy: z.string().max(2000).optional(),
  risk: RiskConfigSchema.partial().optional(),
  model: z.enum(["main", "subagent"]).optional(),
});
export type SimVariant = z.infer<typeof SimVariantSchema>;

/** A batch: every variant runs on every scenario and every bootstrap seed, so variants are compared on identical markets. */
export const SimSuiteConfigSchema = z.object({
  name: z.string().min(1).max(80),
  scenarios: z.array(z.string().min(1).max(40)).max(12).default([]),
  /** Number of bootstrap markets (seeds 1..n). */
  bootstrapRuns: z.number().int().min(0).max(10).default(0),
  /** Historical scenarios run blind (recommended) or historical. */
  scenarioMode: z.enum(["historical", "blind"]).default("blind"),
  /** Bootstrap run length in trading days. */
  bootstrapDays: z.number().int().min(5).max(120).default(40),
  startingCash: z.number().positive().max(1_000_000),
  cyclesPerDay: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(2),
  execution: SimExecutionSchema.default("realistic"),
  watchlist: z.array(Ticker).min(1).max(30).optional(),
  variants: z.array(SimVariantSchema).min(1).max(2),
});
export type SimSuiteConfig = z.infer<typeof SimSuiteConfigSchema>;

export interface SimSuiteVariantSummary {
  label: string;
  runs: number;
  done: number;
  failed: number;
  meanReturnPct?: number;
  medianReturnPct?: number;
  p10ReturnPct?: number;
  p90ReturnPct?: number;
  /** Mean of return minus benchmark return. */
  meanExcessPct?: number;
  /** Share of finished runs that beat the benchmark, percent. */
  beatBenchmarkPct?: number;
  worstDrawdownPct?: number;
  medianSharpe?: number;
  winRatePct?: number;
  avgR?: number;
  costsPct?: number;
  brier?: number;
}

export interface SimSuite {
  id: string;
  createdAt: number;
  startedBy: "user" | "agent";
  config: SimSuiteConfig;
  status: SimRunStatus;
  runs: { runId: string; variant: string; scenario?: string; seed?: number; mode: SimMode }[];
  summary: SimSuiteVariantSummary[];
  /** With two variants: B minus A on excess return over paired markets, with a bootstrap 95% interval. */
  comparison?: { metric: "excessReturnPct"; meanDiff: number; ci95: [number, number]; pairs: number };
  finishedAt?: number;
}

// ---------------------------------------------------------------------------
// Web push (installed app notifications)

export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionSchema>;

/** Payload the service worker shows as a notification. */
export interface PushPayload {
  title: string;
  body: string;
  /** Path to open on click, for example "/?order=<id>". */
  url?: string;
  /** Collapses repeats, for example "halt" or "order-<id>". */
  tag?: string;
}

// ---------------------------------------------------------------------------
// HTTP and SSE

/** Mutating requests must send this header; it forces a CORS preflight the server never allows cross-origin. */
export const CSRF_HEADER = "x-harness";

/**
 * `conversationId` is set for subagent transcripts and absent for the lead agent.
 * `simRunId` is set for events from a simulation run and absent for the live account.
 */
export type ServerEvent =
  | { type: "status"; status: StatusResponse }
  | { type: "message"; message: ChatMessage; conversationId?: string; simRunId?: string }
  /** Streaming assistant text for the in-flight turn; replaced by the committed `message`. */
  | { type: "delta"; text: string; conversationId?: string; simRunId?: string }
  | { type: "subagent"; run: SubagentRun; simRunId?: string }
  /** Live nested calls of the running Code Mode script, replaced by the committed tool message. */
  | { type: "calls"; calls: ToolCallSummary[]; conversationId?: string; simRunId?: string }
  | { type: "journal"; entry: JournalEntry; simRunId?: string }
  | { type: "order"; order: OrderRecord; simRunId?: string }
  | { type: "note"; note: NoteFile; simRunId?: string }
  | { type: "sim"; run: SimRun }
  | { type: "report"; report: ReportSummary; simRunId?: string }
  | { type: "sim_suite"; suite: SimSuite; simRunId?: string };

export interface ConnectResponse {
  /** Robinhood sign-in URL to open in the browser. */
  url: string;
}
