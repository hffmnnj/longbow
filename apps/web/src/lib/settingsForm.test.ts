import { describe, expect, it } from "vitest";
import { DEFAULT_CRYPTO, DEFAULT_SETTINGS } from "@rh/shared";
import { buildPatch, parseTickers, toForm, validate } from "./settingsForm.ts";

describe("settings form", () => {
  it("sends nothing when untouched", () => {
    expect(buildPatch(DEFAULT_SETTINGS, toForm(DEFAULT_SETTINGS))).toEqual({});
  });

  it("sends only changed fields, with risk merged per field", () => {
    const f = toForm(DEFAULT_SETTINGS);
    f.risk.maxPositions = "8";
    f.cycleMinutesOpen = "15";
    f.watchlist.push("NVDA");
    expect(buildPatch(DEFAULT_SETTINGS, f)).toEqual({
      cycleMinutesOpen: 15,
      watchlist: [...DEFAULT_SETTINGS.watchlist, "NVDA"],
      risk: { maxPositions: 8 },
    });
  });

  it("reports out-of-range, non-integer and empty values inline", () => {
    const f = toForm(DEFAULT_SETTINGS);
    f.risk.maxRiskPerTradePct = "9";
    f.risk.maxPositions = "2.5";
    f.risk.maxSpreadBps = "";
    f.cycleMinutesOpen = "1";
    const e = validate(f);
    expect(e["risk.maxRiskPerTradePct"]).toBe("Max 5");
    expect(e["risk.maxPositions"]).toBe("Whole number");
    expect(e["risk.maxSpreadBps"]).toBe("Required");
    expect(e.cycleMinutesOpen).toBe("Min 5");
    expect(validate(toForm(DEFAULT_SETTINGS))).toEqual({});
  });

  it("parses typed tickers: uppercases, dedupes, rejects junk", () => {
    expect(parseTickers("nvda, spy aapl, 12x, brk.b", ["SPY"])).toEqual({
      added: ["NVDA", "AAPL", "BRK.B"],
      rejected: ["12x"],
    });
  });

  it("round-trips the crypto sleeve and sends nothing when untouched", () => {
    const f = toForm(DEFAULT_SETTINGS);
    expect(f.crypto).toEqual({
      enabled: DEFAULT_CRYPTO.enabled,
      maxPortfolioPct: String(DEFAULT_CRYPTO.maxPortfolioPct),
      maxOrderNotionalUsd: String(DEFAULT_CRYPTO.maxOrderNotionalUsd),
    });
    expect(buildPatch(DEFAULT_SETTINGS, f)).toEqual({});
  });

  it("sends only changed crypto fields", () => {
    const f = toForm(DEFAULT_SETTINGS);
    f.crypto.enabled = !DEFAULT_CRYPTO.enabled;
    f.crypto.maxPortfolioPct = "10";
    expect(buildPatch(DEFAULT_SETTINGS, f)).toEqual({
      crypto: { enabled: !DEFAULT_CRYPTO.enabled, maxPortfolioPct: 10 },
    });
  });

  it("reports out-of-range and empty crypto values inline", () => {
    const f = toForm(DEFAULT_SETTINGS);
    f.crypto.maxPortfolioPct = "30";
    f.crypto.maxOrderNotionalUsd = "";
    const e = validate(f);
    expect(e["crypto.maxPortfolioPct"]).toBe("Max 25");
    expect(e["crypto.maxOrderNotionalUsd"]).toBe("Required");
    expect(validate(toForm(DEFAULT_SETTINGS))).toEqual({});
  });
});
