---
name: macro-calendar
description: Keeps FOMC, CPI, payrolls, and PCE event risk out of new entries by checking the calendar reference before trading; load each morning and before any entry.
---

Use when: morning routine, before any new entry, and whenever `market_economic_calendar` shows an upcoming high-impact event.

## Rules

1. The four events that matter: FOMC decisions, CPI, payrolls (Employment Situation), and PCE (Personal Income and Outlays). Everything else is background unless the regime is bear-high-vol.
2. No new entries after 11:00 a.m. ET on the day before an FOMC decision, CPI, or payrolls release, and none before 10:30 a.m. ET on release day. Announcements land at 8:30 a.m. (data) or 2:00 p.m. (FOMC) ET; the window covers the positioning chop and the first reaction.
3. PCE gets a lighter rule: no new entries in the final 30 minutes before the 8:30 a.m. release and none in the first 30 minutes after. PCE rarely gaps the market the way payrolls does, but it reprices rate expectations.
4. Exact dates live in `references/calendar-2026-2027.md`. Check that file against `market_economic_calendar({ date })` each morning; if they disagree, the tool wins for today and the reference gets a correction note.
5. Event days compress liquidity and widen spreads. Re-verify the spread-under-20bps and limit-within-10bps-of-mid gates on any entry near an event; skipped entries for spread violation are correct outcomes, not missed opportunities.
6. Existing positions: no preemptive exits into events. Stops already encode the risk. The only action is canceling planned entries that fall inside the blackout windows.
7. Government shutdowns and reschedulings happen (early 2026 releases slipped). If a release did not occur on its scheduled date, assume volatility on the rescheduled date and re-check the BLS or BEA schedule directly.

## Tool workflow

```js
const today = new Date().toISOString().slice(0, 10);
const cal = await tools.market_economic_calendar({ date: today });
const big = (cal.events || []).filter(e =>
  /FOMC|CPI|Employment Situation|Payrolls|Personal Income|PCE/i.test(e.name || ""));
// if any big event is today or tomorrow morning: no new entries per rules 2-3
```

## Failure modes

- Trading a setup into tomorrow's payrolls because the entry "expires." Setups recur; event gaps do not give the premium back.
- Treating the reference file as perpetual truth. Calendars revise; the morning tool check is the control, the file is the plan.
- Exiting good positions the day before CPI out of nerves. The blackout applies to entries, and fear is not a sell signal.
