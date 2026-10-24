import type { ChatMessage, HaltReason, ServerEvent, Settings, SettingsPatch, StatusResponse, SubagentRun } from "@rh/shared";
import type { Api, EventHandlers } from "../api.ts";
import {
  STREAM_REPLY,
  fixtureJournal,
  fixtureMessages,
  fixtureOrders,
  fixtureStatus,
  fixtureSubagents,
  type Scenario,
} from "./fixtures.ts";
import { mockHistory, mockNote, mockNotes, mockSkill, mockSkills } from "./data.ts";
import { runWork } from "./work.ts";

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
  const runs = new Map<string, SubagentRun>(
    (scenario === "default" || scenario === "running" ? fixtureSubagents() : []).map((r) => [r.id, r]),
  );
  const transcripts = new Map<string, ChatMessage[]>();
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
    return message;
  };
  const setRunning = (running: boolean) =>
    setStatus({ ...status, agent: { ...status.agent, state: running ? "running" : "idle" } });
  const work = (opts?: { pace?: number; hold?: boolean }) =>
    runWork({ emit, addMessage, setRunning, reply: () => streamReply(), runs, transcripts }, opts);

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
      setTimeout(() => void work(), 200);
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
        throw new ApiError(400, "maxPositionPct must be 50 or lower on the mock server");
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
    subagents: () => delay([...runs.values()].sort((a, b) => b.startedAt - a.startedAt)),
    conversationMessages: (id) =>
      delay(
        transcripts.get(id) ??
          (runs.has(id)
            ? [
                { id: `${id}-t`, at: Date.now() - 9000, role: "tool" as const, toolName: "market_indicators", text: "MSFT rsi14 61.2, close above sma20 and sma50" },
                { id: `${id}-a`, at: Date.now() - 1000, role: "assistant" as const, text: runs.get(id)?.answer ?? "" },
              ]
            : []),
      ),
    skills: () => delay(mockSkills()),
    skill: async (name) => {
      const s = mockSkill(name);
      if (!s) throw new (await import("../api.ts")).ApiError(404, "skill not found");
      return delay(s);
    },
    notes: () => delay(scenario === "empty" ? [] : mockNotes()),
    note: async (path) => {
      const n = mockNote(path);
      if (!n) throw new (await import("../api.ts")).ApiError(404, "note not found");
      return delay(n, 200);
    },
    history: (symbol, range) =>
      delay({ symbol, bars: mockHistory(symbol, range), source: "mock", asOf: Date.now() }, 250),
    subscribe(h) {
      listeners.add(h);
      queueMicrotask(h.onOpen);
      if (scenario === "running") setTimeout(() => void work({ pace: 0.25, hold: true }), 300);
      if (scenario === "default") setTimeout(() => void work(), 2500);
      return () => listeners.delete(h);
    },
  };
}
