import type {
  AccountSnapshot,
  Bar,
  ClosedTrade,
  OrderIntent,
  OrderRecord,
  OrderStatus,
  ReportFacts,
} from "@rh/shared";
import type { Broker, Clock, Logger, MarketCalendar, MarketData, Notes, Store } from "../ports.ts";
import { closeOnOrBefore, parseThesisStop, summarizeTrades } from "../analytics/compute.ts";
import { readAllClosedTrades } from "../analytics/trades.ts";
import { endOfEtDateMs } from "../market/market-data.ts";
import { etAddDays, isTradingDay, mondayOfWeek, weekDates } from "./ids.ts";

/**
 * Server-computed report figures. The agent writes only the narrative; every
 * number here comes from the store, the broker, or market data. Market-data
 * failures degrade to omitted optional fields, never a failed report.
 */

export interface ReportFactsDeps {
  store: Store;
  market: MarketData;
  broker: Broker;
  /** Current snapshot with sectors filled in, like the analytics service. */
  getAccount: () => AccountSnapshot | null;
  notes: Notes;
  calendar: MarketCalendar;
  clock: Clock;
  log: Logger;
}

function warn(log: Logger, msg: string, error: unknown): void {
  log.warn(msg, { error: error instanceof Error ? error.message : "unknown" });
}

/** Epoch bounds of an ET date range, inclusive on both ends. */
function rangeMs(periodStart: string, periodEnd: string): { since: number; until: number } {
  return { since: endOfEtDateMs(etAddDays(periodStart, -1)) + 1, until: endOfEtDateMs(periodEnd) };
}

/** SPY's percent change from the close before `periodStart` to the close on `periodEnd`. */
async function spyBenchmarkPct(deps: ReportFactsDeps, periodStart: string, periodEnd: string): Promise<number | undefined> {
  try {
    const spy = await deps.market.history("SPY", "1y");
    const byDate = new Map(spy.bars.map((b) => [b.date, b.close]));
    const start = closeOnOrBefore(byDate, etAddDays(periodStart, -1));
    const end = closeOnOrBefore(byDate, periodEnd);
    if (start === undefined || end === undefined || start <= 0) return undefined;
    return (end / start - 1) * 100;
  } catch (error) {
    warn(deps.log, "report benchmark unavailable", error);
    return undefined;
  }
}

/** Order counts for orders created in the period, by outcome bucket. */
function countOrders(orders: OrderRecord[]): ReportFacts["orders"] {
  const counts: ReportFacts["orders"] = { submitted: 0, filled: 0, rejected: 0, cancelled: 0, failed: 0 };
  for (const order of orders) {
    const status: OrderStatus = order.status;
    if (status === "submitted") counts.submitted += 1;
    else if (status === "filled" || status === "partially_filled") counts.filled += 1;
    else if (status === "rejected_risk" || status === "rejected_user" || status === "expired") counts.rejected += 1;
    else if (status === "cancelled") counts.cancelled += 1;
    else if (status === "failed") counts.failed += 1;
    // pending_approval, held and triggering are resting states, not outcomes.
  }
  return counts;
}

interface StopMap {
  held: Map<string, number>;
  robinhood: Map<string, number>;
}

/** Resting stops: the newest held harness stop per symbol, then Robinhood open stops. */
async function readStops(deps: ReportFactsDeps): Promise<StopMap> {
  const held = new Map<string, number>();
  // listOrders is newest first, so the first write per symbol wins.
  for (const order of deps.store.listOrders(10000)) {
    if (order.status !== "held" || order.intent.stopPrice === undefined || held.has(order.intent.symbol)) continue;
    held.set(order.intent.symbol, order.intent.stopPrice);
  }
  const robinhood = new Map<string, number>();
  if (deps.broker.status().state === "connected" && typeof deps.broker.openStopOrders === "function") {
    try {
      for (const stop of await deps.broker.openStopOrders()) robinhood.set(stop.symbol, stop.stopPrice);
    } catch (error) {
      warn(deps.log, "report stop orders unavailable", error);
    }
  }
  return { held, robinhood };
}

/** Stop for a held symbol: held stop, then Robinhood stop, then the thesis invalidation. */
async function resolveStop(deps: ReportFactsDeps, stops: StopMap, symbol: string): Promise<number | undefined> {
  const held = stops.held.get(symbol);
  if (held !== undefined) return held;
  const rh = stops.robinhood.get(symbol);
  if (rh !== undefined) return rh;
  try {
    const thesis = await deps.notes.read(`theses/${symbol}.md`);
    if (thesis !== undefined) return parseThesisStop(thesis.content);
  } catch {
    // A missing or unreadable thesis simply means no thesis stop.
  }
  return undefined;
}

async function positionsAndHeat(deps: ReportFactsDeps): Promise<Pick<ReportFacts, "positions" | "heatPct">> {
  const account = deps.getAccount();
  const equity = account?.equity ?? 0;
  const stops = await readStops(deps);
  const positions: ReportFacts["positions"] = [];
  let heat = 0;
  for (const position of account?.positions ?? []) {
    positions.push({
      symbol: position.symbol,
      weightPct: equity > 0 ? (position.marketValue / equity) * 100 : 0,
      unrealizedPnl: position.unrealizedPnl,
      ...(position.sector === undefined ? {} : { sector: position.sector }),
    });
    const stop = await resolveStop(deps, stops, position.symbol);
    if (stop !== undefined && equity > 0) {
      heat += Math.max(0, ((position.marketValue - stop * position.quantity) / equity) * 100);
    }
  }
  return { positions, ...(equity > 0 ? { heatPct: heat } : {}) };
}

async function periodFacts(
  deps: ReportFactsDeps,
  periodStart: string,
  periodEnd: string,
): Promise<
  Pick<
    ReportFacts,
    | "benchmarkPct"
    | "trades"
    | "realizedPnl"
    | "winRatePct"
    | "avgR"
    | "orders"
    | "positions"
    | "heatPct"
    | "decisions"
  >
> {
  const { since, until } = rangeMs(periodStart, periodEnd);
  const [benchmarkPct, allTrades, positions] = await Promise.all([
    spyBenchmarkPct(deps, periodStart, periodEnd),
    readAllClosedTrades(deps),
    positionsAndHeat(deps).catch((error: unknown): Pick<ReportFacts, "positions" | "heatPct"> => {
      warn(deps.log, "report positions unavailable", error);
      return { positions: [] };
    }),
  ]);
  const trades = allTrades.filter((t) => t.closedAt >= since && t.closedAt <= until);
  const summary = summarizeTrades(trades);
  const orders = countOrders(deps.store.ordersSince(since).filter((o) => o.createdAt <= until));
  const decisions = deps.store
    .listJournal(500)
    .filter((e) => e.at >= since && e.at <= until)
    .slice(0, 20)
    .map((e) => ({ id: e.id, at: e.at, action: e.action, ...(e.symbol === undefined ? {} : { symbol: e.symbol }), summary: e.summary }));
  return {
    ...(benchmarkPct === undefined ? {} : { benchmarkPct }),
    trades,
    realizedPnl: summary.realizedPnl,
    ...(summary.winRatePct === undefined ? {} : { winRatePct: summary.winRatePct }),
    ...(summary.avgR === undefined ? {} : { avgR: summary.avgR }),
    orders,
    positions: positions.positions,
    ...(positions.heatPct === undefined ? {} : { heatPct: positions.heatPct }),
    decisions,
  };
}

/** Equity slice of the period from the day marks, when any exist. */
function equitySlice(
  deps: ReportFactsDeps,
  periodStart: string,
  periodEnd: string,
): Pick<ReportFacts, "startEquity" | "endEquity" | "pnl" | "pnlPct" | "equityCurve"> {
  const rows = deps.store.equitySeries().filter((r) => r.etDate >= periodStart && r.etDate <= periodEnd);
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (first === undefined || last === undefined) return { equityCurve: [] };
  const pnl = last.dayLast - first.dayStart;
  return {
    startEquity: first.dayStart,
    endEquity: last.dayLast,
    pnl,
    ...(first.dayStart > 0 ? { pnlPct: (pnl / first.dayStart) * 100 } : {}),
    equityCurve: rows.map((r) => ({ date: r.etDate, equity: r.dayLast })),
  };
}

export async function buildDailyFacts(deps: ReportFactsDeps, date: string): Promise<ReportFacts> {
  return {
    periodStart: date,
    periodEnd: date,
    ...equitySlice(deps, date, date),
    ...(await periodFacts(deps, date, date)),
  };
}

export async function buildWeeklyFacts(deps: ReportFactsDeps, weekOf: string): Promise<ReportFacts> {
  const monday = mondayOfWeek(weekOf);
  const today = deps.calendar.etDate(deps.clock.now());
  const trading = weekDates(monday).filter((day) => day <= today && isTradingDay(deps.calendar, day));
  const periodEnd = trading[trading.length - 1] ?? monday;
  return {
    periodStart: monday,
    periodEnd,
    ...equitySlice(deps, monday, periodEnd),
    ...(await periodFacts(deps, monday, periodEnd)),
  };
}

export interface SelectedTrade {
  trade: ClosedTrade;
  plan?: Pick<OrderIntent, "thesis" | "invalidationPrice" | "timeStopDate" | "probabilityWin" | "expectedGainPct" | "expectedLossPct">;
  entryOrderIds: string[];
  exitOrderId?: string;
}

/**
 * The most recent closed trade for `symbol`: the newest harness round trip
 * when one exists, else the newest Robinhood trade-history trade. Throws
 * when the symbol has no closed trade, so the tool can tell the agent.
 */
export async function selectTrade(deps: ReportFactsDeps, symbol: string): Promise<SelectedTrade> {
  const harness = selectHarnessTrade(deps.store.ordersSince(0), symbol);
  if (harness !== undefined) return harness;
  if (deps.broker.status().state === "connected" && typeof deps.broker.tradeHistory === "function") {
    try {
      const rh = (await deps.broker.tradeHistory())
        .filter((t) => t.symbol === symbol)
        .sort((a, b) => a.closedAt - b.closedAt)
        .at(-1);
      if (rh !== undefined) {
        return {
          trade: {
            symbol: rh.symbol,
            closedAt: rh.closedAt,
            quantity: rh.quantity,
            exitPrice: rh.exitPrice,
            pnl: rh.pnl,
            source: "robinhood",
          },
          entryOrderIds: [],
        };
      }
    } catch (error) {
      warn(deps.log, "report trade history unavailable", error);
    }
  }
  throw new Error(`No closed trade for ${symbol}: no harness round trip and no Robinhood trade-history trade.`);
}

/**
 * FIFO pair of harness sells against earlier buys for one symbol, tracking
 * order ids. Mirrors pairHarnessTrades in analytics/compute.ts (same entry
 * math) and returns the most recent closed round trip.
 */
function selectHarnessTrade(orders: OrderRecord[], symbol: string): SelectedTrade | undefined {
  interface Lot {
    quantity: number;
    price: number;
    at: number;
    invalidationPrice?: number;
    probabilityWin?: number;
    orderId: string;
    intent: OrderIntent;
  }
  const queue: Lot[] = [];
  let best: SelectedTrade | undefined;
  const executed = orders.filter(
    (o) =>
      o.intent.symbol === symbol &&
      (o.status === "filled" || o.status === "partially_filled") &&
      (o.filledQuantity ?? 0) > 0 &&
      o.averageFillPrice !== undefined,
  );
  for (const order of executed) {
    const price = order.averageFillPrice as number;
    const quantity = order.filledQuantity as number;
    if (order.intent.side === "buy") {
      queue.push({
        quantity,
        price,
        at: order.updatedAt,
        invalidationPrice: order.intent.invalidationPrice,
        ...(order.intent.probabilityWin === undefined ? {} : { probabilityWin: order.intent.probabilityWin }),
        orderId: order.id,
        intent: order.intent,
      });
      continue;
    }
    let remaining = quantity;
    let cost = 0;
    let risk = 0;
    let probSum = 0;
    let probQty = 0;
    let openedAt: number | undefined;
    let entryIntent: OrderIntent | undefined;
    const entryOrderIds: string[] = [];
    while (remaining > 1e-9 && queue.length > 0) {
      const lot = queue[0] as Lot;
      const matched = Math.min(remaining, lot.quantity);
      cost += lot.price * matched;
      if (lot.invalidationPrice !== undefined && lot.invalidationPrice > 0 && lot.invalidationPrice < lot.price) {
        risk += (lot.price - lot.invalidationPrice) * matched;
      }
      if (lot.probabilityWin !== undefined) {
        probSum += lot.probabilityWin * matched;
        probQty += matched;
      }
      openedAt ??= lot.at;
      entryIntent ??= lot.intent;
      if (!entryOrderIds.includes(lot.orderId)) entryOrderIds.push(lot.orderId);
      lot.quantity -= matched;
      remaining -= matched;
      if (lot.quantity < 1e-9) queue.shift();
    }
    const matchedQty = quantity - remaining;
    if (matchedQty < 1e-9 || openedAt === undefined || entryIntent === undefined) continue;
    const tradePnl = price * matchedQty - cost;
    const entryPrice = cost / matchedQty;
    const intent = entryIntent;
    best = {
      trade: {
        symbol,
        openedAt,
        closedAt: order.updatedAt,
        quantity: matchedQty,
        entryPrice,
        exitPrice: price,
        pnl: tradePnl,
        pnlPct: cost === 0 ? undefined : (tradePnl / cost) * 100,
        ...(risk > 0 ? { rMultiple: tradePnl / risk } : {}),
        holdingDays: Math.max(0, (order.updatedAt - openedAt) / 86_400_000),
        ...(probQty > 0 ? { probabilityWin: probSum / probQty } : {}),
        source: "harness",
      },
      plan: {
        thesis: intent.thesis,
        invalidationPrice: intent.invalidationPrice,
        timeStopDate: intent.timeStopDate,
        probabilityWin: intent.probabilityWin,
        expectedGainPct: intent.expectedGainPct,
        expectedLossPct: intent.expectedLossPct,
      },
      entryOrderIds,
      exitOrderId: order.id,
    };
  }
  return best;
}

/** Daily bars from 20 trading days before entry to 5 after exit (or today); empty when history fails. */
async function tradeBars(deps: ReportFactsDeps, symbol: string, entryDate: string, exitDate: string): Promise<Bar[]> {
  try {
    const today = deps.calendar.etDate(deps.clock.now());
    const history = await deps.market.history(symbol, "1y");
    const bars = history.bars.filter((b) => b.date <= today);
    if (bars.length === 0) return [];
    let entryIdx = bars.findIndex((b) => b.date >= entryDate);
    if (entryIdx < 0) entryIdx = 0;
    let exitIdx = bars.length - 1;
    for (let i = bars.length - 1; i >= 0; i--) {
      if ((bars[i] as Bar).date <= exitDate) {
        exitIdx = i;
        break;
      }
    }
    const from = Math.max(0, entryIdx - 20);
    const to = Math.min(bars.length - 1, exitIdx + 5);
    if (from > to) return [];
    return bars.slice(from, to + 1);
  } catch (error) {
    warn(deps.log, "report trade bars unavailable", { symbol, error: error instanceof Error ? error.message : "unknown" });
    return [];
  }
}

export async function buildTradeFacts(deps: ReportFactsDeps, symbol: string): Promise<ReportFacts> {
  const selected = await selectTrade(deps, symbol);
  const exitDate = deps.calendar.etDate(selected.trade.closedAt);
  const entryDate = selected.trade.openedAt !== undefined ? deps.calendar.etDate(selected.trade.openedAt) : exitDate;
  return {
    periodStart: entryDate,
    periodEnd: exitDate,
    ...equitySlice(deps, entryDate, exitDate),
    ...(await periodFacts(deps, entryDate, exitDate)),
    // A trade report's P&L is the trade's own, not the account's over the holding period.
    pnl: selected.trade.pnl,
    ...(selected.trade.pnlPct === undefined ? { pnlPct: undefined } : { pnlPct: selected.trade.pnlPct }),
    trade: {
      trade: selected.trade,
      ...(selected.plan === undefined ? {} : { plan: selected.plan }),
      ...(selected.entryOrderIds[0] === undefined ? {} : { entryOrderId: selected.entryOrderIds[0] }),
      ...(selected.exitOrderId === undefined ? {} : { exitOrderId: selected.exitOrderId }),
      bars: await tradeBars(deps, symbol, entryDate, exitDate),
    },
  };
}
