import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type OrderRecord } from "@rh/shared";
import { createApp, type AppDeps } from "./app.ts";
import { loadConfig } from "../config.ts";
import { createEventBus } from "../events.ts";
import type {
  AgentControl,
  Broker,
  Clock,
  EventBus,
  Logger,
  MarketCalendar,
  OrderGate,
  Store,
} from "../ports.ts";

const NOW = new Date("2026-10-26T14:00:00Z").getTime();
const clock: Clock = { now: () => NOW };

const log: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => log,
};

function fakeStore(): Store & { settings: ReturnType<Store["getSettings"]> } {
  const state = {
    settings: structuredClone(DEFAULT_SETTINGS),
    journals: [] as ReturnType<Store["listJournal"]>,
    orders: [] as OrderRecord[],
  };
  return {
    settings: state.settings,
    getSettings: () => structuredClone(state.settings),
    patchSettings: (patch) => {
      state.settings = {
        ...state.settings,
        ...patch,
        risk: { ...state.settings.risk, ...(patch.risk ?? {}) },
      };
      return structuredClone(state.settings);
    },
    addJournal: (entry) => {
      const full = { ...entry, id: "j1" };
      state.journals.push(full);
      return full;
    },
    listJournal: () => [...state.journals],
    addOrder: (order) => {
      const full = { ...order, id: "o1" };
      state.orders.push(full);
      return full;
    },
    updateOrder: (id, patch) => {
      const order = state.orders.find((o) => o.id === id);
      if (!order) throw new Error(`Order not found: ${id}`);
      return Object.assign(order, patch);
    },
    getOrder: (id) => state.orders.find((o) => o.id === id),
    listOrders: () => [...state.orders],
    ordersSince: (since) => state.orders.filter((o) => o.createdAt >= since),
    markEquity: () => {},
    equityMarks: () => ({}),
  };
}

const orderRecord: OrderRecord = {
  id: "order-1",
  createdAt: NOW,
  updatedAt: NOW,
  intent: {
    symbol: "SPY",
    side: "buy",
    quantity: 1,
    orderType: "limit",
    limitPrice: 500,
    timeInForce: "day",
    invalidationPrice: 490,
    timeStopDate: "2026-11-30",
    thesis: "Uptrend intact with room to the recent high.",
    probabilityWin: 0.55,
    expectedGainPct: 3,
    expectedLossPct: 2,
    estimatedCostPct: 0.05,
    evidence: ["price above 50-day average"],
  },
  verdict: { approved: true, isExit: false, checks: [] },
  status: "pending_approval",
};

function deps(overrides: Partial<AppDeps> = {}): AppDeps & {
  sent: string[];
  ran: string[];
  approved: string[];
  rejected: { id: string; reason?: string }[];
  callbackParams: URLSearchParams | undefined;
  seen: { params: URLSearchParams | undefined };
  bus: EventBus;
} {
  const sent: string[] = [];
  const ran: string[] = [];
  const approved: string[] = [];
  const rejected: { id: string; reason?: string }[] = [];
  const seen: { params: URLSearchParams | undefined } = { params: undefined };
  const bus = createEventBus();
  const agent: AgentControl = {
    status: () => ({ state: "idle", model: "test-model" }),
    sendMessage: async (text) => {
      sent.push(text);
    },
    runCycle: async (kind) => {
      ran.push(kind);
    },
    listMessages: async () => [],
  };
  const broker: Broker = {
    status: () => ({ state: "connected", tools: ["quote"] }),
    beginConnect: async () => "https://example.com/auth",
    completeConnect: async (params) => {
      seen.params = params;
    },
    disconnect: async () => {},
    snapshot: async () => {
      throw new Error("not connected");
    },
    quote: async () => {
      throw new Error("not connected");
    },
    reviewOrder: async () => "",
    placeOrder: async () => ({ brokerOrderId: "b1", raw: "" }),
    onChange: () => () => {},
  };
  const gate: OrderGate = {
    submit: async () => orderRecord,
    approve: async (id) => {
      approved.push(id);
      return orderRecord;
    },
    reject: async (id, reason) => {
      rejected.push({ id, reason });
      return { ...orderRecord, status: "rejected_user" };
    },
    halts: async () => [],
  };
  const calendar: MarketCalendar = {
    clock: (now) => ({
      now,
      session: "regular",
      isOpen: true,
      tradingDay: "2026-10-26",
      nextOpen: now,
      nextClose: now,
      earlyClose: false,
    }),
    etDate: () => "2026-10-26",
    tradingDaysBetween: () => 0,
  };
  const config = loadConfig({ PUBLIC_URL: "http://127.0.0.1:4520", WEB_DIR: "/nonexistent-web-dir" });
  return {
    sent,
    ran,
    approved,
    rejected,
    seen,
    callbackParams: undefined,
    bus,
    config,
    store: fakeStore(),
    agent,
    broker,
    gate,
    calendar,
    clock,
    scheduler: { next: () => ({ at: NOW + 1000, kind: "overnight" as const }) },
    getAccount: () => null,
    log,
    ...overrides,
  };
}

const CSRF = { "x-harness": "1" };

describe("app CSRF and origin rules", () => {
  let d: ReturnType<typeof deps>;
  beforeEach(() => {
    d = deps();
  });

  it("rejects mutating requests without the header", async () => {
    const app = createApp(d);
    for (const init of [
      { method: "POST", url: "/api/cycles" },
      { method: "POST", url: "/api/messages" },
      { method: "PATCH", url: "/api/settings" },
    ]) {
      const res = await app.request(init.url, { method: init.method });
      assert.equal(res.status, 403, init.url);
    }
  });

  it("runs a manual cycle with the header", async () => {
    const app = createApp(d);
    const res = await app.request("/api/cycles", { method: "POST", headers: CSRF });
    assert.equal(res.status, 200);
    assert.deepEqual(d.ran, ["manual"]);
  });

  it("rejects a forged Origin even with the header", async () => {
    const app = createApp(d);
    const res = await app.request("/api/cycles", {
      method: "POST",
      headers: { ...CSRF, Origin: "http://evil.example:4520" },
    });
    assert.equal(res.status, 403);
  });

  it("accepts the configured PUBLIC_URL origin and host origins", async () => {
    const app = createApp(d);
    for (const origin of ["http://127.0.0.1:4520", "http://127.0.0.1:4520"]) {
      const res = await app.request("/api/cycles", { method: "POST", headers: { ...CSRF, Origin: origin } });
      assert.equal(res.status, 200, origin);
    }
  });

  it("accepts an origin listed in HARNESS_ORIGINS", async () => {
    const config = loadConfig({ WEB_DIR: "/nonexistent-web-dir", HARNESS_ORIGINS: "https://laptop.example.ts.net:8443" });
    const app = createApp({ ...d, config });
    const allowed = await app.request("/api/cycles", { method: "POST", headers: { ...CSRF, Origin: "https://laptop.example.ts.net:8443" } });
    assert.equal(allowed.status, 200);
    const other = await app.request("/api/cycles", { method: "POST", headers: { ...CSRF, Origin: "https://evil.example.ts.net:8443" } });
    assert.equal(other.status, 403);
  });

  it("leaves GET routes open without the header", async () => {
    const app = createApp(d);
    assert.equal((await app.request("/api/status")).status, 200);
    assert.equal((await app.request("/api/settings")).status, 200);
  });
});

describe("app routes", () => {
  let d: ReturnType<typeof deps>;
  beforeEach(() => {
    d = deps();
  });

  it("returns 400 on an invalid message body", async () => {
    const app = createApp(d);
    const res = await app.request("/api/messages", {
      method: "POST",
      headers: { ...CSRF, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /.+/);
  });

  it("sends a chat message", async () => {
    const app = createApp(d);
    const res = await app.request("/api/messages", {
      method: "POST",
      headers: { ...CSRF, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(d.sent, ["hello"]);
  });

  it("PATCHes settings with a partial risk object", async () => {
    const app = createApp(d);
    const res = await app.request("/api/settings", {
      method: "PATCH",
      headers: { ...CSRF, "Content-Type": "application/json" },
      body: JSON.stringify({ risk: { maxRiskPerTradePct: 2 }, mode: "off" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as ReturnType<Store["getSettings"]>;
    assert.equal(body.risk.maxRiskPerTradePct, 2);
    assert.equal(body.risk.maxPositionPct, DEFAULT_SETTINGS.risk.maxPositionPct);
    assert.equal(body.mode, "off");
  });

  it("returns 400 on an invalid settings patch", async () => {
    const app = createApp(d);
    const res = await app.request("/api/settings", {
      method: "PATCH",
      headers: { ...CSRF, "Content-Type": "application/json" },
      body: JSON.stringify({ risk: { maxRiskPerTradePct: -5 } }),
    });
    assert.equal(res.status, 400);
  });

  it("serves a status snapshot with halts and next cycle", async () => {
    const app = createApp(d);
    const res = await app.request("/api/status");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { agent: { state: string }; halts: unknown[]; settings: { mode: string } };
    assert.equal(body.agent.state, "idle");
    assert.deepEqual(body.halts, []);
    assert.equal(body.settings.mode, DEFAULT_SETTINGS.mode);
  });

  it("approves and rejects orders through the gate", async () => {
    const app = createApp(d);
    assert.equal((await app.request("/api/orders/order-1/approve", { method: "POST", headers: CSRF })).status, 200);
    assert.deepEqual(d.approved, ["order-1"]);
    const reject = await app.request("/api/orders/order-1/reject", {
      method: "POST",
      headers: { ...CSRF, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "too big" }),
    });
    assert.equal(reject.status, 200);
    assert.deepEqual(d.rejected, [{ id: "order-1", reason: "too big" }]);
  });

  it("redirects the OAuth callback without echoing errors", async () => {
    const app = createApp(d);
    const ok = await app.request("/api/robinhood/callback?code=abc&state=xyz", { redirect: "manual" });
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get("location"), "/?robinhood=connected");
    assert.equal(d.seen.params?.get("code"), "abc");

    const badBrokerD = deps();
    badBrokerD.broker.completeConnect = async () => {
      throw new Error("secret-provider-stuff token=abc123");
    };
    const badApp = createApp(badBrokerD);
    const err = await badApp.request("/api/robinhood/callback?error=access_denied", { redirect: "manual" });
    assert.equal(err.status, 302);
    assert.equal(err.headers.get("location"), "/?robinhood=error");
    assert.ok(!(await err.text()).includes("abc123"));
  });

  it("returns a plain-text page when the web build is missing", async () => {
    const app = createApp(d);
    const res = await app.request("/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
    assert.match(await res.text(), /not built/i);
  });

  it("streams an initial status event over SSE", async () => {
    const app = createApp(d);
    const res = await app.request("/api/events");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const reader = res.body?.getReader();
    assert.ok(reader);
    const decoder = new TextDecoder();
    let text = "";
    const deadline = Date.now() + 2000;
    while (!text.includes("\n\n") && Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    assert.match(text, /^data: /);
    const first = JSON.parse(text.split("\n")[0]?.slice("data: ".length) ?? "{}") as { type: string };
    assert.equal(first.type, "status");
  });
});
