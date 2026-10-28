import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "@rh/shared";
import type { MarketCalendar } from "../ports.ts";
import type { MarketClock } from "@rh/shared";
import { etToMs, nextCycle } from "./cycles.ts";

const settings = { cycleMinutesOpen: 30, cycleMinutesClosed: 240 };

const etDate = (now: number): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Mondays-Fridays in the set trade; the early set closes at 13:00. */
function fakeCalendar(trading: Set<string>, early: Set<string> = new Set()): MarketCalendar {
  const clock = (now: number): MarketClock => {
    const date = etDate(now);
    const isTrading = trading.has(date);
    return {
      now,
      session: isTrading ? "regular" : "closed",
      isOpen: isTrading,
      tradingDay: isTrading ? date : "1970-01-01",
      nextOpen: now,
      nextClose: now,
      earlyClose: early.has(date),
    };
  };
  return {
    clock,
    etDate,
    tradingDaysBetween: () => 0,
  };
}

// A regular trading week plus an early-close Friday (Thanksgiving week 2026).
const week = new Set([
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
  "2026-10-29",
  "2026-10-30",
]);
const earlyFriday = new Set([...week, "2026-11-27"]);
const earlyOnly = new Set(["2026-11-27"]);

describe("nextCycle", () => {
  it("schedules pre-open before 09:00 on a trading day", () => {
    const at = nextCycle(etToMs("2026-10-26", 8 * 60), fakeCalendar(week), settings);
    assert.equal(at.kind, "pre_open");
    assert.equal(at.at, etToMs("2026-10-26", 9 * 60));
  });

  it("runs the overnight cycle at 04:00 ET instead of skipping to pre-open", () => {
    // Observed gap: 2026-10-28T04:48:00Z is 00:48 ET on a trading day, and the
    // four-hour overnight grid fires at 08:00Z (04:00 ET), well before pre-open.
    const now = Date.parse("2026-10-28T04:48:00Z");
    const at = nextCycle(now, fakeCalendar(week), settings);
    assert.deepEqual(at, { at: etToMs("2026-10-28", 4 * 60), kind: "overnight" });
    assert.equal(new Date(at.at).toISOString(), "2026-10-28T08:00:00.000Z");
  });

  it("runs the next overnight interval later the same morning while still before pre-open", () => {
    // 04:30 ET (08:30Z): the next grid point is 12:00Z (08:00 ET), still before pre-open.
    const at = nextCycle(etToMs("2026-10-28", 4 * 60 + 30), fakeCalendar(week), settings);
    assert.deepEqual(at, { at: etToMs("2026-10-28", 8 * 60), kind: "overnight" });
    assert.equal(new Date(at.at).toISOString(), "2026-10-28T12:00:00.000Z");
  });

  it("prefers pre-open when the overnight grid lands exactly on 09:00 ET", () => {
    // 08:00 ET (12:00Z) with an hourly closed cadence aligns exactly onto
    // pre-open at 13:00Z; the tie goes to pre-open.
    const hourly = { ...settings, cycleMinutesClosed: 60 };
    const at = nextCycle(etToMs("2026-10-26", 8 * 60), fakeCalendar(week), hourly);
    assert.deepEqual(at, { at: etToMs("2026-10-26", 9 * 60), kind: "pre_open" });
    assert.equal(new Date(at.at).toISOString(), "2026-10-26T13:00:00.000Z");
  });

  it("runs overnight before pre-open on the first trading day after the fall DST change", () => {
    // Monday 2026-11-02 is EST (UTC-5): 00:48 ET is 05:48Z, next grid point 08:00Z (03:00 ET).
    const afterDst = new Set(["2026-11-02"]);
    const now = Date.parse("2026-11-02T05:48:00Z");
    const at = nextCycle(now, fakeCalendar(afterDst), settings);
    assert.deepEqual(at, { at: etToMs("2026-11-02", 3 * 60), kind: "overnight" });
    assert.equal(new Date(at.at).toISOString(), "2026-11-02T08:00:00.000Z");
  });

  it("places pre-open at 14:00Z on the first trading day after the fall DST change", () => {
    // 09:00 EST is 14:00Z (not 13:00Z as under EDT), and the 16:00Z grid point loses to it.
    const afterDst = new Set(["2026-11-02"]);
    const at = nextCycle(etToMs("2026-11-02", 8 * 60), fakeCalendar(afterDst), settings);
    assert.deepEqual(at, { at: etToMs("2026-11-02", 9 * 60), kind: "pre_open" });
    assert.equal(new Date(at.at).toISOString(), "2026-11-02T14:00:00.000Z");
  });

  it("schedules intraday steps from 09:45 to 15:45", () => {
    const calendar = fakeCalendar(week);
    assert.deepEqual(nextCycle(etToMs("2026-10-26", 9 * 60 + 30), calendar, settings), {
      at: etToMs("2026-10-26", 9 * 60 + 45),
      kind: "intraday",
    });
    assert.deepEqual(nextCycle(etToMs("2026-10-26", 10 * 60), calendar, settings), {
      at: etToMs("2026-10-26", 10 * 60 + 15),
      kind: "intraday",
    });
    assert.deepEqual(nextCycle(etToMs("2026-10-26", 15 * 60 + 40), calendar, settings), {
      at: etToMs("2026-10-26", 15 * 60 + 45),
      kind: "intraday",
    });
  });

  it("schedules post-close at 16:10 after the last intraday", () => {
    const at = nextCycle(etToMs("2026-10-26", 15 * 60 + 50), fakeCalendar(week), settings);
    assert.deepEqual(at, { at: etToMs("2026-10-26", 16 * 60 + 10), kind: "post_close" });
  });

  it("falls back to an aligned overnight cycle after post-close", () => {
    const now = etToMs("2026-10-26", 17 * 60);
    const at = nextCycle(now, fakeCalendar(week), settings);
    assert.equal(at.kind, "overnight");
    assert.ok(at.at > now);
    assert.equal(at.at % (4 * 3600_000), 0);
  });

  it("schedules overnight on a weekend", () => {
    // Saturday 2026-10-24 12:00 ET.
    const now = etToMs("2026-10-24", 12 * 60);
    const at = nextCycle(now, fakeCalendar(week), settings);
    assert.equal(at.kind, "overnight");
    assert.ok(at.at > now);
    assert.equal(at.at % (4 * 3600_000), 0);
  });

  it("respects an early close at 13:00", () => {
    const calendar = fakeCalendar(earlyFriday, earlyOnly);
    // 12:50 ET: last intraday (12:45) has passed, post-close is at 13:10.
    assert.deepEqual(nextCycle(etToMs("2026-11-27", 12 * 60 + 50), calendar, settings), {
      at: etToMs("2026-11-27", 13 * 60 + 10),
      kind: "post_close",
    });
    // Midday still gets intraday steps.
    assert.deepEqual(nextCycle(etToMs("2026-11-27", 12 * 60), calendar, settings), {
      at: etToMs("2026-11-27", 12 * 60 + 15),
      kind: "intraday",
    });
  });

  it("honors the configured open cadence", () => {
    const hourly = { ...settings, cycleMinutesOpen: 60 };
    assert.deepEqual(nextCycle(etToMs("2026-10-26", 10 * 60), fakeCalendar(week), hourly), {
      at: etToMs("2026-10-26", 10 * 60 + 45),
      kind: "intraday",
    });
  });

  it("never returns a past time", () => {
    const calendar = fakeCalendar(week);
    for (const minutes of [0, 9 * 60, 9 * 60 + 45, 12 * 60, 15 * 60 + 45, 16 * 60 + 10, 23 * 60]) {
      const now = etToMs("2026-10-26", minutes) + 30_000;
      assert.ok(nextCycle(now, calendar, settings).at > now, `minutes=${minutes}`);
    }
  });

  it("uses default settings shape compatibly", () => {
    const at = nextCycle(etToMs("2026-10-24", 12 * 60), fakeCalendar(week), {
      cycleMinutesOpen: DEFAULT_SETTINGS.cycleMinutesOpen,
      cycleMinutesClosed: DEFAULT_SETTINGS.cycleMinutesClosed,
    });
    assert.equal(at.kind, "overnight");
  });
});
