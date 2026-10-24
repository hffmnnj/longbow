import { randomUUID } from "node:crypto";
import type { Bar, OrderIntent, Position, SimFill } from "@rh/shared";
import type { Broker, Clock, MarketCalendar } from "../ports.ts";
import { etInstant, pathPrice, pathSegment, sessionFraction } from "./path.ts";

export interface PaperOrder {
  id: string;
  intent: OrderIntent;
  createdAt: number;
  checkedAt: number;
  status: "open" | "filled" | "cancelled";
  triggered: boolean;
}
export interface PaperBroker extends Broker {
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
}

const LIQUID = new Set(["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "META", "TSLA", "AVGO"]);
export function createPaperBroker(deps: PaperBrokerDeps): PaperBroker {
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
  function fill(order: PaperOrder, price: number, at: number): void {
    const { intent } = order;
    const held = holdings.get(intent.symbol) ?? { quantity: 0, cost: 0 };
    const notional = price * intent.quantity;
    if (intent.side === "buy") {
      if (notional > settled + 1e-8) throw new Error("Insufficient settled cash");
      settled -= notional;
      holdings.set(intent.symbol, { quantity: held.quantity + intent.quantity, cost: held.cost + notional,
        ...(intent.sector === undefined ? {} : { sector: intent.sector }) });
    } else {
      if (intent.quantity > held.quantity + 1e-8) throw new Error("Insufficient shares");
      const quantity = Math.max(0, held.quantity - intent.quantity);
      if (quantity < 1e-8) holdings.delete(intent.symbol);
      else holdings.set(intent.symbol, { ...held, quantity, cost: held.cost * quantity / held.quantity });
      proceeds.push({ date: deps.calendar.etDate(at), amount: notional });
    }
    order.status = "filled";
    fills.push({ at, date: deps.calendar.etDate(at), symbol: intent.symbol, side: intent.side, quantity: intent.quantity, price, orderId: order.id });
  }
  async function quote(symbol: string) {
    const at = deps.clock.now();
    const day = date();
    const bars = await deps.bars(symbol);
    const current = bars.find((b) => b.date === day);
    const previous = bars.filter((b) => b.date < day).at(-1);
    const last = at < etInstant(day, 9, 30) ? previous?.close : current === undefined ? undefined : pathPrice(current, sessionFraction(day, at));
    if (last === undefined || !Number.isFinite(last) || last <= 0) throw new Error(`No historical quote for ${symbol} on ${day}`);
    const spread = last * (LIQUID.has(symbol) ? 1 : 3) / 10_000;
    return { symbol, at, last, bid: last - spread, ask: last + spread };
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
      const bars = (await deps.bars(intent.symbol)).filter((b) => b.date >= deps.calendar.etDate(order.checkedAt) && b.date <= date());
      for (const bar of bars) {
        const points = pathSegment(bar, Math.max(order.checkedAt, order.createdAt), now);
        for (let i = 0; i < points.length && order.status === "open"; i++) {
          let a = points[i]!;
          const b = points[i + 1] ?? a;
          if (!order.triggered) {
            const ratio = cross(a.price, b.price, intent.stopPrice!, intent.side === "buy");
            if (ratio === undefined) continue;
            a = { price: a.price + (b.price - a.price) * ratio, at: a.at + (b.at - a.at) * ratio };
            order.triggered = true;
          }
          const ratio = cross(a.price, b.price, intent.limitPrice, intent.side === "sell");
          if (ratio !== undefined) {
            // A resting order that can no longer fill (shares already sold, cash spent) cancels like a broker reject.
            try {
              fill(order, intent.limitPrice, a.at + (b.at - a.at) * ratio);
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
    async snapshot() {
      settle();
      const positions: Position[] = await Promise.all([...holdings].map(async ([symbol, held]) => {
        const mark = (await quote(symbol)).last;
        return { symbol, quantity: held.quantity, averageCost: held.cost / held.quantity, marketValue: mark * held.quantity,
          unrealizedPnl: mark * held.quantity - held.cost, ...(held.sector === undefined ? {} : { sector: held.sector }) };
      }));
      const cash = settled + proceeds.reduce((sum, p) => sum + p.amount, 0);
      return { at: deps.clock.now(), cash, settledCash: settled - reservedCash(), buyingPower: settled - reservedCash(),
        equity: cash + positions.reduce((sum, p) => sum + p.marketValue, 0), positions };
    },
    async reviewOrder(intent) { return `Simulated review: ${intent.side} ${intent.quantity} ${intent.symbol} limit ${intent.limitPrice}`; },
    async placeOrder(intent) {
      settle();
      if (deps.clock.now() < etInstant(date(), 9, 30) || deps.clock.now() >= etInstant(date(), 16)) throw new Error("Simulation market is closed");
      if (intent.orderType === "stop_limit" && intent.stopPrice === undefined) throw new Error("Stop price required");
      if (intent.side === "buy" && intent.quantity * intent.limitPrice > settled - reservedCash() + 1e-8) throw new Error("Insufficient settled cash");
      const reservedShares = orders.filter((o) => o.status === "open" && o.intent.side === "sell" && o.intent.symbol === intent.symbol).reduce((sum, o) => sum + o.intent.quantity, 0);
      if (intent.side === "sell" && intent.quantity > (holdings.get(intent.symbol)?.quantity ?? 0) - reservedShares + 1e-8) throw new Error("Insufficient shares");
      const q = await quote(intent.symbol);
      const order: PaperOrder = { id: randomUUID(), intent: structuredClone(intent), createdAt: deps.clock.now(), checkedAt: deps.clock.now(), status: "open",
        triggered: intent.orderType === "limit" || (intent.side === "buy" ? q.last >= intent.stopPrice! : q.last <= intent.stopPrice!) };
      orders.push(order);
      if (order.triggered && (intent.side === "buy" ? intent.limitPrice >= q.ask : intent.limitPrice <= q.bid)) fill(order, intent.side === "buy" ? q.ask : q.bid, deps.clock.now());
      return { brokerOrderId: order.id, raw: `Simulated order ${order.status}` };
    },
    advance,
    orders: () => structuredClone(orders),
    fills: () => structuredClone(fills),
    cancel(id) { const order = orders.find((o) => o.id === id); if (order === undefined || order.status !== "open") throw new Error("Unknown open order"); order.status = "cancelled"; },
  };
}
