import type {
  HaltReason,
  JournalEntry,
  OrderRecord,
  PushPayload,
  ServerEvent,
  SimRun,
  StatusResponse,
} from "@rh/shared";
import type { EventBus, Logger } from "../ports.ts";
import type { PushService } from "./service.ts";

export interface NotifierDeps {
  bus: EventBus;
  push: PushService;
  log: Logger;
  /** Defaults to Date.now; inject a fake clock in tests to control the debounce. */
  now?: () => number;
}

/** The same tag is not pushed twice inside this window. */
const DEBOUNCE_MS = 60_000;

/** Only these halts page the phone; mode_off and broker_disconnected have their own signals. */
const NOTIFY_HALTS = new Set<HaltReason>(["daily_loss", "drawdown", "kill_switch"]);

const HALT_LABELS: Record<"daily_loss" | "drawdown" | "kill_switch", string> = {
  daily_loss: "Daily loss limit reached",
  drawdown: "Monthly drawdown limit reached",
  kill_switch: "Kill switch engaged",
};

function formatQty(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(4)));
}

function firstSentence(text: string): string {
  const sentence = (text.match(/^.*?[.!?](\s|$)/s)?.[0] ?? text).trim();
  return sentence.length > 280 ? `${sentence.slice(0, 277)}…` : sentence;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}

/**
 * Watches the bus and pushes what matters in an automatic system: fills and
 * failures, trading halts, agent/broker disconnects, the post-close review,
 * and finished simulations. Simulation live events carry `simRunId` and are
 * ignored; only the terminal `sim` run event notifies.
 *
 * Sending never throws into the bus: failures are logged and dropped.
 */
export function startNotifier(deps: NotifierDeps): () => void {
  const { bus, push, log } = deps;
  const now = deps.now ?? Date.now;
  /** Order ids already notified, per id and status. */
  const seenOrders = new Set<string>();
  /** Simulation runs already notified, per run id. */
  const seenSims = new Set<string>();
  /** Last push time per tag, for the debounce. */
  const lastSentByTag = new Map<string, number>();
  let lastHalts: HaltReason[] = [];
  let lastAgentState: string | undefined;
  let lastBrokerState: string | undefined;
  /** ISO day of the last post-close summary, so there is at most one a day. */
  let lastReviewDay: string | undefined;
  /** ISO day of the last pre-open plan, so the morning brief is sent at most once a day. */
  let lastBriefDay: string | undefined;

  function deliver(payload: PushPayload): void {
    try {
      if (payload.tag !== undefined) {
        const at = now();
        const last = lastSentByTag.get(payload.tag);
        if (last !== undefined && at - last < DEBOUNCE_MS) return;
        lastSentByTag.set(payload.tag, at);
      }
      void Promise.resolve()
        .then(() => push.send(payload))
        .then(
          (result) => {
            log.info("push sent", { tag: payload.tag, ...result });
          },
          (error: unknown) => {
            log.warn("push failed", { tag: payload.tag, error: errorMessage(error) });
          },
        );
    } catch (error) {
      log.warn("push failed", { tag: payload.tag, error: errorMessage(error) });
    }
  }

  function onOrder(order: OrderRecord): void {
    if (order.status !== "submitted" && order.status !== "failed") return;
    const key = `${order.id}:${order.status}`;
    if (seenOrders.has(key)) return;
    seenOrders.add(key);
    if (order.status === "submitted") {
      const { side, symbol, quantity, limitPrice, thesis } = order.intent;
      const notional = quantity * limitPrice;
      deliver({
        title: `${side === "buy" ? "Bought" : "Sold"} ${formatQty(quantity)} ${symbol}`,
        body: `Limit $${limitPrice.toFixed(2)} · $${notional.toFixed(2)} notional. ${firstSentence(thesis)}`,
        url: `/?order=${order.id}`,
        tag: `order-${order.id}`,
      });
      return;
    }
    deliver({
      title: "Order failed",
      body: `${order.intent.symbol}: ${(order.error ?? "unknown error").slice(0, 160)}`,
      url: `/?order=${order.id}`,
      // A distinct tag from the submitted notice so a fast submit-then-fail still pages twice.
      tag: `order-${order.id}-failed`,
    });
  }

  function onStatus(status: StatusResponse): void {
    const fresh = status.halts.filter((halt) => NOTIFY_HALTS.has(halt) && !lastHalts.includes(halt));
    lastHalts = [...status.halts];
    if (fresh.length > 0) {
      const labels = fresh.map((halt) => HALT_LABELS[halt as keyof typeof HALT_LABELS]);
      deliver({
        title: "Trading halted",
        body: `${labels.join("; ")} — new entries are paused.`,
        tag: "halt",
      });
    }
    if (status.agent.state === "needs_login" && lastAgentState !== "needs_login") {
      deliver({
        title: "Muse sign-in needed",
        body: "The trading agent needs sign-in to continue.",
        tag: "agent",
      });
    }
    lastAgentState = status.agent.state;
    if (
      (status.broker.state === "needs_auth" || status.broker.state === "error") &&
      lastBrokerState === "connected"
    ) {
      deliver({
        title: "Robinhood disconnected",
        body: "The Robinhood connection dropped — reconnect to resume trading.",
        tag: "broker",
      });
    }
    lastBrokerState = status.broker.state;
  }

  function onJournal(entry: JournalEntry): void {
    const day = new Date(entry.at).toISOString().slice(0, 10);
    if (entry.cycleId?.startsWith("pre_open")) {
      if (lastBriefDay === day) return;
      lastBriefDay = day;
      deliver({ title: "Morning plan", body: entry.summary, tag: "brief" });
      return;
    }
    if (entry.cycleId === undefined || !entry.cycleId.startsWith("post_close")) return;
    if (lastReviewDay === day) return;
    lastReviewDay = day;
    deliver({ title: "Day review", body: entry.summary, tag: "review" });
  }

  function onSim(run: SimRun): void {
    if (run.status !== "done" && run.status !== "failed") return;
    if (seenSims.has(run.id)) return;
    seenSims.add(run.id);
    if (run.status === "done") {
      const metrics = run.metrics;
      const signed = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
      deliver({
        title: "Simulation finished",
        body:
          metrics !== undefined
            ? `Return ${signed(metrics.returnPct)} vs benchmark ${signed(metrics.benchmarkReturnPct)} over ${run.config.days}d, ${metrics.trades} trades.`
            : "The simulation run completed.",
        url: `/?sim=${run.id}`,
        tag: `sim-${run.id}`,
      });
      return;
    }
    deliver({
      title: "Simulation failed",
      body: (run.error ?? "The simulation run failed.").slice(0, 200),
      url: `/?sim=${run.id}`,
      tag: `sim-${run.id}`,
    });
  }

  return bus.subscribe((event: ServerEvent) => {
    try {
      if (event.type !== "sim") {
        const simRunId = event.type === "status" ? undefined : event.simRunId;
        if (simRunId !== undefined) return;
      }
      switch (event.type) {
        case "order":
          onOrder(event.order);
          break;
        case "status":
          onStatus(event.status);
          break;
        case "journal":
          onJournal(event.entry);
          break;
        case "sim":
          onSim(event.run);
          break;
        default:
          break;
      }
    } catch (error) {
      log.warn("push notify failed", { error: errorMessage(error) });
    }
  });
}
