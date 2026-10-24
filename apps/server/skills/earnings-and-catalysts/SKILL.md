---
name: earnings-and-catalysts
description: Enforces the 5-day earnings blackout, trades post-earnings drift only on held gaps, and structures catalyst research; load before any entry and around reports.
---

Use when: before entering any position, when a holding approaches its report, or when a price jump needs catalyst verification.

## Rules

1. Blackout: no new entries within 5 trading days before a scheduled earnings report. Check `market_earnings` for every candidate; if `daysUntil` is 5 or fewer, the name is untradable for entry until after the report. Existing positions may be held through only with a pre-written thesis and a stop.
2. Post-earnings drift: only trade the report when the stock gaps at least 5 percent, closes in the top half of its opening-day range, and holds above the gap midpoint for 2 sessions. Enter on day 3 in the direction of the gap, stop under the day-1 low (for upside gaps). Failed holds are not entries.
3. Never trade the initial reaction. The first 30 minutes after the open post-earnings belong to price discovery; the risk engine bars entries then anyway.
4. Catalyst research order for any unusual move: company press release or 8-K first, then the earnings call transcript or release, then reputable newswires, then everything else. If the move has no identifiable filing or wire behind it after 20 minutes of searching, treat it as noise and stand down.
5. Downside gaps in holdings: if a holding gaps down more than 8 percent on earnings, exit at the open. Post-earnings downside drift is real and turnarounds take quarters. The stop already fired; do not re-enter for 10 sessions.
6. Calendar awareness: use `market_earnings_calendar` for the day's largest reporters to know which names and sectors carry event risk, and `news_research` standards for citing anything found.

## Tool workflow

```js
const e = await tools.market_earnings({ symbol: SYM });
const blackout = e.daysUntil !== null && e.daysUntil <= 5;
const h = await tools.market_price_history({ symbol: SYM, range: "1m" });
const day1 = h.bars[h.bars.length - 2], day2 = h.bars[h.bars.length - 1];
const gapPct = (day1.open - h.bars[h.bars.length - 3].close) / h.bars[h.bars.length - 3].close;
const heldGap = day1.close > (day1.high + day1.low) / 2
  && day2.low > (day1.open + h.bars[h.bars.length - 3].close) / 2;
const driftEntry = Math.abs(gapPct) >= 0.05 && heldGap;
```

## Failure modes

- Entering the day before earnings because the chart is perfect. The chart cannot price the report; the blackout exists because gaps skip stops.
- Buying every earnings beat. Only gaps that hold their midpoint show institutional follow-through; the rest is retail churn.
- Researching backwards from a conclusion: finding three bullish blogs to justify a move instead of reading the filing first.
