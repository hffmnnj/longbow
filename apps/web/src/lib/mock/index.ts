import type { ChatMessage, HaltReason, ServerEvent, Settings, SettingsPatch, StatusResponse } from "@rh/shared";
import type { Api, EventHandlers } from "../api.ts";
import {
  STREAM_REPLY,
  fixtureJournal,
  fixtureMessages,
  fixtureOrders,
  fixtureStatus,
  type Scenario,
} from "./fixtures.ts";

function scenarioFromUrl(): Scenario {
  const s = new URLSearchParams(location.search).get("scenario");
  return s === "disconnected" || s === "halted" || s === "empty" || s === "running" ? s : "default";
}

/** In-memory stand-in for the harness server, used only by `bun run dev:mock`. */
export function createMockApi(): Api {
  const scenario = scenarioFromUrl();
  let status: StatusResponse = fixtureStatus(scenario);
  let messages = scenario === "empty" ? [] : fixtureMessages();
  const journal = scenario === "empty" ? [] : fixtureJournal();
  let orders = scenario === "empty" ? [] : fixtureOrders();
  const listeners = new Set<EventHandlers>();
  let seq = 100;

  const emit = (event: ServerEvent) => listeners.forEach((l) => l.onEvent(event));
  const delay = <T>(v: T, ms = 120) => new Promise<T>((r) => setTimeout(() => r(v), ms));
  const setStatus = (next: StatusResponse) => {
    status = next;
    emit({ type: "status", status });
  };
  const addMessage = (m: Omit<ChatMessage, "id" | "at">) => {
    const message: ChatMessage = { id: `m-${seq++}`, at: Date.now(), ...m };
    messages = [...messages, message];
    emit({ type: "message", message });
  };

  function streamReply(prefix?: string) {
    setStatus({ ...status, agent: { ...status.agent, state: "running" } });
    const words = (prefix ? prefix + " " : "").concat(STREAM_REPLY).split(/(?<=\s)/);
    let i = 0;
    const tick = setInterval(() => {
      if (i < words.length) {
        emit({ type: "delta", text: words[i++] ?? "" });
        return;
      }
      clearInterval(tick);
      addMessage({ role: "assistant", text: words.join("") });
      setStatus({
        ...status,
        agent: { ...status.agent, state: "idle", lastCycleAt: Date.now(), nextCycleAt: Date.now() + 30 * 60_000 },
      });
    }, 70);
  }

  return {
    status: () => delay(status),
    messages: () => delay(messages),
    journal: () => delay(journal),
    orders: () => delay(orders),
    settings: () => delay(status.settings),
    sendMessage: async (text) => {
      addMessage({ role: "user", text });
      setTimeout(() => streamReply(), 400);
    },
    runCycle: async () => {
      addMessage({ role: "cycle", text: "Manual cycle\nRequested from the UI." });
      setTimeout(() => streamReply(), 400);
    },
    approve: async (id) => {
      const o = orders.find((x) => x.id === id);
      if (!o) return;
      const next = { ...o, status: "submitted" as const, updatedAt: Date.now(), brokerOrderId: "rh-mock" };
      orders = orders.map((x) => (x.id === id ? next : x));
      emit({ type: "order", order: next });
      return next;
    },
    reject: async (id) => {
      const o = orders.find((x) => x.id === id);
      if (!o) return;
      const next = { ...o, status: "rejected_user" as const, updatedAt: Date.now() };
      orders = orders.map((x) => (x.id === id ? next : x));
      emit({ type: "order", order: next });
      return next;
    },
    patchSettings: async (patch: SettingsPatch) => {
      if (patch.risk?.maxPositionPct !== undefined && patch.risk.maxPositionPct > 50) {
        const { ApiError } = await import("../api.ts");
        throw new ApiError(400, "Invalid settings", [
          { path: "risk.maxPositionPct", message: "Mock server: keep this at 50 or lower" },
        ]);
      }
      const settings: Settings = { ...status.settings, ...patch, risk: { ...status.settings.risk, ...patch.risk } };
      const halts: HaltReason[] = status.halts.filter((h) => h !== "kill_switch" && h !== "drawdown" && h !== "mode_off");
      if (settings.killSwitch) halts.push("kill_switch");
      if (settings.drawdownHalted) halts.push("drawdown");
      if (settings.mode === "off") halts.push("mode_off");
      setStatus({ ...status, settings, halts });
      return settings;
    },
    connectUrl: async () => ({ url: `${location.pathname}?robinhood=connected` }),
    disconnect: async () => {
      setStatus({
        ...status,
        broker: { state: "disconnected", tools: [] },
        account: null,
        halts: [...status.halts.filter((h) => h !== "broker_disconnected"), "broker_disconnected"],
      });
    },
    subscribe(h) {
      listeners.add(h);
      queueMicrotask(h.onOpen);
      if (scenario === "running") {
        setTimeout(() => emit({ type: "delta", text: STREAM_REPLY.slice(0, 150) }), 100);
      }
      if (scenario === "default") {
        setTimeout(() => streamReply("Re-checking MSFT liquidity before the next window."), 2500);
      }
      return () => listeners.delete(h);
    },
  };
}
