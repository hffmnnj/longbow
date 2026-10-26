import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "@rh/shared";
import { buildScenarioMarket, createStaticSectorDirectory, WARMUP_SESSIONS } from "./scenario-market.ts";

/** Deterministic source history: every symbol trades every weekday in range. */
function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); ; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (date > to) break;
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) out.push(date);
  }
  return out;
}

function seedOf(symbol: string): number {
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function genBars(symbol: string, from: string, to: string): Bar[] {
  const seed = seedOf(symbol);
  const base = 40 + (seed % 200);
  const t0 = Date.parse("2016-10-24T12:00:00Z");
  const dates = weekdaysBetween(from, to);
  return dates.map((date) => {
    // Pure function of the date so any fetch window yields identical bars.
    const n = Math.round((Date.parse(`${date}T12:00:00Z`) - t0) / 86_400_000);
    const close = base + n * 0.05 + Math.sin(n / 7 + seed) * 2;
    const open = close * (1 + 0.001 * Math.sin(n / 5 + seed));
    return {
      date,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: 1_000_000 + (seed % 500_000) + n * 100,
    };
  });
}

const fetch = async (symbol: string, from: string, to: string): Promise<Bar[]> => genBars(symbol, from, to);

function isWeekday(date: string): boolean {
  const day = new Date(Date.parse(`${date}T12:00:00Z`)).getUTCDay();
  return day !== 0 && day !== 6;
}

function returns(bars: Bar[]): number[] {
  return bars.slice(1).map((b, i) => b.close / bars[i]!.close - 1);
}

describe("scenario market", () => {
  const dates = weekdaysBetween("2019-01-02", "2021-06-30");
  const startDate = dates[310]!;
  const spec = {
    mode: "blind" as const,
    seed: 7,
    watchlist: ["AAA", "BBB"],
    days: 20,
    startDate,
    today: "2026-10-24",
    fetch,
  };

  it("reproduces_the_same_market_for_the_same_seed_and_differs_across_seeds", async () => {
    const first = await buildScenarioMarket(spec);
    const second = await buildScenarioMarket(spec);
    assert.deepEqual(first.aliases, second.aliases);
    assert.deepEqual(first.simDates, second.simDates);
    for (const symbol of first.symbols) {
      assert.deepEqual(await first.bars(symbol), await second.bars(symbol));
    }
    const other = await buildScenarioMarket({ ...spec, seed: 8 });
    const mktA = await first.bars("MKT");
    const mktB = await other.bars("MKT");
    assert.ok(mktA.some((b, i) => b.close !== mktB[i]?.close), "different seeds should rescale differently");
  });

  it("reproduces_the_same_bootstrap_market_for_the_same_seed", async () => {
    const base = { ...spec, mode: "bootstrap" as const, seed: 7 };
    const first = await buildScenarioMarket(base);
    const second = await buildScenarioMarket(base);
    assert.deepEqual(first.aliases, second.aliases);
    assert.deepEqual(first.simDates, second.simDates);
    assert.deepEqual(first.sourceDates, second.sourceDates);
    for (const symbol of first.symbols) {
      assert.deepEqual(await first.bars(symbol), await second.bars(symbol));
    }
  });

  it("aliases_everything_exactly_once_with_no_real_ticker_leaking", async () => {
    const market = await buildScenarioMarket(spec);
    const real = ["SPY", "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLB", "XLU", "XLRE", "XLC", "AAA", "BBB"];
    const aliases = Object.keys(market.aliases);
    assert.equal(new Set(aliases).size, aliases.length, "aliases collide");
    for (const alias of aliases) assert.ok(!real.includes(alias), `alias leaks a real ticker: ${alias}`);
    assert.equal(market.aliases["MKT"], "SPY");
    assert.equal(market.aliases["STECH"], "XLK");
    assert.equal(market.benchmark, "MKT");
    assert.equal(market.symbols[0], "MKT");
    assert.ok(market.universeText.includes("MKT (Broad Market)"));
  });

  it("runs_on_a_fictional_weekday_calendar", async () => {
    const market = await buildScenarioMarket(spec);
    assert.equal(market.simDates.length, spec.days);
    for (const date of market.simDates) assert.ok(isWeekday(date), `${date} is not a weekday`);
    assert.ok(market.calendar.firstDay === market.simDates[0]);
    assert.ok(market.calendar.firstDay! >= "2031-01-06" && market.calendar.firstDay! <= "2032-06-30");
    assert.equal(market.calendar.sourceStart, startDate);
    assert.equal(market.calendar.sourceEnd, dates[310 + spec.days - 1]);
  });

  it("keeps_blind_returns_with_rescaled_prices_and_preserved_dollar_volume", async () => {
    const market = await buildScenarioMarket(spec);
    assert.equal(market.sourceDates.length, WARMUP_SESSIONS + spec.days);
    for (const [alias, real] of Object.entries(market.aliases)) {
      const source = genBars(real, "2019-01-02", "2021-06-30").filter((b) => market.sourceDates.includes(b.date));
      const fictional = await market.bars(alias);
      assert.equal(fictional.length, source.length);
      const sourceRet = returns(source);
      const fictionalRet = returns(fictional);
      assert.equal(sourceRet.length, fictionalRet.length);
      for (let i = 0; i < sourceRet.length; i++) {
        assert.ok(Math.abs(sourceRet[i]! - fictionalRet[i]!) < 1e-9, `return drift for ${alias} at ${i}`);
      }
      for (let i = 0; i < source.length; i++) {
        const a = source[i]!.close * source[i]!.volume;
        const b = fictional[i]!.close * fictional[i]!.volume;
        assert.ok(Math.abs(a - b) / a < 1e-5, `dollar volume changed for ${alias} at ${i}`);
      }
    }
  });

  it("draws_bootstrap_days_from_one_source_date_per_day_for_every_symbol", async () => {
    const market = await buildScenarioMarket({ ...spec, mode: "bootstrap", seed: 7 });
    assert.equal(market.simDates.length, spec.days);
    assert.equal(market.sourceDates.length, WARMUP_SESSIONS + spec.days);
    assert.equal(market.calendar.sourceStart, undefined);
    const common = weekdaysBetween("2016-10-24", "2026-10-24");
    for (const [alias, real] of Object.entries(market.aliases)) {
      const fictional = await market.bars(alias);
      const sourceByDate = new Map(genBars(real, "2016-10-24", "2026-10-24").map((b) => [b.date, b]));
      for (let i = 1; i < fictional.length; i++) {
        const date = market.sourceDates[i]!;
        const bar = sourceByDate.get(date)!;
        const prevIdx = common.indexOf(date) - 1;
        const prevClose = sourceByDate.get(common[(prevIdx + common.length) % common.length]!)!.close;
        const expected = bar.close / prevClose - 1;
        const actual = fictional[i]!.close / fictional[i - 1]!.close - 1;
        assert.ok(Math.abs(expected - actual) < 1e-9, `joint draw broken for ${alias} at ${i}`);
      }
    }
  });

  it("drops_symbols_without_covering_history", async () => {
    const thin = async (symbol: string, from: string, to: string): Promise<Bar[]> =>
      symbol === "AAA" ? [] : fetch(symbol, from, to);
    const market = await buildScenarioMarket({ ...spec, fetch: thin });
    assert.ok(market.dropped.includes("AAA"));
    assert.ok(!Object.values(market.aliases).includes("AAA"));
  });

  it("fails_clearly_when_the_joint_history_is_too_short", async () => {
    const tiny = async (): Promise<Bar[]> => genBars("SPY", "2021-06-01", "2021-06-30").slice(0, 10);
    await assert.rejects(buildScenarioMarket({ ...spec, mode: "bootstrap", fetch: tiny }), /joint history/);
  });

  it("serves_point_in_time_history_without_earnings", async () => {
    const market = await buildScenarioMarket(spec);
    const cutoff = market.simDates[3]!;
    const view = market.market(() => cutoff);
    const history = await view.history("MKT", "5y");
    assert.ok(history.bars.length > 0);
    assert.ok(history.bars.every((b) => b.date <= cutoff), "a bar on or after the cutoff leaked");
    assert.equal(await view.nextEarnings("MKT"), undefined);
    assert.ok((await view.avgDollarVolume("MKT", 20))! > 0);
  });

  it("builds_a_static_sector_directory", () => {
    const dir = createStaticSectorDirectory({ MKT: "Broad Market", ZABC: undefined });
    assert.equal(dir.get("mkt"), "Broad Market");
    assert.equal(dir.get("ZABC"), undefined);
  });
});
