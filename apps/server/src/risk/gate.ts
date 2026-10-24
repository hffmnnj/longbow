import {
  OrderIntentSchema,
  type AccountSnapshot,
  type HaltReason,
  type OrderIntent,
  type OrderRecord,
  type RiskVerdict,
} from "@rh/shared";
import { etDayEndEpoch } from "./calendar.ts";
import { evaluate, sevenDaysAgo } from "./engine.ts";
import type { Broker, Clock, EventBus, Logger, MarketCalendar, OrderGate, Store } from "../ports.ts";

/**
 * Order gate: validates the intent, gathers a fresh snapshot and quote,
 * runs the risk engine, and stores the order as rejected_risk,
 * pending_approval, submitted, or failed. All operations run through a
 * promise chain so two concurrent submits cannot both pass a counting check.
 */

export interface OrderGateDeps {
  store: Store;
  broker: Broker;
  calendar: MarketCalendar;
  clock: Clock;
  bus: EventBus;
  log: Logger;
}

function shortError(error: unknown, max = 200): string {
  const text = error instanceof Error ? error.message : String(error);
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function failedVerdict(detail: string): RiskVerdict {
  return { approved: false, isExit: false, checks: [{ rule: "broker", ok: false, detail }] };
}

export function createOrderGate(deps: OrderGateDeps): OrderGate {
  const { store, broker, calendar, clock, bus, log } = deps;
  let tail: Promise<unknown> = Promise.resolve();
  let latestSnapshot: AccountSnapshot | null = null;

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = tail.then(work, work);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function publish(order: OrderRecord): void {
    bus.publish({ type: "order", order });
  }

  function isExpired(order: OrderRecord, now: number): boolean {
    return order.status === "pending_approval" && now >= etDayEndEpoch(calendar.etDate(order.createdAt));
  }

  /** Marks every stale pending order expired. Returns the ones it expired. */
  function sweepExpired(now: number): OrderRecord[] {
    const expired: OrderRecord[] = [];
    for (const order of store.ordersSince(0)) {
      if (isExpired(order, now)) {
        const updated = store.updateOrder(order.id, { status: "expired", updatedAt: now });
        publish(updated);
        log.info("order expired", {
          orderId: updated.id,
          symbol: updated.intent.symbol,
          side: updated.intent.side,
          quantity: updated.intent.quantity,
        });
        expired.push(updated);
      }
    }
    return expired;
  }

  function persistDrawdownTrip(settings: { drawdownHalted: boolean }, verdict: RiskVerdict): void {
    const tripped = verdict.checks.some((c) => c.rule === "drawdown" && !c.ok);
    if (tripped && !settings.drawdownHalted) {
      store.patchSettings({ drawdownHalted: true });
      log.warn("drawdown breaker tripped", {});
    }
  }

  async function submit(intent: OrderIntent, cycleId?: string): Promise<OrderRecord> {
    return enqueue(async () => {
      const now = clock.now();
      const parsed = OrderIntentSchema.safeParse(intent);
      if (!parsed.success) {
        const order = store.addOrder({
          createdAt: now,
          updatedAt: now,
          ...(cycleId === undefined ? {} : { cycleId }),
          intent,
          verdict: { approved: false, isExit: false, checks: [{ rule: "intent", ok: false, detail: parsed.error.issues[0]?.message ?? "invalid order intent" }] },
          status: "failed",
          error: shortError(`invalid order intent: ${parsed.error.issues[0]?.message ?? "unknown"}`),
        });
        publish(order);
        log.warn("order failed validation", { orderId: order.id });
        return order;
      }
      const valid = parsed.data;

      let snapshot: AccountSnapshot;
      try {
        snapshot = await broker.snapshot();
      } catch (error) {
        const order = store.addOrder({
          createdAt: now,
          updatedAt: now,
          ...(cycleId === undefined ? {} : { cycleId }),
          intent: valid,
          verdict: failedVerdict(`snapshot failed: ${shortError(error, 150)}`),
          status: "failed",
          error: shortError(error),
        });
        publish(order);
        log.warn("order failed on snapshot", { orderId: order.id, symbol: valid.symbol });
        return order;
      }
      latestSnapshot = snapshot;

      let quote: Awaited<ReturnType<Broker["quote"]>>;
      try {
        quote = await broker.quote(valid.symbol);
      } catch (error) {
        const order = store.addOrder({
          createdAt: now,
          updatedAt: now,
          ...(cycleId === undefined ? {} : { cycleId }),
          intent: valid,
          verdict: { ...failedVerdict(`quote failed: ${shortError(error, 150)}`), quote: undefined },
          status: "failed",
          error: shortError(error),
        });
        publish(order);
        log.warn("order failed on quote", { orderId: order.id, symbol: valid.symbol });
        return order;
      }

      const settings = store.getSettings();
      const market = calendar.clock(now);
      const recentOrders = store.ordersSince(sevenDaysAgo(now)).filter((o) => o.status === "submitted");
      const lotOpenedEtDate = store
        .ordersSince(0)
        .filter(
          (o) =>
            o.status === "submitted" && o.intent.side === "buy" && o.intent.symbol === valid.symbol,
        )
        .map((o) => calendar.etDate(o.createdAt))
        .sort()[0];
      const account = snapshot;
      const verdict = evaluate({
        intent: valid,
        settings,
        account,
        quote,
        market,
        equityMarks: store.equityMarks(calendar.etDate(now)),
        recentOrders,
        ...(lotOpenedEtDate === undefined ? {} : { lotOpenedEtDate }),
        sectorOf: (symbol: string) =>
          account.positions.find((p) => p.symbol === symbol)?.sector,
        tradingDaysBetween: (a: string, b: string) => calendar.tradingDaysBetween(a, b),
        now,
      });
      persistDrawdownTrip(settings, verdict);

      if (!verdict.approved) {
        const order = store.addOrder({
          createdAt: now,
          updatedAt: now,
          ...(cycleId === undefined ? {} : { cycleId }),
          intent: valid,
          verdict,
          status: "rejected_risk",
        });
        publish(order);
        log.info("order rejected by risk", {
          orderId: order.id,
          symbol: valid.symbol,
          side: valid.side,
          quantity: valid.quantity,
          status: order.status,
        });
        return order;
      }

      if (settings.mode !== "auto") {
        const order = store.addOrder({
          createdAt: now,
          updatedAt: now,
          ...(cycleId === undefined ? {} : { cycleId }),
          intent: valid,
          verdict,
          status: "pending_approval",
        });
        publish(order);
        log.info("order awaiting approval", {
          orderId: order.id,
          symbol: valid.symbol,
          side: valid.side,
          quantity: valid.quantity,
          status: order.status,
        });
        return order;
      }

      let review: string | undefined;
      try {
        review = await broker.reviewOrder(valid);
      } catch (error) {
        const order = store.addOrder({
          createdAt: now,
          updatedAt: clock.now(),
          ...(cycleId === undefined ? {} : { cycleId }),
          intent: valid,
          verdict,
          status: "failed",
          error: shortError(error),
        });
        publish(order);
        log.warn("order failed on review", { orderId: order.id, symbol: valid.symbol });
        return order;
      }
      try {
        const placed = await broker.placeOrder(valid);
        const order = store.addOrder({
          createdAt: now,
          updatedAt: clock.now(),
          ...(cycleId === undefined ? {} : { cycleId }),
          intent: valid,
          verdict,
          status: "submitted",
          review,
          brokerOrderId: placed.brokerOrderId,
        });
        publish(order);
        log.info("order submitted", {
          orderId: order.id,
          symbol: valid.symbol,
          side: valid.side,
          quantity: valid.quantity,
          status: order.status,
        });
        return order;
      } catch (error) {
        const order = store.addOrder({
          createdAt: now,
          updatedAt: clock.now(),
          ...(cycleId === undefined ? {} : { cycleId }),
          intent: valid,
          verdict,
          status: "failed",
          review,
          error: shortError(error),
        });
        publish(order);
        log.warn("order failed on place", { orderId: order.id, symbol: valid.symbol });
        return order;
      }
    });
  }

  async function approve(id: string): Promise<OrderRecord> {
    return enqueue(async () => {
      const now = clock.now();
      sweepExpired(now);
      const existing = store.getOrder(id);
      if (existing === undefined) throw new Error(`unknown order ${id}`);
      if (existing.status === "expired") return existing;
      if (existing.status !== "pending_approval") {
        throw new Error(`order ${id} is ${existing.status}, not pending approval`);
      }

      let snapshot: AccountSnapshot;
      let quote: Awaited<ReturnType<Broker["quote"]>>;
      try {
        snapshot = await broker.snapshot();
        quote = await broker.quote(existing.intent.symbol);
      } catch (error) {
        const order = store.updateOrder(id, {
          verdict: failedVerdict(`recheck failed: ${shortError(error, 150)}`),
          status: "failed",
          error: shortError(error),
          updatedAt: clock.now(),
        });
        publish(order);
        log.warn("approval failed on market data", { orderId: id, symbol: existing.intent.symbol });
        return order;
      }
      latestSnapshot = snapshot;

      const settings = store.getSettings();
      const checkAt = clock.now();
      const market = calendar.clock(checkAt);
      const recentOrders = store
        .ordersSince(sevenDaysAgo(checkAt))
        .filter((o) => o.status === "submitted");
      const lotOpenedEtDate = store
        .ordersSince(0)
        .filter(
          (o) =>
            o.status === "submitted" &&
            o.intent.side === "buy" &&
            o.intent.symbol === existing.intent.symbol,
        )
        .map((o) => calendar.etDate(o.createdAt))
        .sort()[0];
      const verdict = evaluate({
        intent: existing.intent,
        settings,
        account: snapshot,
        quote,
        market,
        equityMarks: store.equityMarks(calendar.etDate(checkAt)),
        recentOrders,
        ...(lotOpenedEtDate === undefined ? {} : { lotOpenedEtDate }),
        sectorOf: (symbol: string) =>
          snapshot.positions.find((p) => p.symbol === symbol)?.sector,
        tradingDaysBetween: (a: string, b: string) => calendar.tradingDaysBetween(a, b),
        now: checkAt,
      });
      persistDrawdownTrip(settings, verdict);

      if (!verdict.approved) {
        const order = store.updateOrder(id, {
          verdict,
          status: "rejected_risk",
          updatedAt: clock.now(),
        });
        publish(order);
        log.info("approval rejected by risk", {
          orderId: id,
          symbol: existing.intent.symbol,
          side: existing.intent.side,
          quantity: existing.intent.quantity,
          status: order.status,
        });
        return order;
      }

      let review: string | undefined;
      try {
        review = await broker.reviewOrder(existing.intent);
      } catch (error) {
        const order = store.updateOrder(id, {
          verdict,
          status: "failed",
          error: shortError(error),
          updatedAt: clock.now(),
        });
        publish(order);
        log.warn("approval failed on review", { orderId: id, symbol: existing.intent.symbol });
        return order;
      }
      try {
        const placed = await broker.placeOrder(existing.intent);
        const order = store.updateOrder(id, {
          verdict,
          status: "submitted",
          review,
          brokerOrderId: placed.brokerOrderId,
          updatedAt: clock.now(),
        });
        publish(order);
        log.info("order submitted", {
          orderId: id,
          symbol: existing.intent.symbol,
          side: existing.intent.side,
          quantity: existing.intent.quantity,
          status: order.status,
        });
        return order;
      } catch (error) {
        const order = store.updateOrder(id, {
          verdict,
          status: "failed",
          review,
          error: shortError(error),
          updatedAt: clock.now(),
        });
        publish(order);
        log.warn("approval failed on place", { orderId: id, symbol: existing.intent.symbol });
        return order;
      }
    });
  }

  async function reject(id: string, reason?: string): Promise<OrderRecord> {
    return enqueue(async () => {
      sweepExpired(clock.now());
      const existing = store.getOrder(id);
      if (existing === undefined) throw new Error(`unknown order ${id}`);
      if (existing.status !== "pending_approval") {
        throw new Error(`order ${id} is ${existing.status}, not pending approval`);
      }
      const order = store.updateOrder(id, {
        status: "rejected_user",
        ...(reason === undefined ? {} : { error: reason.slice(0, 300) }),
        updatedAt: clock.now(),
      });
      publish(order);
      log.info("order rejected by user", {
        orderId: id,
        symbol: existing.intent.symbol,
        side: existing.intent.side,
        quantity: existing.intent.quantity,
        status: order.status,
      });
      return order;
    });
  }

  async function halts(): Promise<HaltReason[]> {
    return enqueue(async () => {
      sweepExpired(clock.now());
      const settings = store.getSettings();
      const out: HaltReason[] = [];
      if (settings.killSwitch) out.push("kill_switch");
      if (settings.mode === "off") out.push("mode_off");
      if (broker.status().state !== "connected") out.push("broker_disconnected");
      if (latestSnapshot !== null) {
        const marks = store.equityMarks(calendar.etDate(clock.now()));
        if (
          marks.dayStart !== undefined &&
          latestSnapshot.equity <= marks.dayStart * (1 - settings.risk.dailyLossHaltPct / 100)
        ) {
          out.push("daily_loss");
        }
        if (
          settings.drawdownHalted ||
          (marks.monthPeak !== undefined &&
            latestSnapshot.equity <=
              marks.monthPeak * (1 - settings.risk.monthlyDrawdownHaltPct / 100))
        ) {
          out.push("drawdown");
        }
      }
      return out;
    });
  }

  return { submit, approve, reject, halts };
}
