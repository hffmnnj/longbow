import { createHash } from "node:crypto";
import type { SimRunConfig } from "@rh/shared";
import type { ScenarioMarket } from "./scenario-market.ts";

const VERSION = "scenario-v1";

export function isMarketFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^scenario-v1:[0-9a-f]{64}$/.test(value);
}

/** Compare what both the trader and the paper broker actually see, not just the seed or source dates. */
export async function marketFingerprint(
  scenario: ScenarioMarket,
  seed: number,
  config: Pick<SimRunConfig, "mode" | "execution" | "startingCash" | "cyclesPerDay">,
): Promise<string | undefined> {
  const hash = createHash("sha256");
  const write = (value: unknown) => { hash.update(JSON.stringify(value)).update("\n"); };
  write([VERSION, seed, config.mode, config.execution, config.startingCash, config.cyclesPerDay]);
  write([scenario.benchmark, scenario.allDates, scenario.simDates, scenario.sourceDates, scenario.dropped]);
  for (const symbol of scenario.symbols) {
    const bars = await scenario.bars(symbol);
    if (bars.length !== scenario.allDates.length || bars.some((bar, i) => bar.date !== scenario.allDates[i] ||
      ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite))) return undefined;
    write([symbol, scenario.aliases[symbol], scenario.sectorOf(symbol), bars.map((bar) =>
      [bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume])]);
  }
  return `${VERSION}:${hash.digest("hex")}`;
}
