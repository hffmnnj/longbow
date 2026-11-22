import { randomUUID } from "node:crypto";
import type { Bar, OrderIntent, OrderRecord, Position, SimExecution, SimFill } from "@rh/shared";
import type { Clock, MarketCalendar } from "../ports.ts";
import type { TradingBroker } from "../risk/stops.ts";
import { equityFees } from "../fees.ts";
import { fractionalExecution } from "../robinhood/mapping.ts";
import { etInstant, pathPrice, pathSegment, realisticPrice, realisticSegment, sessionFraction } from "./path.ts";
import { avgDollarVolumeBefore, halfSpreadBps, returnVolatilityBefore, slippageBps } from "./execution.ts";
import { paperSettlementDate } from "./settlement.ts";

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
  bookCashDividends(exDate: string, dividends: readonly CashDividend[]): void;
}
export interface CashDividend {
  symbol: string;
  amountPerShare: number;
  payDate: string;
}
export interface ObservedMinutes {
  open: number;
  /** In order from the start of the session; each close becomes known one minute later. */
  closes: readonly number[];
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
  /** Blind/bootstrap dates are fictional weekdays, not historical clearing dates. */
  fictionalDates?: boolean;
  /** Local historical observations on the daily tape's price basis, not quotes. */
  observedMinutes?: (symbol: string, date: string) => ObservedMinutes | undefined;
}

const LIQUID = new Set(["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "META", "TSLA", "AVGO"]);
const RECORDED_PRICE_TOLERANCE = 0.05;
export function createPaperBroker(deps: PaperBrokerDeps): PaperBroker {
  const execution: SimExecution = deps.execution ?? "realistic";
  const seed = deps.seed ?? 1;
  let settled = deps.startingCash;
  const receivables: { settlesOn: string; amount: number }[] = [];
  let lastDividendDate = "";
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
  const observed = new Map<string, ObservedMinutes | undefined>();
  function minutes(symbol: string, bar: Bar): ObservedMinutes | undefined {
    if (execution !== "realistic" || deps.fictionalDates || deps.observedMinutes === undefined) return undefined;
    const day = bar.date;
    const key = `${symbol}:${day}`;
    if (observed.has(key)) return observed.get(key);
    const data = deps.observedMinutes(symbol, day);
    if (data !== undefined) {
      const bounds = session(day);
      const count = (bounds.nextClose - bounds.nextOpen) / 60_000;
      if (bounds.tradingDay !== day || data.closes.length !== count ||
          ![data.open, ...data.closes].every((price) => Number.isFinite(price) && price > 0)) {
        throw new Error(`Invalid recorded minute tape for ${symbol} on ${day}`);
      }
      // Allow ordinary vendor differences in the opening print, not a
      // materially different open. Do not guess a corporate-action adjustment.
      const openRatio = data.open / bar.open;
      if (!Number.isFinite(openRatio) || openRatio < 1 - RECORDED_PRICE_TOLERANCE || openRatio > 1 + RECORDED_PRICE_TOLERANCE) {
        throw new Error(`Recorded minute open differs from the daily open by more than 5% for ${symbol} on ${day}; verify the price basis`);
      }
      // A matching open cannot validate a bad print later in the session.
      const low = bar.low * (1 - RECORDED_PRICE_TOLERANCE);
      const high = bar.high * (1 + RECORDED_PRICE_TOLERANCE);
      if (data.closes.some((price) => price < low || price > high)) {
        throw new Error(`Recorded minute close is outside the daily range by more than 5% for ${symbol} on ${day}; verify the price feed`);
      }
      observed.set(key, { open: data.open, closes: [...data.closes] });
    } else {
      observed.set(key, undefined);
    }
    return observed.get(key);
  }
  function realisticLast(bar: Bar, symbol: string, at: number): number {
    const bounds = session(bar.date);
    const tape = minutes(symbol, bar);
    if (tape === undefined) return realisticPrice(bar, symbol, seed, at, bounds.nextClose);
    const complete = Math.floor((at - bounds.nextOpen) / 60_000);
    return complete <= 0 ? tape.open : tape.closes[Math.min(complete, tape.closes.length) - 1]!;
  }
  function minuteObservations(tape: ObservedMinutes, open: number, from: number, to: number) {
    const first = Math.max(0, Math.ceil((from - open) / 60_000));
    const last = Math.min(tape.closes.length, Math.floor((to - open) / 60_000));
    const points: { at: number; price: number }[] = [];
    for (let i = first; i <= last; i++) {
      points.push({ at: open + 60_000 * i, price: i === 0 ? tape.open : tape.closes[i - 1]! });
    }
    return points;
  }
  function settle(day = date()): void {
    for (let i = receivables.length - 1; i >= 0; i--) {
      if (receivables[i]!.settlesOn <= day) { settled += receivables[i]!.amount; receivables.splice(i, 1); }
    }
  }
  function bookCashDividends(exDate: string, dividends: readonly CashDividend[]): void {
    if (dividends.length === 0) return;
    const bounds = session(exDate);
    if (deps.fictionalDates || date() !== exDate || bounds.tradingDay !== exDate ||
        deps.clock.now() !== bounds.nextOpen || exDate <= lastDividendDate) {
      throw new Error(`Cash dividends require a new historical session at its open: ${exDate}`);
    }
    const seen = new Set<string>();
    const payments = dividends.map(({ symbol, amountPerShare, payDate }) => {
      const pay = Date.parse(`${payDate}T00:00:00Z`);
      const amount = (holdings.get(symbol)?.quantity ?? 0) * amountPerShare;
      if (!symbol || seen.has(symbol) || !Number.isFinite(amountPerShare) || amountPerShare <= 0 ||
          !Number.isFinite(amount) || !Number.isFinite(pay) || new Date(pay).toISOString().slice(0, 10) !== payDate || payDate < exDate) {
        throw new Error(`Invalid cash dividend for ${symbol} on ${exDate}`);
      }
      seen.add(symbol);
      return { settlesOn: payDate, amount };
    });
    lastDividendDate = exDate;
    receivables.push(...payments.filter(({ amount }) => amount > 0));
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
      receivables.push({ settlesOn: paperSettlementDate(deps.calendar.etDate(at), deps.calendar, deps.fictionalDates ?? false),
        amount: notional - fees });
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
    if (at < open) {
      // Keep the prior session's actual paper mark until the next opening print.
      if (previous !== undefined) last = minutes(symbol, previous)?.closes.at(-1) ?? previous.close;
    } else if (current !== undefined) last = execution === "ideal" ? pathPrice(current, sessionFraction(day, at, close)) : realisticLast(current, symbol, at);
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
    const events: ({ order: PaperOrder; at: number } &
      ({ kind: "fill"; price: number; mid: number } | { kind: "expire" }))[] = [];
    for (const order of orders.filter((o) => o.status === "open" && !delayed.has(o.id))) {
      const { intent } = order;
      const history = await deps.bars(intent.symbol);
      if (order.status !== "open") continue;
      const createdDay = deps.calendar.etDate(order.createdAt);
      const bars = history.filter((b) => b.date >= deps.calendar.etDate(order.checkedAt) && b.date <= day &&
        (intent.timeInForce !== "day" || b.date === createdDay));
      let matched = false;
      sessions: for (const bar of bars) {
        const bounds = session(bar.date);
        if (bounds.tradingDay !== bar.date) continue;
        const close = bounds.nextClose;
        const from = Math.max(order.checkedAt, order.createdAt);
        const tape = minutes(intent.symbol, bar);
        // The print already visible at placement cannot fill a new resting order.
        const points = tape !== undefined
          ? minuteObservations(tape, bounds.nextOpen, Math.max(from, order.createdAt + 1), now)
          : execution === "ideal" ? pathSegment(bar, from, now, close) : realisticSegment(bar, intent.symbol, seed, from, now, close);
        // A resting limit fills only on a trade through the limit: a touch is
        // not enough in realistic mode, so the level sits a cent beyond it.
        const through = execution === "ideal" ? intent.limitPrice : intent.limitPrice + (intent.side === "sell" ? 0.01 : -0.01);
        for (let i = 0; i < points.length && order.status === "open"; i++) {
          let a = points[i]!;
          // The minute observations do not tell us what traded between the samples.
          const b = tape === undefined ? (points[i + 1] ?? a) : a;
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
            // A limit already resting before a new session can get a better
            // modeled opening price. A later passive trade-through still fills at the limit.
            const openingPrice = triggerPrice === undefined && execution === "realistic" && ratio === 0 &&
              a.at === bounds.nextOpen && order.createdAt < bounds.nextOpen
              ? executablePrice(intent, history, bar.date, a.at, a.price)
              : undefined;
            events.push({ kind: "fill", order, price: triggerPrice ?? openingPrice ?? intent.limitPrice,
              at: a.at + (b.at - a.at) * ratio, mid: a.price + (b.price - a.price) * ratio });
            matched = true;
            break sessions;
          }
        }
        if (intent.timeInForce === "day" && now >= close) break;
      }
      if (!matched && intent.timeInForce === "day" && now >= session(createdDay).nextClose) {
        events.push({ kind: "expire", order, at: session(createdDay).nextClose });
      }
      order.checkedAt = Math.max(order.checkedAt, now);
    }
    // Apply the matches in modeled time. Sorting the public fill list alone
    // cannot correct inventory and cost basis updated in placement order.
    for (const event of events.sort((a, b) => a.at - b.at)) {
      if (event.order.status !== "open") continue;
      if (event.kind === "expire") {
        event.order.status = "cancelled";
      } else {
        settle(deps.calendar.etDate(event.at));
        try { fill(event.order, event.price, event.at, event.mid); } catch { event.order.status = "cancelled"; }
      }
    }
  }
  async function reconcileOrders(): Promise<void> {
    const now = deps.clock.now();
    const dueTimes = [...new Set([...delayed.values()].map((attempt) => attempt.at).filter((at) => at <= now))].sort((a, b) => a - b);
    for (const at of dueTimes) {
      const day = deps.calendar.etDate(at);
      await advanceRestingOrders(at - 1);
      settle(day);
      for (const order of orders) {
        const attempt = delayed.get(order.id);
        if (order.status !== "open" || attempt?.at !== at) continue;
        const { intent } = order;
        const history = await deps.bars(intent.symbol);
        const bar = history.find((b) => b.date === day);
        const mid = bar === undefined ? undefined : realisticLast(bar, intent.symbol, at);
        delayed.delete(order.id);
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
    await advanceRestingOrders(now);
    settle(deps.calendar.etDate(now));
  }
  let advancing: Promise<void> | undefined;
  function advance(): Promise<void> {
    advancing ??= reconcileOrders().finally(() => { advancing = undefined; });
    return advancing;
  }
  return {
    bookCashDividends,
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
      const cash = settled + receivables.reduce((sum, p) => sum + p.amount, 0);
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
