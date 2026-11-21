import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createNyseCalendar } from "./calendar.ts";

const calendar = createNyseCalendar();
/** 2026-11-02 10:05 ET (EST, after the Nov 1 fallback): Monday morning session. */
const MONDAY_OPEN = Date.UTC(2026, 10, 2, 15, 5, 0);

describe("nyse calendar", () => {
  it("is open during the regular session after the DST fallback", () => {
    const clock = calendar.clock(MONDAY_OPEN);
    assert.equal(clock.session, "regular");
    assert.equal(clock.isOpen, true);
    assert.equal(clock.tradingDay, "2026-11-02");
    assert.equal(clock.earlyClose, false);
  });

  it("is in pre-market before the open", () => {
    const clock = calendar.clock(Date.UTC(2026, 10, 2, 12, 0, 0));
    assert.equal(clock.session, "pre");
    assert.equal(clock.isOpen, false);
  });

  it("is in post-market after the close", () => {
    const clock = calendar.clock(Date.UTC(2026, 10, 2, 21, 30, 0));
    assert.equal(clock.session, "post");
    assert.equal(clock.isOpen, false);
  });

  it("is closed overnight", () => {
    const clock = calendar.clock(Date.UTC(2026, 10, 3, 2, 0, 0));
    assert.equal(clock.session, "closed");
    assert.equal(clock.tradingDay, "2026-11-03");
  });

  it("treats Thanksgiving 2026 as a full closure", () => {
    const noon = calendar.clock(Date.UTC(2026, 10, 26, 17, 0, 0));
    assert.equal(noon.isOpen, false);
    assert.equal(noon.session, "closed");
    assert.equal(noon.tradingDay, "2026-11-27");
  });

  it("closes early at 13:00 ET on 2026-11-27", () => {
    const noon = calendar.clock(Date.UTC(2026, 10, 27, 17, 0, 0));
    assert.equal(noon.isOpen, true);
    assert.equal(noon.earlyClose, true);
    const afternoon = calendar.clock(Date.UTC(2026, 10, 27, 18, 30, 0));
    assert.equal(afternoon.session, "post");
    assert.equal(afternoon.isOpen, false);
  });

  it("closes early at 13:00 ET on 2025-07-03", () => {
    const beforeClose = calendar.clock(Date.UTC(2025, 6, 3, 16, 59, 0));
    assert.equal(beforeClose.session, "regular");
    assert.equal(beforeClose.isOpen, true);
    assert.equal(beforeClose.earlyClose, true);
    const atClose = calendar.clock(Date.UTC(2025, 6, 3, 17, 0, 0));
    assert.equal(atClose.session, "post");
    assert.equal(atClose.isOpen, false);
  });

  it("treats the 2025-01-09 day of mourning as a full closure", () => {
    const noon = calendar.clock(Date.UTC(2025, 0, 9, 17, 0, 0));
    assert.equal(noon.isOpen, false);
    assert.equal(noon.session, "closed");
    assert.equal(noon.tradingDay, "2025-01-10");
    assert.equal(calendar.tradingDaysBetween("2025-01-08", "2025-01-10"), 0);
  });

  it("covers full closures from the 2024-01-01 boundary", () => {
    const newYear = calendar.clock(Date.UTC(2024, 0, 1, 15, 0, 0));
    assert.equal(newYear.isOpen, false);
    assert.equal(newYear.tradingDay, "2024-01-02");
    const julyFourth = calendar.clock(Date.UTC(2024, 6, 4, 16, 0, 0));
    assert.equal(julyFourth.isOpen, false);
    assert.equal(julyFourth.session, "closed");
    assert.equal(julyFourth.tradingDay, "2024-07-05");
  });

  it("derives the ET date across the midnight boundary", () => {
    assert.equal(calendar.etDate(Date.UTC(2026, 10, 3, 3, 30, 0)), "2026-11-02");
    assert.equal(calendar.etDate(Date.UTC(2026, 10, 3, 5, 30, 0)), "2026-11-03");
  });

  it("counts trading days strictly between two ET dates", () => {
    assert.equal(calendar.tradingDaysBetween("2026-11-25", "2026-11-30"), 1);
    assert.equal(calendar.tradingDaysBetween("2026-11-02", "2026-11-03"), 0);
    assert.equal(calendar.tradingDaysBetween("2026-11-02", "2026-11-02"), 0);
  });
});
