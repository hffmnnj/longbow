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
