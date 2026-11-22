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

  it("treats 2021 exceptions in the extended coverage", () => {
    const newYear = calendar.clock(Date.UTC(2021, 0, 1, 15, 0, 0));
    assert.equal(newYear.isOpen, false);
    assert.equal(newYear.tradingDay, "2021-01-04");
    const thanksgiving = calendar.clock(Date.UTC(2021, 10, 25, 17, 0, 0));
    assert.equal(thanksgiving.session, "closed");
    const beforeEarlyClose = calendar.clock(Date.UTC(2021, 10, 26, 17, 59, 0));
    assert.equal(beforeEarlyClose.session, "regular");
    assert.equal(beforeEarlyClose.earlyClose, true);
    const atEarlyClose = calendar.clock(Date.UTC(2021, 10, 26, 18, 0, 0));
    assert.equal(atEarlyClose.session, "post");
    assert.equal(atEarlyClose.isOpen, false);
  });

  it("keeps 2021-12-31 a full regular session", () => {
    const noon = calendar.clock(Date.UTC(2021, 11, 31, 17, 0, 0));
    assert.equal(noon.tradingDay, "2021-12-31");
    assert.equal(noon.earlyClose, false);
    assert.equal(noon.isOpen, true);
    const atClose = calendar.clock(Date.UTC(2021, 11, 31, 21, 0, 0));
    assert.equal(atClose.session, "post");
  });

  it("treats the first Juneteenth closure and 2022 observations as full closures", () => {
    const juneteenth = calendar.clock(Date.UTC(2022, 5, 20, 17, 0, 0));
    assert.equal(juneteenth.session, "closed");
    assert.equal(juneteenth.tradingDay, "2022-06-21");
    const christmas = calendar.clock(Date.UTC(2022, 11, 26, 15, 0, 0));
    assert.equal(christmas.session, "closed");
    assert.equal(christmas.tradingDay, "2022-12-27");
    const earlyClose = calendar.clock(Date.UTC(2022, 10, 25, 17, 59, 0));
    assert.equal(earlyClose.session, "regular");
    assert.equal(earlyClose.earlyClose, true);
    assert.equal(calendar.clock(Date.UTC(2022, 10, 25, 18, 0, 0)).session, "post");
    assert.equal(calendar.tradingDaysBetween("2022-11-23", "2022-11-28"), 1);
  });

  it("treats the 2023 observed New Year and early closes", () => {
    const newYear = calendar.clock(Date.UTC(2023, 0, 2, 17, 0, 0));
    assert.equal(newYear.session, "closed");
    assert.equal(newYear.tradingDay, "2023-01-03");
    const julyThird = calendar.clock(Date.UTC(2023, 6, 3, 16, 59, 0));
    assert.equal(julyThird.session, "regular");
    assert.equal(julyThird.earlyClose, true);
    assert.equal(calendar.clock(Date.UTC(2023, 6, 3, 17, 0, 0)).session, "post");
    const julyFourth = calendar.clock(Date.UTC(2023, 6, 4, 16, 0, 0));
    assert.equal(julyFourth.session, "closed");
    assert.equal(julyFourth.tradingDay, "2023-07-05");
    const afterThanksgiving = calendar.clock(Date.UTC(2023, 10, 24, 17, 59, 0));
    assert.equal(afterThanksgiving.session, "regular");
    assert.equal(afterThanksgiving.earlyClose, true);
    assert.equal(calendar.clock(Date.UTC(2023, 10, 24, 18, 0, 0)).session, "post");
  });

  it("still falls back to weekdays only before 2018", () => {
    const thanksgiving = calendar.clock(Date.UTC(2017, 10, 23, 17, 0, 0));
    assert.equal(thanksgiving.session, "regular");
    assert.equal(thanksgiving.isOpen, true);
    assert.equal(thanksgiving.tradingDay, "2017-11-23");
    assert.equal(thanksgiving.earlyClose, false);
    assert.equal(calendar.tradingDaysBetween("2017-11-22", "2017-11-24"), 1);
  });

  it("treats the 2018 day of mourning as a full closure", () => {
    const noon = calendar.clock(Date.UTC(2018, 11, 5, 17, 0, 0));
    assert.equal(noon.isOpen, false);
    assert.equal(noon.session, "closed");
    assert.equal(noon.tradingDay, "2018-12-06");
    assert.equal(calendar.tradingDaysBetween("2018-12-04", "2018-12-06"), 0);
  });

  it("treats 2020-07-03 as the observed Independence Day closure", () => {
    const noon = calendar.clock(Date.UTC(2020, 6, 3, 16, 0, 0));
    assert.equal(noon.isOpen, false);
    assert.equal(noon.session, "closed");
    assert.equal(noon.tradingDay, "2020-07-06");
  });

  it("closes early at 13:00 ET on the 2018-2020 half days", () => {
    const halfDays = ["2018-07-03", "2018-11-23", "2018-12-24", "2019-07-03",
      "2019-11-29", "2019-12-24", "2020-11-27", "2020-12-24"];
    for (const date of halfDays) {
      // 16:30 UTC is 11:30-12:30 ET and 18:30 UTC is 13:30-14:30 ET, so both
      // sit either side of the 13:00 close in EST and EDT.
      const beforeClose = calendar.clock(Date.parse(`${date}T16:30:00Z`));
      assert.equal(beforeClose.session, "regular", `${date} before close`);
      assert.equal(beforeClose.earlyClose, true, `${date} flagged early`);
      const afterClose = calendar.clock(Date.parse(`${date}T18:30:00Z`));
      assert.equal(afterClose.session, "post", `${date} after close`);
      assert.equal(afterClose.isOpen, false, `${date} closed`);
    }
  });

  it("counts 2018-2020 sessions from the extended coverage", () => {
    assert.equal(calendar.tradingDaysBetween("2017-12-31", "2019-01-01"), 251);
    assert.equal(calendar.tradingDaysBetween("2018-12-31", "2020-01-01"), 252);
    assert.equal(calendar.tradingDaysBetween("2019-12-31", "2021-01-01"), 253);
  });

  it("counts the 2021 New Year closure from 2020-12-31", () => {
    assert.equal(calendar.tradingDaysBetween("2020-12-31", "2021-01-04"), 0);
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

  it("reuses regular-session bounds without changing clock or etDate output", () => {
    const plain = createNyseCalendar();
    const reused = createNyseCalendar({ reuseRegularSession: true });

    const assertEquivalent = (label: string, iso: string) => {
      const now = Date.parse(iso);
      assert.deepEqual(reused.clock(now), plain.clock(now), `${label}: clock`);
      assert.equal(reused.etDate(now), plain.etDate(now), `${label}: etDate`);
    };

    // Fail prerequisites before comparing, so a mistyped instant cannot leave
    // the reuse path untested. These bounds are independent NYSE facts.
    const marchSixWarm = plain.clock(Date.parse("2026-03-06T15:05:00Z"));
    assert.equal(marchSixWarm.session, "regular", "warm-up must be a regular session");
    assert.equal(marchSixWarm.nextClose, Date.UTC(2026, 2, 6, 21, 0, 0));
    const halfDayWarm = plain.clock(Date.parse("2026-11-27T15:00:00Z"));
    assert.equal(halfDayWarm.session, "regular", "half-day warm-up must be a regular session");
    assert.equal(halfDayWarm.earlyClose, true);
    assert.equal(halfDayWarm.nextClose, Date.UTC(2026, 10, 27, 18, 0, 0));

    // March 6 2026 is EST and March 9 is the first EDT session after the
    // spring-forward weekend, so walking this range exercises cached bounds
    // across the offset change.
    assertEquivalent("March 6 regular warm", "2026-03-06T15:05:00Z");
    assertEquivalent("March 6 exact close", "2026-03-06T21:00:00Z");
    assertEquivalent("March 6 late post", "2026-03-07T00:59:59Z");
    assertEquivalent("March 7 20:00 ET boundary", "2026-03-07T01:00:00Z");
    assertEquivalent("March 7 weekend", "2026-03-07T15:00:00Z");
    assertEquivalent("March 8 spring-forward weekend", "2026-03-08T12:00:00Z");
    assertEquivalent("March 9 pre-open", "2026-03-09T13:29:00Z");
    assertEquivalent("March 9 exact open", "2026-03-09T13:30:00Z");
    assertEquivalent("March 9 regular", "2026-03-09T15:05:00Z");
    assertEquivalent("March 9 exact close", "2026-03-09T20:00:00Z");
    assertEquivalent("March 10 20:00 ET boundary", "2026-03-10T00:00:00Z");

    // Walking back through the cached session must not leak its bounds into
    // post-market, pre-market, or the prior EST session.
    assertEquivalent("March 9 reverse post", "2026-03-09T23:00:00Z");
    assertEquivalent("March 9 reverse regular", "2026-03-09T15:05:00Z");
    assertEquivalent("March 9 reverse open", "2026-03-09T13:30:00Z");
    assertEquivalent("March 9 reverse pre-open", "2026-03-09T13:25:00Z");
    assertEquivalent("March 6 reverse post", "2026-03-06T22:00:00Z");
    assertEquivalent("March 6 reverse regular", "2026-03-06T20:59:00Z");
    assertEquivalent("March 6 reverse open", "2026-03-06T14:30:00Z");
    assertEquivalent("March 6 reverse pre-open", "2026-03-06T13:00:00Z");

    // 2026-11-27 is the shortened day after Thanksgiving: a 13:00 ET close.
    assertEquivalent("half-day regular warm", "2026-11-27T15:00:00Z");
    assertEquivalent("half-day exact close", "2026-11-27T18:00:00Z");
    assertEquivalent("half-day 20:00 ET boundary", "2026-11-28T01:00:00Z");
    assertEquivalent("half-day weekend", "2026-11-28T15:00:00Z");
    assertEquivalent("half-day next session", "2026-11-30T15:00:00Z");
  });
});
