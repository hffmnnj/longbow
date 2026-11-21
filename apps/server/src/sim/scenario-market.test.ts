import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "@rh/shared";
import { BOOTSTRAP_HISTORY_START, buildScenarioMarket, createStaticSectorDirectory, WARMUP_SESSIONS } from "./scenario-market.ts";

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

/** Source close-to-close return per date; the first bar has no known return. */
function sourceSessionReturns(bars: Bar[]): Map<string, number> {
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const out = new Map<string, number>();
  for (let i = 1; i < sorted.length; i++) {
    const bar = sorted[i]!;
    out.set(bar.date, bar.close / sorted[i - 1]!.close - 1);
  }
  return out;
}

/** Split-end fixture: ETFs/SPY span 2017-2020 while AAA trades only inside the joint window. */
function splitEndBars(symbol: string, from: string, to: string): Bar[] {
  const [start, end] = symbol === "AAA" ? ["2018-01-02", "2019-06-28"] : ["2017-01-02", "2020-12-31"];
  const all = weekdaysBetween(start, end).map((date, i) => {
    const close = 50 * 1.0011 ** i;
    const open = close * 0.999;
    return { date, open, high: close * 1.002, low: open * 0.998, close, volume: 1_000_000 };
  });
  return all.filter((b) => b.date >= from && b.date <= to);
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
    for (const [alias, real] of Object.entries(market.aliases)) {
      const fictional = await market.bars(alias);
      const expected = sourceSessionReturns(genBars(real, "2016-10-24", "2026-10-24"));
      for (let i = 1; i < fictional.length; i++) {
        const source = expected.get(market.sourceDates[i]!);
        assert.ok(source !== undefined, `no source session for ${alias} at ${i}`);
        const actual = fictional[i]!.close / fictional[i - 1]!.close - 1;
        assert.ok(Math.abs(source - actual) < 1e-9, `source session return broken for ${alias} at ${i}: ${actual} vs ${source}`);
      }
    }
  });

  it("preserves the sampled dollar liquidity after rebasing prices", async () => {
    const bootstrap = await buildScenarioMarket({ ...spec, mode: "bootstrap" });
    const visibleAt = bootstrap.simDates.at(-1)!;
    const market = bootstrap.market(() => visibleAt);
    let rescaled = 0;
    for (const alias of bootstrap.symbols) {
      const bars = await bootstrap.bars(alias);
      const original = new Map(genBars(bootstrap.aliases[alias]!, BOOTSTRAP_HISTORY_START, spec.today).map((bar) => [bar.date, bar]));
      let sourceDollars = 0;
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i]!;
        const raw = original.get(bootstrap.sourceDates[i]!)!;
        assert.ok(Number.isInteger(bar.volume) && bar.volume > 0);
        assert.ok(Math.abs(bar.close * bar.volume - raw.close * raw.volume) <= bar.close / 2 + 1e-5,
          `${alias} dollar volume must agree within half a rescaled share`);
        if (Math.abs(raw.close - bar.close) > raw.close * 0.05) rescaled++;
        if (i >= bars.length - 20) sourceDollars += raw.close * raw.volume;
      }
      const adv = await market.avgDollarVolume(alias, 20);
      assert.ok(adv !== undefined && Math.abs(adv - sourceDollars / 20) / (sourceDollars / 20) < 1e-5);
    }
    assert.ok(rescaled > 100, "the control exercises material price rebasing");
  });

  it("samples only shared close-to-close intervals around listings and interior tape gaps", async () => {
    const listing = "2018-01-02";
    const missing = "2018-05-11";
    const afterMissing = "2018-05-14";
    const split = async (symbol: string, from: string, to: string): Promise<Bar[]> =>
      splitEndBars(symbol, from, to).filter((bar) => symbol !== "AAA" || bar.date !== missing);
    const market = await buildScenarioMarket({ mode: "bootstrap", seed: 43, watchlist: ["AAA"], days: 3, today: "2026-10-24", fetch: split });
    const aaaAlias = Object.entries(market.aliases).find(([, real]) => real === "AAA")?.[0];
    assert.ok(aaaAlias !== undefined, "AAA should be kept and aliased");
    const benchmark = await split("SPY", BOOTSTRAP_HISTORY_START, "2026-10-24");
    const previous = new Map(benchmark.slice(1).map((bar, i) => [bar.date, benchmark[i]!.date]));
    assert.equal(previous.get(afterMissing), missing);
    for (const date of [listing, missing, afterMissing]) {
      assert.ok(!market.sourceDates.includes(date), `${date} has no shared interval and must not be sampled`);
    }
    // Ensure the sampled block wraps to touch the start of the joint window.
    assert.ok(market.sourceDates.includes("2018-01-03"));
    assert.ok(market.sourceDates.includes("2018-05-15"));
    for (const alias of ["MKT", aaaAlias]) {
      const real = market.aliases[alias]!;
      const bars = await market.bars(alias);
      const originals = await split(real, BOOTSTRAP_HISTORY_START, "2026-10-24");
      const closes = new Map(originals.map((bar) => [bar.date, bar.close]));
      for (let i = 1; i < bars.length; i++) {
        const date = market.sourceDates[i]!;
        const priorClose = closes.get(previous.get(date)!);
        const close = closes.get(date);
        assert.ok(priorClose !== undefined && close !== undefined, `no shared close interval for ${alias} at ${i}`);
        const actual = bars[i]!.close / bars[i - 1]!.close - 1;
        const expected = close / priorClose - 1;
        assert.ok(Math.abs(expected - actual) < 1e-9, `source session return broken for ${alias} at ${i}: ${actual} vs ${expected}`);
      }
    }
  });

  it("bootstrap_completed_bars_do_not_change_the_source_dates_or_tape", async () => {
    // Monday: a same-day source bar would still be forming while the run starts.
    const today = "2026-10-26";
    const future = "2026-10-27";
    const completedVolume = 987_654_321;
    const futureVolume = 987_654_322;
    const spikeVolume = (symbol: string, date: string, volume: number): Bar => {
      const base = genBars(symbol, date, date)[0]!;
      const open = base.close * 12;
      const close = base.close * 9;
      return { date, open, high: Math.max(open, close) * 1.1, low: Math.min(open, close) * 0.9, close, volume };
    };
    // Both feeds serve the same deterministic prefix. The second also returns a
    // completed bar dated today plus one beyond `to`, as a vendor might.
    const prefixOnly = async (symbol: string, from: string, to: string): Promise<Bar[]> =>
      genBars(symbol, from, to).filter((bar) => bar.date < today);
    const withCompleted = async (symbol: string, from: string, to: string): Promise<Bar[]> => [
      ...(await prefixOnly(symbol, from, to)),
      spikeVolume(symbol, today, completedVolume),
      spikeVolume(symbol, future, futureVolume),
    ];
    const base = { ...spec, mode: "bootstrap" as const, seed: 7, today };
    const clean = await buildScenarioMarket({ ...base, fetch: prefixOnly });
    const dirty = await buildScenarioMarket({ ...base, fetch: withCompleted });

    // Precondition: the extra bars are wildly different, so any leak would show.
    const feed = await withCompleted("SPY", BOOTSTRAP_HISTORY_START, today);
    const lastPrefix = feed.find((bar) => bar.date < today)!;
    const completed = feed.find((bar) => bar.date === today)!;
    assert.ok(completed.close > lastPrefix.close * 5, "fixture: completed close should dwarf the prefix");
    assert.ok(completed.volume > lastPrefix.volume * 100, "fixture: completed volume should dwarf the prefix");
    assert.equal(feed.at(-1)!.date, future, "fixture: the feed should return a bar beyond to");

    assert.equal(clean.sourceDates.length, WARMUP_SESSIONS + base.days);
    assert.deepEqual(dirty.sourceDates, clean.sourceDates);
    assert.deepEqual(dirty.simDates, clean.simDates);
    assert.deepEqual(dirty.aliases, clean.aliases);
    assert.deepEqual(dirty.symbols, clean.symbols);
    for (const alias of clean.symbols) {
      const tape = await dirty.bars(alias);
      assert.deepEqual(tape, await clean.bars(alias), `${alias} tape changed when a completed bar was available`);
      assert.ok(
        tape.every((bar) => bar.volume !== completedVolume && bar.volume !== futureVolume),
        `${alias} tape sampled the completed or future bar`,
      );
    }
    for (const date of [...clean.sourceDates, ...dirty.sourceDates]) {
      assert.ok(date < today, `selected source date ${date} is not strictly before ${today}`);
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
