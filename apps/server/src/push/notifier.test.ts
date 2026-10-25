import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  type OrderRecord,
  type PushPayload,
  type ServerEvent,
  type SimRun,
  type StatusResponse,
} from "@rh/shared";
import { createEventBus } from "../events.ts";
import { startNotifier } from "./notifier.ts";
import type { PushSendResult, PushService } from "./service.ts";
import type { EventBus, Logger } from "../ports.ts";

const NOW = new Date("2026-10-26T14:00:00Z").getTime();

const log: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => log,
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

function fakePush(): PushService & { payloads: PushPayload[] } {
  const payloads: PushPayload[] = [];
  return {
    payloads,
    publicKey: () => Promise.resolve("test-key"),
    subscribe: () => Promise.resolve(),
    unsubscribe: () => Promise.resolve(true),
    send: (payload: PushPayload): Promise<PushSendResult> => {
      payloads.push(payload);
      return Promise.resolve({ sent: 1, removed: 0 });
    },
  };
}

function orderRecord(overrides?: Partial<OrderRecord>): OrderRecord {
  return {
    id: "o1",
    createdAt: NOW,
    updatedAt: NOW,
    intent: {
      symbol: "NVDA",
      side: "buy",
      quantity: 0.62,
      orderType: "limit",
      limitPrice: 187.42,
      timeInForce: "day",
      invalidationPrice: 175,
      timeStopDate: "2026-11-06",
      thesis: "NVDA breaks out above resistance on strong volume. Momentum should carry it higher.",
      probabilityWin: 0.6,
      expectedGainPct: 8,
      expectedLossPct: 5,
      estimatedCostPct: 0.1,
      evidence: ["price action from market data on 2026-10-24"],
    },
    verdict: { approved: true, isExit: false, checks: [] },
    status: "submitted",
    ...overrides,
  };
}

function statusResponse(
  halts: StatusResponse["halts"] = [],
  agentState: StatusResponse["agent"]["state"] = "idle",
  brokerState: StatusResponse["broker"]["state"] = "connected",
): StatusResponse {
  return {
    liveTrading: false,
    models: { main: "openai-codex/gpt-6.1-sol#xhigh", subagents: "meta/muse-spark-1.3-contributor#xhigh" },
    agent: { state: agentState, model: "muse-spark" },
    broker: { state: brokerState, tools: [] },
    market: {
      now: NOW,
      session: "regular",
      isOpen: true,
      tradingDay: "2026-10-26",
      nextOpen: NOW,
      nextClose: NOW,
      earlyClose: false,
    },
    settings: structuredClone(DEFAULT_SETTINGS),
    account: null,
    halts,
  };
}

function simRun(status: SimRun["status"], id = "sim1"): SimRun {
  return {
    id,
    createdAt: NOW,
    startedBy: "user",
    config: { startDate: "2026-09-01", days: 20, startingCash: 1200, cyclesPerDay: 2 },
    status,
    progress: { day: 20, days: 20, cycle: 2, cyclesPerDay: 2 },
    equity: [],
    positions: [],
    fills: [],
    metrics:
      status === "done"
        ? {
            returnPct: 12.3,
            benchmarkReturnPct: 8.1,
            maxDrawdownPct: 2,
            trades: 15,
            exposurePct: 40,
            ordersSubmitted: 15,
            ordersRejected: 1,
          }
        : undefined,
  };
}

describe("push notifier", () => {
  let bus: EventBus;
  let push: PushService & { payloads: PushPayload[] };
  let nowMs: number;

  beforeEach(() => {
    bus = createEventBus();
    push = fakePush();
    nowMs = NOW;
    startNotifier({ bus, push, log, now: () => nowMs });
  });

  it("sends once for a submitted order and again on failure", async () => {
    const order = orderRecord();
    bus.publish({ type: "order", order });
    bus.publish({ type: "order", order });
    await flush();
    assert.equal(push.payloads.length, 1);
    const first = push.payloads[0];
    assert.ok(first);
    assert.equal(first.title, "Bought 0.62 NVDA");
    assert.equal(first.tag, "order-o1");
    assert.equal(first.url, "/?order=o1");
    assert.match(first.body, /187\.42/);
    assert.match(first.body, /NVDA breaks out above resistance on strong volume\./);

    bus.publish({ type: "order", order: { ...order, status: "failed", error: "broker rejected: insufficient buying power" } });
    await flush();
    assert.equal(push.payloads.length, 2);
    const failed = push.payloads[1];
    assert.ok(failed);
    assert.equal(failed.title, "Order failed");
    assert.match(failed.body, /NVDA/);
    assert.match(failed.body, /insufficient buying power/);
  });

  it("says Sold with a whole quantity", async () => {
    bus.publish({
      type: "order",
      order: orderRecord({ intent: { ...orderRecord().intent, side: "sell", symbol: "XLE", quantity: 3 } }),
    });
    await flush();
    const first = push.payloads[0];
    assert.ok(first);
    assert.equal(first.title, "Sold 3 XLE");
  });

  it("ignores order events from simulation runs", async () => {
    bus.publish({ type: "order", order: orderRecord(), simRunId: "sim1" });
    await flush();
    assert.equal(push.payloads.length, 0);
  });

  it("notifies only when a halt is newly added, debounced per tag", async () => {
    bus.publish({ type: "status", status: statusResponse(["daily_loss"]) });
    bus.publish({ type: "status", status: statusResponse(["daily_loss"]) });
    await flush();
    assert.equal(push.payloads.length, 1);
    const halt = push.payloads[0];
    assert.ok(halt);
    assert.equal(halt.title, "Trading halted");
    assert.equal(halt.tag, "halt");
    assert.match(halt.body, /Daily loss limit reached/);

    // Cleared, then re-added inside the debounce window: still one push.
    nowMs += 10_000;
    bus.publish({ type: "status", status: statusResponse([]) });
    bus.publish({ type: "status", status: statusResponse(["daily_loss"]) });
    await flush();
    assert.equal(push.payloads.length, 1);

    // After the window the re-added halt pages again.
    nowMs += 61_000;
    bus.publish({ type: "status", status: statusResponse([]) });
    bus.publish({ type: "status", status: statusResponse(["daily_loss", "kill_switch"]) });
    await flush();
    assert.equal(push.payloads.length, 2);
    const second = push.payloads[1];
    assert.ok(second);
    assert.match(second.body, /Kill switch engaged/);
  });

  it("pages on agent sign-in and on broker drops after connected", async () => {
    bus.publish({ type: "status", status: statusResponse([], "running", "connected") });
    await flush();
    assert.equal(push.payloads.length, 0);

    bus.publish({ type: "status", status: statusResponse([], "needs_login", "connected") });
    bus.publish({ type: "status", status: statusResponse([], "needs_login", "needs_auth") });
    await flush();
    assert.equal(push.payloads.length, 2);
    assert.equal(push.payloads[0]?.title, "Muse sign-in needed");
    assert.equal(push.payloads[0]?.tag, "agent");
    assert.equal(push.payloads[1]?.title, "Robinhood disconnected");
    assert.equal(push.payloads[1]?.tag, "broker");

    // A broker error without a preceding connected state stays silent.
    nowMs += 61_000;
    bus.publish({ type: "status", status: statusResponse([], "idle", "disconnected") });
    bus.publish({ type: "status", status: statusResponse([], "idle", "error") });
    await flush();
    assert.equal(push.payloads.length, 2);
  });

  it("stays silent on post-close journal entries: the daily report replaces the day review", async () => {
    const entry = {
      id: "j1",
      at: NOW,
      cycleId: "post_close_2026-10-26",
      action: "hold" as const,
      summary: "Flat day, no entries. Awaiting breakout.",
      rationale: "No setups met the bar.",
      evidence: [],
    };
    bus.publish({ type: "journal", entry });
    bus.publish({ type: "journal", entry: { ...entry, id: "j2" } });
    await flush();
    assert.equal(push.payloads.length, 0);
  });

  it("pushes published reports with the headline and a deep link", async () => {
    const daily = {
      id: "daily-2026-10-26",
      kind: "daily" as const,
      at: NOW,
      periodStart: "2026-10-26",
      periodEnd: "2026-10-26",
      headline: "Flat day, no entries; one stop exit held the loss to plan.",
      pnl: 12.3,
      pnlPct: 1.02,
    };
    bus.publish({ type: "report", report: daily });
    bus.publish({ type: "report", report: daily });
    const weekly = {
      id: "weekly-2026-10-26",
      kind: "weekly" as const,
      at: NOW,
      periodStart: "2026-10-26",
      periodEnd: "2026-10-30",
      headline: "Up 2% on two disciplined exits.",
    };
    bus.publish({ type: "report", report: weekly });
    const trade = {
      id: "trade-NVDA-123",
      kind: "trade" as const,
      at: NOW,
      symbol: "NVDA",
      periodStart: "2026-10-20",
      periodEnd: "2026-10-26",
      headline: "Sold NVDA into strength at the time stop.",
      grade: "B" as const,
    };
    bus.publish({ type: "report", report: trade });
    await flush();
    // The duplicate daily publish collapses onto the same tag.
    assert.equal(push.payloads.length, 3);
    assert.equal(push.payloads[0]?.title, "Daily report");
    assert.equal(push.payloads[0]?.tag, "report-daily-2026-10-26");
    assert.equal(push.payloads[0]?.url, "/?report=daily-2026-10-26");
    assert.equal(push.payloads[0]?.body, daily.headline);
    assert.equal(push.payloads[1]?.title, "Weekly report");
    assert.equal(push.payloads[1]?.tag, "report-weekly-2026-10-26");
    assert.equal(push.payloads[2]?.title, "Trade report · NVDA");
    assert.equal(push.payloads[2]?.tag, "report-trade-NVDA-123");
    assert.equal(push.payloads[2]?.url, "/?report=trade-NVDA-123");
  });

  it("ignores report events from simulation runs", async () => {
    bus.publish({
      type: "report",
      report: {
        id: "daily-2026-10-26",
        kind: "daily",
        at: NOW,
        periodStart: "2026-10-26",
        periodEnd: "2026-10-26",
        headline: "Sim day.",
      },
      simRunId: "sim1",
    });
    await flush();
    assert.equal(push.payloads.length, 0);
  });

  it("sends one morning plan per day from the pre-open cycle", async () => {
    const entry = {
      id: "b1",
      at: NOW,
      cycleId: "pre_open_2026-10-26",
      action: "watch" as const,
      summary: "Sideways tape; exit CDNS before earnings, watch AAPL above 330.",
      rationale: "Plan for the day.",
      evidence: [],
    };
    bus.publish({ type: "journal", entry });
    bus.publish({ type: "journal", entry: { ...entry, id: "b2" } });
    await flush();
    assert.equal(push.payloads.length, 1);
    assert.equal(push.payloads[0]?.title, "Morning plan");
    assert.equal(push.payloads[0]?.tag, "brief");
    assert.equal(push.payloads[0]?.body, entry.summary);
  });

  it("notifies when a simulation finishes or fails, once per run", async () => {
    bus.publish({ type: "sim", run: simRun("running") });
    await flush();
    assert.equal(push.payloads.length, 0);

    bus.publish({ type: "sim", run: simRun("done") });
    bus.publish({ type: "sim", run: simRun("done") });
    await flush();
    assert.equal(push.payloads.length, 1);
    const done = push.payloads[0];
    assert.ok(done);
    assert.equal(done.title, "Simulation finished");
    assert.equal(done.tag, "sim-sim1");
    assert.equal(done.url, "/?sim=sim1");
    assert.match(done.body, /\+12\.3%/);
    assert.match(done.body, /\+8\.1%/);

    bus.publish({ type: "sim", run: { ...simRun("failed", "sim2"), error: "data gap on 2026-09-14" } });
    await flush();
    assert.equal(push.payloads.length, 2);
    assert.equal(push.payloads[1]?.title, "Simulation failed");
    assert.match(push.payloads[1]?.body ?? "", /data gap/);
  });

  it("stops after unsubscribe and never throws into the bus", async () => {
    const off = startNotifier({ bus, push, log, now: () => nowMs });
    off();
    bus.publish({ type: "order", order: orderRecord() });
    bus.publish({ type: "order", order: undefined as never });
    await flush();
    assert.equal(push.payloads.length, 1);
  });
});

describe("push notifier event filtering", () => {
  it("ignores non-terminal sim runs and unrelated events", async () => {
    const bus = createEventBus();
    const push = fakePush();
    startNotifier({ bus, push, log });
    const event: ServerEvent = {
      type: "message",
      message: { id: "m1", at: NOW, role: "assistant", text: "hello" },
      simRunId: "sim9",
    };
    bus.publish(event);
    bus.publish({ type: "status", status: statusResponse() });
    await flush();
    assert.equal(push.payloads.length, 0);
  });
});
