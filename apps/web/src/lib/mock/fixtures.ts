import {
  DEFAULT_SETTINGS,
  type ChatMessage,
  type JournalEntry,
  type OrderRecord,
  type OrderStatus,
  type Position,
  type RiskCheck,
  type StatusResponse,
} from "@rh/shared";

/** Dev-only fixtures (VITE_MOCK_API=1). Never imported by production code paths. */

export type Scenario = "default" | "disconnected" | "halted" | "empty" | "running";

const MIN = 60_000;
const HOUR = 60 * MIN;

const positions: Position[] = [
  { symbol: "NVDA", quantity: 12, averageCost: 118.4, marketValue: 1612.8, unrealizedPnl: 191.99, sector: "Technology" },
  { symbol: "XLE", quantity: 25, averageCost: 92.1, marketValue: 2290.5, unrealizedPnl: -12.0, sector: "Energy" },
  { symbol: "JPM", quantity: 8.5, averageCost: 241.3, marketValue: 2093.2, unrealizedPnl: 42.15, sector: "Financials" },
];

export function fixtureStatus(scenario: Scenario, now = Date.now()): StatusResponse {
  const connected = scenario !== "disconnected";
  const halted = scenario === "halted";
  const equity = 25_431.77;
  return {
    agent: {
      state: !connected ? "needs_login" : scenario === "running" ? "running" : "idle",
      model: "muse-spark-1.3-contributor",
      lastCycleAt: now - 22 * MIN,
      lastCycleKind: "intraday",
      nextCycleAt: now + 8 * MIN,
      nextCycleKind: "intraday",
    },
    broker: connected
      ? { state: "connected", tools: ["get_portfolio", "get_quote", "review_order"] }
      : { state: "disconnected", tools: [] },
    market: {
      now,
      session: "regular",
      isOpen: true,
      tradingDay: "2026-10-23",
      nextOpen: now + 20 * HOUR,
      nextClose: now + 3 * HOUR + 12 * MIN,
      earlyClose: false,
    },
    settings: {
      ...DEFAULT_SETTINGS,
      mode: "approve",
      killSwitch: halted,
      drawdownHalted: halted,
      watchlist: ["SPY", "QQQ", "NVDA", "XLE", "JPM", "MSFT"],
    },
    account: connected && scenario !== "empty"
      ? {
          at: now - 40_000,
          equity,
          cash: equity - positions.reduce((a, p) => a + p.marketValue, 0),
          buyingPower: 19_200.3,
          positions,
        }
      : connected
        ? { at: now, equity: 10_000, cash: 10_000, buyingPower: 10_000, positions: [] }
        : null,
    halts: halted ? ["kill_switch", "drawdown"] : connected ? [] : ["broker_disconnected"],
    dayPnl: connected && scenario !== "empty" ? (halted ? -612.4 : 218.64) : undefined,
    dayPnlPct: connected && scenario !== "empty" ? (halted ? -2.35 : 0.87) : undefined,
  };
}

const passing: RiskCheck[] = [
  { rule: "kill_switch", ok: true, detail: "Kill switch is off" },
  { rule: "mode", ok: true, detail: "Mode approve allows queued orders" },
  { rule: "daily_loss", ok: true, detail: "Day P&L +0.87% vs halt at \u22122.00%" },
  { rule: "max_risk_per_trade", ok: true, detail: "Risk $198.40 = 0.78% of equity (limit 1.00%)" },
  { rule: "max_position", ok: true, detail: "Position after order 4.9% (limit 5.0%)" },
  { rule: "max_sector", ok: true, detail: "Technology after order 11.2% (limit 20.0%)" },
  { rule: "order_notional", ok: true, detail: "$1,240.00 under $2,500.00 cap" },
  { rule: "spread", ok: true, detail: "Spread 4.2 bps (limit 20)" },
  { rule: "slippage", ok: true, detail: "Limit 3.1 bps through mid (limit 10)" },
  { rule: "entry_window", ok: true, detail: "58 minutes after open, past the 30 minute buffer" },
  { rule: "ev_to_cost", ok: true, detail: "EV 1.9% after costs is 3.4x costs (min 2.0x)" },
];

export function fixtureOrder(id: string, status: OrderStatus, overrides: Partial<OrderRecord> = {}): OrderRecord {
  const now = Date.now();
  return {
    id,
    createdAt: now - 6 * MIN,
    updatedAt: now - 6 * MIN,
    cycleId: "cyc-1030",
    status,
    intent: {
      symbol: "MSFT",
      side: "buy",
      quantity: 3,
      orderType: "limit",
      limitPrice: 413.2,
      timeInForce: "day",
      invalidationPrice: 407.1,
      timeStopDate: "2026-10-30",
      thesis:
        "Post-earnings drift with a clean hold above the 20 day average. Cloud guidance raised, implied move already priced, and relative strength vs QQQ is at a three month high.",
      probabilityWin: 0.58,
      expectedGainPct: 4.2,
      expectedLossPct: 1.5,
      estimatedCostPct: 0.08,
      sector: "Technology",
      evidence: [
        "get_quote MSFT 10:28 ET: bid 413.15 ask 413.25",
        "web search 10:24 ET: guidance raised, Azure growth 34%",
      ],
    },
    verdict: { approved: true, isExit: false, checks: passing, maxQuantity: 3 },
    review: status === "pending_approval" ? undefined : "No pre-trade warnings. Estimated fee $0.00.",
    ...overrides,
  };
}

export const fixtureOrders = (): OrderRecord[] => {
  const now = Date.now();
  const failed = fixtureOrder("ord-2", "pending_approval", {
    createdAt: now - 3 * MIN,
    intent: {
      ...fixtureOrder("x", "pending_approval").intent,
      symbol: "XLE",
      side: "sell",
      quantity: 25,
      limitPrice: 91.62,
      invalidationPrice: 94.0,
      thesis:
        "Energy is breaking down on a weaker crude curve and the position has failed to hold the 50 day. Exit before the time stop to protect capital.",
      probabilityWin: 0.62,
      expectedGainPct: 1.6,
      expectedLossPct: 0.8,
    },
    verdict: {
      approved: false,
      isExit: true,
      checks: [
        ...passing.slice(0, 7),
        { rule: "quote_fresh", ok: false, detail: "Quote is 94s old (max 60s). Re-check before approving" },
        ...passing.slice(7, 9),
      ],
    },
  });
  return [
    fixtureOrder("ord-1", "pending_approval"),
    failed,
    fixtureOrder("ord-0", "submitted", {
      createdAt: now - 3 * HOUR,
      intent: { ...fixtureOrder("x", "submitted").intent, symbol: "JPM", quantity: 8.5, limitPrice: 241.3, invalidationPrice: 236.0 },
      brokerOrderId: "rh-8841",
    }),
    fixtureOrder("ord-m1", "rejected_risk", {
      createdAt: now - 5 * HOUR,
      intent: { ...fixtureOrder("x", "submitted").intent, symbol: "TSLA", quantity: 20, limitPrice: 262.4, invalidationPrice: 250 },
      verdict: {
        approved: false,
        isExit: false,
        checks: [
          ...passing.slice(0, 3),
          { rule: "max_position", ok: false, detail: "Position after order 20.6% (limit 5.0%)" },
          { rule: "order_notional", ok: false, detail: "$5,248.00 over $2,500.00 cap" },
        ],
      },
    }),
    fixtureOrder("ord-m2", "rejected_user", { createdAt: now - 26 * HOUR }),
    fixtureOrder("ord-m3", "failed", {
      createdAt: now - 27 * HOUR,
      error: "Robinhood rejected the order: insufficient buying power for limit 413.20",
    }),
    fixtureOrder("ord-m4", "expired", { createdAt: now - 30 * HOUR }),
  ];
};

const ACTIONS: JournalEntry["action"][] = ["hold", "watch", "buy", "sell", "none"];
const SYMS = ["SPY", "QQQ", "NVDA", "XLE", "JPM", "MSFT", "AMD", "XLF"];

export const fixtureJournal = (): JournalEntry[] => {
  const now = Date.now();
  const out: JournalEntry[] = [
    {
      id: "j-0",
      at: now - 22 * MIN,
      cycleId: "cyc-1030",
      action: "buy",
      symbol: "MSFT",
      summary: "Propose 3 MSFT at 413.20 after earnings drift holds the 20 day",
      rationale:
        "Relative strength vs QQQ is at a three month high and implied move is priced. Sizing stays inside 0.8% risk. Invalidation under the post-earnings gap fill at 407.10.",
      confidence: 0.58,
      evidence: ["get_quote MSFT 10:28 ET: bid 413.15 ask 413.25", "web search 10:24 ET: Azure growth 34%"],
      orderId: "ord-1",
      regime: "Risk-on, falling vol",
    },
    {
      id: "j-1",
      at: now - 52 * MIN,
      cycleId: "cyc-1000",
      action: "sell",
      symbol: "XLE",
      summary: "Exit XLE: crude curve weakening, 50 day lost",
      rationale: "Position failed to hold the 50 day average and the time stop is two days out. Exit is a sell so min-hold rules only warn.",
      confidence: 0.62,
      evidence: ["web search 09:58 ET: WTI backwardation narrows"],
      orderId: "ord-2",
    },
    {
      id: "j-2",
      at: now - 3 * HOUR,
      action: "hold",
      symbol: "NVDA",
      summary: "Hold NVDA, thesis intact above 112",
      rationale: "No change in the data center demand read. Stop remains 112.",
      confidence: 0.7,
      evidence: [],
    },
  ];
  for (let i = 0; i < 40; i++) {
    const action = ACTIONS[i % ACTIONS.length] ?? "hold";
    out.push({
      id: `j-${i + 3}`,
      at: now - (4 + i * 2.3) * HOUR,
      action,
      symbol: action === "none" ? undefined : SYMS[i % SYMS.length],
      summary:
        action === "none"
          ? "No actionable setups; macro calendar thin until CPI"
          : `${action === "watch" ? "Watching" : action === "hold" ? "Holding" : action === "buy" ? "Bought" : "Trimmed"} ${SYMS[i % SYMS.length]} on ${i % 2 ? "volume confirmation" : "failed breakout retest"}`,
      rationale: "Cycle review of price action, breadth, and the watchlist. Nothing changed the risk budget.",
      confidence: action === "none" ? undefined : 0.4 + ((i * 7) % 5) / 10,
      evidence: i % 3 === 0 ? ["get_quote 10:28 ET: spread 3 bps"] : [],
    });
  }
  return out;
};

export const fixtureMessages = (): ChatMessage[] => {
  const t = Date.now();
  return [
    { id: "m-1", at: t - 55 * MIN, role: "cycle", text: "Intraday cycle\nTrading day 2026-10-23, regular session, 2h 20m to the open of the entry window.\nAccount: equity $25,431.77, 3 positions.\nWatchlist: SPY, QQQ, NVDA, XLE, JPM, MSFT." },
    { id: "m-2", at: t - 54 * MIN, role: "tool", toolName: "get_portfolio", text: "3 positions, equity 25431.77, cash 19200.30, buying power 19200.30" },
    { id: "m-3", at: t - 54 * MIN + 2000, role: "tool", toolName: "get_quote", text: "XLE bid 91.60 ask 91.64 last 91.62 (-0.9%)" },
    { id: "m-4", at: t - 54 * MIN + 4000, role: "tool", toolName: "web_search", text: "crude oil curve WTI backwardation narrows; energy sector lagging" },
    { id: "m-5", at: t - 53 * MIN, role: "tool", toolName: "get_quote", text: "Quote service timed out after 8s", isError: true },
    { id: "m-6", at: t - 53 * MIN + 3000, role: "assistant", text: "**Read of the tape**\n\nEnergy is the weak spot. `XLE` lost its 50 day on rising volume and the lot is two days from its time stop.\n\n- Breadth is positive: 62% of the S&P above the 20 day\n- Vol is falling, VIX 14.8\n- Nothing on the calendar until CPI Thursday\n\nI am proposing an exit of the whole XLE position and will keep looking at tech for a re-entry." },
    { id: "m-7", at: t - 40 * MIN, role: "user", text: "Why exit XLE rather than trim half? It is barely down." },
    { id: "m-8", at: t - 39 * MIN, role: "assistant", text: "Fair question. Two reasons:\n\n1. The thesis was a crude rebound, and the curve says the opposite now.\n2. A trim leaves a position I would still want to defend with a stop, and the invalidation (94.00) is already above the quote.\n\nIf you prefer a half exit I can resubmit it as 12 shares." },
    { id: "m-9", at: t - 24 * MIN, role: "cycle", text: "Intraday cycle\nTrading day 2026-10-23, regular session." },
    { id: "m-10", at: t - 23 * MIN, role: "tool", toolName: "get_quote", text: "MSFT bid 413.15 ask 413.25" },
    { id: "m-11", at: t - 23 * MIN + 1000, role: "tool", toolName: "web_search", text: "MSFT earnings guidance Azure growth 34%" },
    { id: "m-12", at: t - 22 * MIN, role: "tool", toolName: "submit_order", text: "Queued for approval: BUY 3 MSFT limit 413.20 (risk checks passed)" },
    { id: "m-13", at: t - 22 * MIN + 2000, role: "assistant", text: "Proposed **3 MSFT at 413.20**. All risk checks pass; waiting for your approval." },
  ];
};

export const STREAM_REPLY =
  "Checking the open orders and the afternoon calendar. **MSFT** is holding 413 on light volume, and the entry stays valid until the 14:00 ET volatility window. I will re-quote at the next cycle and cancel the proposal if the spread widens beyond 20 bps.";
