import { describe, expect, it } from "vitest";
import { systemOneCooldownUntil, systemOneLabel, systemOneStatsLine, systemOneTone } from "./systemOne.ts";

describe("system one chip", () => {
  it("labels every connection state in plain words", () => {
    expect(systemOneLabel("ok")).toBe("OK");
    expect(systemOneLabel("degraded")).toBe("Degraded");
    expect(systemOneLabel("rate_limited")).toBe("Rate limited");
    expect(systemOneLabel("payment")).toBe("Payment required");
    expect(systemOneLabel("unconfigured")).toBe("Not configured");
  });

  it("stays green unless the connection needs attention", () => {
    expect(systemOneTone("ok")).toBe("ok");
    expect(systemOneTone("degraded")).toBe("warn");
    expect(systemOneTone("rate_limited")).toBe("warn");
    expect(systemOneTone("payment")).toBe("bad");
    expect(systemOneTone("unconfigured")).toBe("muted");
  });

  it("prints the daily usage line from the status sample", () => {
    expect(systemOneStatsLine({ calls24h: 42, medianLatencyMs: 150 })).toBe("42 calls today, 150 ms median");
  });

  it("omits the median when the server reports none and keeps singular agreement", () => {
    expect(systemOneStatsLine({ calls24h: 0, medianLatencyMs: undefined })).toBe("0 calls today");
    expect(systemOneStatsLine({ calls24h: 1, medianLatencyMs: 40 })).toBe("1 call today, 40 ms median");
  });

  it("shows the cooldown only for rate limits and payment holds", () => {
    const at = Date.now() + 60_000;
    expect(systemOneCooldownUntil({ state: "rate_limited", cooldownUntil: at })).toBe(at);
    expect(systemOneCooldownUntil({ state: "payment", cooldownUntil: at })).toBe(at);
    expect(systemOneCooldownUntil({ state: "ok", cooldownUntil: at })).toBeUndefined();
    expect(systemOneCooldownUntil({ state: "degraded", cooldownUntil: undefined })).toBeUndefined();
  });
});
