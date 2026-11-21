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
  cancel(id: string): void;
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
  const date = (): string => deps.calendar.etDate(deps.clock.now());
  function settle(): void {
    for (let i = proceeds.length - 1; i >= 0; i--) {
      if (proceeds[i]!.date < date()) { settled += proceeds[i]!.amount; proceeds.splice(i, 1); }
    }
  }
  const reservedCash = (): number => orders.filter((o) => o.status === "open" && o.intent.side === "buy")
    .reduce((sum, o) => sum + o.intent.quantity * o.intent.limitPrice, 0);
  function fill(order: PaperOrder, price: number, at: number, mid: number): void {
    const { intent } = order;
    const held = holdings.get(intent.symbol) ?? { quantity: 0, cost: 0 };
    const notional = price * intent.quantity;
    const fees = equityFees({ side: intent.side, quantity: intent.quantity, price, date: deps.calendar.etDate(at) }).total;
    if (intent.side === "buy") {
      if (notional + fees > settled + 1e-8) throw new Error("Insufficient settled cash");
      settled -= notional + fees;
      holdings.set(intent.symbol, { quantity: held.quantity + intent.quantity, cost: held.cost + notional,
        ...(intent.sector === undefined ? {} : { sector: intent.sector }) });
    } else {
      if (intent.quantity > held.quantity + 1e-8) throw new Error("Insufficient shares");
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
    const open = etInstant(day, 9, 30);
    let last: number | undefined;
    if (at < open) last = previous?.close;
    else if (current !== undefined) last = execution === "ideal" ? pathPrice(current, sessionFraction(day, at)) : realisticPrice(current, symbol, seed, at);
    if (last === undefined || !Number.isFinite(last) || last <= 0) throw new Error(`No historical quote for ${symbol} on ${day}`);
    const spread = execution === "ideal"
      ? last * (LIQUID.has(symbol) ? 1 : 3) / 10_000
      : last * halfSpreadBps(avgDollarVolumeBefore(bars, day), Math.max(0, (at - open) / 60_000)) / 10_000;
    return { symbol, at, last, bid: last - spread, ask: last + spread };
  }
  function marketPrice(side: OrderIntent["side"], notional: number, history: Bar[], day: string, at: number, mid: number): number {
    const adv = avgDollarVolumeBefore(history, day);
    const half = mid * halfSpreadBps(adv, Math.max(0, (at - etInstant(day, 9, 30)) / 60_000)) / 10_000;
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
  }
  /** Fill price for an order that is marketable at placement, or undefined when it must rest. */
  async function marketableFill(intent: OrderIntent, createdAt: number, q: { last: number; ask: number; bid: number }, market: boolean):
    Promise<{ price: number; at: number; mid: number } | undefined> {
    if (execution === "ideal") {
      if (intent.side === "buy") {
        return intent.limitPrice >= q.ask ? { price: q.ask, at: createdAt, mid: q.last } : undefined;
      }
      return intent.limitPrice <= q.bid ? { price: q.bid, at: createdAt, mid: q.last } : undefined;
    }
    const day = deps.calendar.etDate(createdAt);
    const history = await deps.bars(intent.symbol);
    const bar = history.find((b) => b.date === day);
    if (bar === undefined) return undefined;
    // Latency: the order fills at the path price 60 seconds after it is placed.
    const at = Math.min(createdAt + 60_000, etInstant(day, 16));
    const mid = realisticPrice(bar, intent.symbol, seed, at);
    const price = market
      ? marketPrice(intent.side, intent.quantity * mid, history, day, at, mid)
      : executablePrice(intent, history, day, at, mid);
    return price === undefined ? undefined : { price, at, mid };
  }
  function cross(a: number, b: number, level: number, above: boolean): number | undefined {
    if (above ? a >= level : a <= level) return 0;
    if (above ? b < level : b > level) return undefined;
    return (level - a) / (b - a);
  }
  async function advance(): Promise<void> {
    settle();
    const now = deps.clock.now();
    for (const order of orders.filter((o) => o.status === "open")) {
      const { intent } = order;
      const history = await deps.bars(intent.symbol);
      const bars = history.filter((b) => b.date >= deps.calendar.etDate(order.checkedAt) && b.date <= date());
      for (const bar of bars) {
        const from = Math.max(order.checkedAt, order.createdAt);
        const points = execution === "ideal"
          ? pathSegment(bar, from, now)
          : realisticSegment(bar, intent.symbol, seed, from, now);
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
        if (order.status === "open" && intent.timeInForce === "day" && now >= etInstant(bar.date, 16)) order.status = "cancelled";
        if (order.status !== "open") break;
      }
      order.checkedAt = now;
    }
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
    async cancelOrder(id) { cancel(id); },
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
      settle();
      if (deps.clock.now() < etInstant(date(), 9, 30) || deps.clock.now() >= etInstant(date(), 16)) throw new Error("Simulation market is closed");
      if (intent.orderType === "stop_limit" && intent.stopPrice === undefined) throw new Error("Stop price required");
      if (intent.side === "buy" && intent.quantity * intent.limitPrice > settled - reservedCash() + 1e-8) throw new Error("Insufficient settled cash");
      const reservedShares = orders.filter((o) => o.status === "open" && o.intent.side === "sell" && o.intent.symbol === intent.symbol).reduce((sum, o) => sum + o.intent.quantity, 0);
      if (intent.side === "sell" && intent.quantity > (holdings.get(intent.symbol)?.quantity ?? 0) - reservedShares + 1e-8) throw new Error("Insufficient shares");
      const q = await quote(intent.symbol);
      // A marketable fractional equity intent converts to market; it never rests.
      const { market = false } = fractionalExecution(intent, q, true);
      const order: PaperOrder = { id: randomUUID(), intent: structuredClone(intent), createdAt: deps.clock.now(), checkedAt: deps.clock.now(), status: "open",
        triggered: intent.orderType === "limit" || (intent.side === "buy" ? q.last >= intent.stopPrice! : q.last <= intent.stopPrice!) };
      if (order.triggered) {
        const fillSpec = await marketableFill(intent, order.createdAt, q, market);
        if (market && fillSpec === undefined) throw new Error("Paper market order has no executable quote");
        if (fillSpec !== undefined) fill(order, fillSpec.price, fillSpec.at, fillSpec.mid);
      }
      orders.push(order);
      return { brokerOrderId: order.id, raw: `Simulated order ${order.status}` };
    },
    advance,
    orders: () => structuredClone(orders),
    fills: () => structuredClone(fills),
    cancel,
  };
}
