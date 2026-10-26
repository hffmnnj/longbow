import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type StatusResponse, type TradingMode } from "@rh/shared";
import { controlState, parseModelSpec } from "./control.ts";

const status = (over: { mode?: TradingMode; killSwitch?: boolean; liveTrading?: boolean; broker?: "connected" | "disconnected" }) =>
  ({
    settings: { ...DEFAULT_SETTINGS, mode: over.mode ?? "approve", killSwitch: over.killSwitch ?? false },
    liveTrading: over.liveTrading ?? true,
    halts: [],
    broker: { state: over.broker ?? "connected", tools: [] },
  }) satisfies Pick<StatusResponse, "settings" | "liveTrading" | "halts" | "broker">;

const cap = (s: ReturnType<typeof controlState>, key: string) => s.capabilities.find((c) => c.key === key)!;

describe("controlState", () => {
  it("shows 'Live trading locked' and refuses to place orders while the server lock is on, even in Auto", () => {
    const s = controlState(status({ mode: "auto", liveTrading: false }));
    expect(s.authority).toBe("locked");
    expect(s.headline).toBe("Live trading locked");
    expect(cap(s, "place").state).toBe("no");
    expect(cap(s, "propose").state).toBe("yes");
  });

  it("lets the kill switch outrank the lock and blocks proposals as well as placement", () => {
    const s = controlState(status({ mode: "auto", liveTrading: false, killSwitch: true }));
    expect(s.authority).toBe("killed");
    expect(s.liveLocked).toBe(true);
    expect(cap(s, "propose").state).toBe("no");
  });

  it("in Approve with the lock open, placement is gated on the human", () => {
    const s = controlState(status({ mode: "approve" }));
    expect(s.authority).toBe("approve");
    expect(cap(s, "approve").state).toBe("yes");
    expect(cap(s, "place")).toMatchObject({ state: "gated", detail: "Only after you approve" });
  });

  it("in Auto with the lock open and the broker up, placement is on", () => {
    const s = controlState(status({ mode: "auto" }));
    expect(s.authority).toBe("auto");
    expect(cap(s, "place").state).toBe("yes");
  });

  it("blocks placement when the broker is disconnected and says why", () => {
    const place = cap(controlState(status({ mode: "auto", broker: "disconnected" })), "place");
    expect(place).toMatchObject({ state: "no", detail: "Robinhood is not connected" });
  });

  it("in Off the agent is research only", () => {
    const s = controlState(status({ mode: "off" }));
    expect(s.authority).toBe("off");
    expect(cap(s, "propose").state).toBe("no");
  });
});

describe("parseModelSpec", () => {
  it("splits provider, model and thinking level", () => {
    expect(parseModelSpec("openai/gpt-5.5#high")).toEqual({ provider: "openai", model: "gpt-5.5", thinking: "high" });
  });

  it("keeps slashes inside the model name and tolerates a missing provider", () => {
    expect(parseModelSpec("openrouter/meta/llama-4")).toEqual({ provider: "openrouter", model: "meta/llama-4", thinking: undefined });
    expect(parseModelSpec("muse-spark")).toEqual({ provider: "", model: "muse-spark", thinking: undefined });
  });
});
