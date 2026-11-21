import { randomUUID } from "node:crypto";
import type { Bar, OrderIntent, OrderRecord, Position, SimExecution, SimFill } from "@rh/shared";
import type { Clock, MarketCalendar } from "../ports.ts";
import type { TradingBroker } from "../risk/stops.ts";
import { equityFees } from "../fees.ts";
import { fractionalExecution } from "../robinhood/mapping.ts";
import { etInstant, pathPrice, pathSegment, realisticPrice, realisticSegment, sessionFraction } from "./path.ts";
import { avgDollarVolumeBefore, halfSpreadBps, returnVolatilityBefore, slippageBps } from "./execution.ts";

export interface PaperOrder {
  id: string;
  intent: OrderIntent;
  createdAt: number;
  checkedAt: number;
  status: "open" | "filled" | "cancelled";
  triggered: boolean;
}
export interface PaperBroker extends TradingBroker {
  advance(): Promise<void>;
  orders(): PaperOrder[];
  fills(): SimFill[];
  cancelOrder(id: string): Promise<void>;
}
export interface PaperBrokerDeps {
  startingCash: number;
  clock: Clock;
  calendar: MarketCalendar;
  bars(symbol: string): Promise<Bar[]>;
  /** "realistic" (default): liquidity spreads, slippage and latency, trade-through fills. "ideal": fills at the limit on touch. */
  execution?: SimExecution;
  /** Seeds the intraday path; the same symbol and date always map to the same path. */
  seed?: number;
}

const LIQUID = new Set(["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "META", "TSLA", "AVGO"]);
export function createPaperBroker(deps: PaperBrokerDeps): PaperBroker {
  const execution: SimExecution = deps.execution ?? "realistic";
  const seed = deps.seed ?? 1;
  let settled = deps.startingCash;
  const proceeds: { date: string; amount: number }[] = [];
  const holdings = new Map<string, { quantity: number; cost: number; sector?: string }>();
  const orders: PaperOrder[] = [];
  const fills: SimFill[] = [];
  const delayed = new Map<string, { at: number; market: boolean }>();
  const date = (): string => deps.calendar.etDate(deps.clock.now());
  const sessions = new Map<string, ReturnType<MarketCalendar["clock"]>>();
  function session(day: string): ReturnType<MarketCalendar["clock"]> {
    const prior = sessions.get(day);
    if (prior !== undefined) return prior;
    const bounds = deps.calendar.clock(etInstant(day, 12));
    sessions.set(day, bounds);
    return bounds;
  }
  function settle(day = date()): void {
    for (let i = proceeds.length - 1; i >= 0; i--) {
      if (proceeds[i]!.date < day) { settled += proceeds[i]!.amount; proceeds.splice(i, 1); }
    }
  }
  const reservedCash = (except?: string): number => orders.filter((o) => o.id !== except && o.status === "open" && o.intent.side === "buy")
    .reduce((sum, o) => sum + o.intent.quantity * o.intent.limitPrice, 0);
  const reservedShares = (symbol: string, except?: string): number => orders
    .filter((o) => o.id !== except && o.status === "open" && o.intent.side === "sell" && o.intent.symbol === symbol)
    .reduce((sum, o) => sum + o.intent.quantity, 0);
  function fill(order: PaperOrder, price: number, at: number, mid: number): void {
    const { intent } = order;
    const held = holdings.get(intent.symbol) ?? { quantity: 0, cost: 0 };
    const notional = price * intent.quantity;
    const fees = equityFees({ side: intent.side, quantity: intent.quantity, price, date: deps.calendar.etDate(at) }).total;
    if (intent.side === "buy") {
      if (notional + fees > settled - reservedCash(order.id) + 1e-8) throw new Error("Insufficient settled cash");
      settled -= notional + fees;
      holdings.set(intent.symbol, { quantity: held.quantity + intent.quantity, cost: held.cost + notional,
        ...(intent.sector === undefined ? {} : { sector: intent.sector }) });
    } else {
      if (intent.quantity > held.quantity - reservedShares(intent.symbol, order.id) + 1e-8) throw new Error("Insufficient shares");
      const quantity = Math.max(0, held.quantity - intent.quantity);
      if (quantity < 1e-8) holdings.delete(intent.symbol);
      else holdings.set(intent.symbol, { ...held, quantity, cost: held.cost * quantity / held.quantity });
      proceeds.push({ date: deps.calendar.etDate(at), amount: notional - fees });
    }
    order.status = "filled";
    fills.push({ at, date: deps.calendar.etDate(at), symbol: intent.symbol, side: intent.side, quantity: intent.quantity, price,
      orderId: order.id, mid, cost: Math.abs(price - mid) * intent.quantity, ...(fees > 0 ? { fees } : {}) });
  }
  async function quote(symbol: string) {
    const at = deps.clock.now();
    const day = date();
    const bars = await deps.bars(symbol);
    const current = bars.find((b) => b.date === day);
    const previous = bars.filter((b) => b.date < day).at(-1);
    const { nextOpen: open, nextClose: close } = session(day);
    let last: number | undefined;
    if (at < open) last = previous?.close;
    else if (current !== undefined) last = execution === "ideal" ? pathPrice(current, sessionFraction(day, at, close)) : realisticPrice(current, symbol, seed, at, close);
    if (last === undefined || !Number.isFinite(last) || last <= 0) throw new Error(`No historical quote for ${symbol} on ${day}`);
    const spread = execution === "ideal"
      ? last * (LIQUID.has(symbol) ? 1 : 3) / 10_000
      : last * halfSpreadBps(avgDollarVolumeBefore(bars, day), Math.max(0, (at - open) / 60_000)) / 10_000;
    return { symbol, at, last, bid: last - spread, ask: last + spread };
  }
  function marketPrice(side: OrderIntent["side"], notional: number, history: Bar[], day: string, at: number, mid: number): number {
    const adv = avgDollarVolumeBefore(history, day);
    const half = mid * halfSpreadBps(adv, Math.max(0, (at - session(day).nextOpen) / 60_000)) / 10_000;
    const slip = mid * slippageBps(notional, adv, returnVolatilityBefore(history, day)) / 10_000;
    return side === "buy" ? mid + half + slip : mid - half - slip;
  }
  function executablePrice(intent: OrderIntent, history: Bar[], day: string, at: number, mid: number): number | undefined {
    const price = marketPrice(intent.side, intent.quantity * intent.limitPrice, history, day, at, mid);
    if (intent.side === "buy" ? price <= intent.limitPrice : price >= intent.limitPrice) return price;
    return undefined;
  }
  function cancel(id: string): void {
    const order = orders.find((o) => o.id === id);
    if (order === undefined || order.status !== "open") throw new Error("Unknown open order");
    order.status = "cancelled";
    delayed.delete(id);
  }
  function cross(a: number, b: number, level: number, above: boolean): number | undefined {
    if (above ? a >= level : a <= level) return 0;
    if (above ? b < level : b > level) return undefined;
    return (level - a) / (b - a);
  }
  async function advanceRestingOrders(now: number): Promise<void> {
    const day = deps.calendar.etDate(now);
    for (const order of orders.filter((o) => o.status === "open" && !delayed.has(o.id))) {
      const { intent } = order;
      const history = await deps.bars(intent.symbol);
      if (order.status !== "open") continue;
      const createdDay = deps.calendar.etDate(order.createdAt);
      const bars = history.filter((b) => b.date >= deps.calendar.etDate(order.checkedAt) && b.date <= day &&
        (intent.timeInForce !== "day" || b.date === createdDay));
      for (const bar of bars) {
        const bounds = session(bar.date);
        if (bounds.tradingDay !== bar.date) continue;
        const close = bounds.nextClose;
        const from = Math.max(order.checkedAt, order.createdAt);
        const points = execution === "ideal"
          ? pathSegment(bar, from, now, close)
          : realisticSegment(bar, intent.symbol, seed, from, now, close);
        // A resting limit fills only on a trade through the limit: a touch is
        // not enough in realistic mode, so the level sits a cent beyond it.
        const through = execution === "ideal" ? intent.limitPrice : intent.limitPrice + (intent.side === "sell" ? 0.01 : -0.01);
        for (let i = 0; i < points.length && order.status === "open"; i++) {
          let a = points[i]!;
          const b = points[i + 1] ?? a;
          let triggerPrice: number | undefined;
          if (!order.triggered) {
            const ratio = cross(a.price, b.price, intent.stopPrice!, intent.side === "buy");
            if (ratio === undefined) continue;
            a = { price: a.price + (b.price - a.price) * ratio, at: a.at + (b.at - a.at) * ratio };
            order.triggered = true;
            // A stop already resting at the simulated venue can become
            // marketable at its trigger. Its limit is a bound, not a cost.
            if (execution === "realistic") triggerPrice = executablePrice(intent, history, bar.date, a.at, a.price);
          }
          const ratio = triggerPrice === undefined ? cross(a.price, b.price, through, intent.side === "sell") : 0;
          if (ratio !== undefined) {
            // A resting order that can no longer fill (shares already sold, cash spent) cancels like a broker reject.
            try {
              fill(order, triggerPrice ?? intent.limitPrice, a.at + (b.at - a.at) * ratio, a.price + (b.price - a.price) * ratio);
            } catch {
              order.status = "cancelled";
            }
          }
        }
        if (order.status !== "open") break;
        if (intent.timeInForce === "day" && now >= close) break;
      }
      if (order.status === "open" && intent.timeInForce === "day" && now >= session(createdDay).nextClose) {
        order.status = "cancelled";
      }
      order.checkedAt = Math.max(order.checkedAt, now);
    }
  }
  async function reconcileOrders(): Promise<void> {
    const now = deps.clock.now();
    const dueTimes = [...new Set([...delayed.values()].map((attempt) => attempt.at).filter((at) => at <= now))].sort((a, b) => a - b);
    for (const at of dueTimes) {
      const day = deps.calendar.etDate(at);
      settle(day);
      await advanceRestingOrders(at - 1);
      for (const order of orders) {
        const attempt = delayed.get(order.id);
        if (order.status !== "open" || attempt?.at !== at) continue;
        const { intent } = order;
        const history = await deps.bars(intent.symbol);
        delayed.delete(order.id);
        const bar = history.find((b) => b.date === day);
        const mid = bar === undefined ? undefined : realisticPrice(bar, intent.symbol, seed, at, session(day).nextClose);
        if (mid !== undefined) {
          const price = attempt.market
            ? marketPrice(intent.side, intent.quantity * mid, history, day, at, mid)
            : executablePrice(intent, history, day, at, mid);
          if (price !== undefined) {
            try { fill(order, price, at, mid); } catch { order.status = "cancelled"; }
            continue;
          }
        }
        if (attempt.market) order.status = "cancelled";
        // A missed aggressive limit can rest only after that attempt, not on the pre-arrival path.
        else order.checkedAt = at + 1;
      }
    }
    settle(deps.calendar.etDate(now));
    await advanceRestingOrders(now);
  }
  let advancing: Promise<void> | undefined;
  function advance(): Promise<void> {
    advancing ??= reconcileOrders().finally(() => { advancing = undefined; });
    return advancing;
  }
  return {
    status: () => ({ state: "connected", tools: [] }),
    async beginConnect() { throw new Error("not available in simulation"); },
    async completeConnect() { throw new Error("not available in simulation"); },
    async disconnect() { throw new Error("not available in simulation"); },
    onChange: () => () => {},
    quote,
    quotes: (symbols) => Promise.all(symbols.map(quote)),
    async snapshot() {
      settle();
      const positions: Position[] = await Promise.all([...holdings].map(async ([symbol, held]) => {
        const mark = (await quote(symbol)).last;
        return { symbol, quantity: held.quantity, sharesAvailableForSells: held.quantity,
          averageCost: held.cost / held.quantity, marketValue: mark * held.quantity,
          unrealizedPnl: mark * held.quantity - held.cost, ...(held.sector === undefined ? {} : { sector: held.sector }) };
      }));
      const cash = settled + proceeds.reduce((sum, p) => sum + p.amount, 0);
      return { at: deps.clock.now(), cash, settledCash: settled - reservedCash(), buyingPower: settled - reservedCash(),
        equity: cash + positions.reduce((sum, p) => sum + p.marketValue, 0), positions };
    },
    async reviewOrder(intent) { return `Simulated review: ${intent.side} ${intent.quantity} ${intent.symbol} limit ${intent.limitPrice}`; },
    async orderState(id): Promise<Partial<OrderRecord>> {
      const order = orders.find((o) => o.id === id);
      if (order === undefined) throw new Error("Unknown paper order");
      if (order.status === "open") return { status: "submitted" };
      if (order.status === "cancelled") return { status: "cancelled" };
      const filled = fills.find((f) => f.orderId === id);
      if (filled === undefined) throw new Error("Paper order fill is missing");
      return { status: "filled", filledQuantity: filled.quantity, averageFillPrice: filled.price };
    },
    async cancelOrder(id) { await advance(); cancel(id); },
    async executeStop(intent) {
      if (!deps.calendar.clock(deps.clock.now()).isOpen || intent.side !== "sell") throw new Error("Paper protective sale requires regular hours");
      settle();
      const q = await quote(intent.symbol);
      const price = execution === "ideal" ? q.bid :
        marketPrice("sell", intent.quantity * q.last, await deps.bars(intent.symbol), date(), q.at, q.last);
      // The harness has already triggered this stop. The market sale has no limit floor.
      const order: PaperOrder = { id: randomUUID(), intent: structuredClone(intent), createdAt: q.at,
        checkedAt: q.at, status: "open", triggered: true };
      fill(order, price, q.at, q.last);
      orders.push(order);
      return { brokerOrderId: order.id, raw: "Simulated protective market sale" };
    },
    async placeOrder(intent) {
      const at = deps.clock.now();
      if (!deps.calendar.clock(at).isOpen) throw new Error("Simulation market is closed");
      if (intent.orderType === "stop_limit" && intent.stopPrice === undefined) throw new Error("Stop price required");
      const q = await quote(intent.symbol);
      if (deps.clock.now() !== at) throw new Error("Simulation clock advanced during order placement");
      settle();
      if (intent.side === "buy" && intent.quantity * intent.limitPrice > settled - reservedCash() + 1e-8) throw new Error("Insufficient settled cash");
      if (intent.side === "sell" && intent.quantity > (holdings.get(intent.symbol)?.quantity ?? 0) - reservedShares(intent.symbol) + 1e-8) throw new Error("Insufficient shares");
      // A marketable fractional equity intent converts to market; it never rests.
      const { market = false } = fractionalExecution(intent, q, true);
      const order: PaperOrder = { id: randomUUID(), intent: structuredClone(intent), createdAt: at, checkedAt: at, status: "open",
        triggered: intent.orderType === "limit" || (intent.side === "buy" ? q.last >= intent.stopPrice! : q.last <= intent.stopPrice!) };
      const marketable = intent.side === "buy" ? intent.limitPrice >= q.ask : intent.limitPrice <= q.bid;
      if (order.triggered && marketable) {
        if (execution === "ideal") fill(order, intent.side === "buy" ? q.ask : q.bid, q.at, q.last);
        else delayed.set(order.id, { at: Math.min(q.at + 60_000, session(date()).nextClose), market });
      }
      orders.push(order);
      return { brokerOrderId: order.id, raw: `Simulated order ${order.status}` };
    },
    advance,
    orders: () => structuredClone(orders),
    fills: () => structuredClone(fills.toSorted((a, b) => a.at - b.at)),
  };
}
