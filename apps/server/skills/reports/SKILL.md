---
name: reports
description: Publishes daily, weekly, and trade reports through publish_report after the close; load at each post-close review.
---

Use when: publishing the post-close reports, or deciding what a report narrative must contain.

## Rules

1. The agent writes the narrative, the server computes every number. Quote figures only from the tool's returned facts: never invent a pnl, a benchmark move, a win rate, or a trade count.
2. After every post-close review, publish one trade report per trade closed today, then the daily report. On the last trading day of the week, also publish the weekly report. The cycle input says whether today is the last trading day of the week.
3. Grade the decision quality, not the outcome: a loss on a well-run plan can earn an A, a win on a broken rule earns a D or F. The gradeReason is one sentence on what was decided well or badly with what was known then.
4. Keep the narrative plain and specific: one plain headline sentence, two to four summary sentences, short titled sections ("What worked", "What didn't", "Market", "Positions"), and short lessons and next steps. No essays, no feelings, no restatements of the journal.
5. A trade report covers the most recent closed trade for its symbol: check the day's fills first so every closed trade gets exactly one report. The daily report covers the ET trading date; the weekly report covers Monday through today.

## Tool workflow

```js
// One trade report per trade closed today, then the daily report.
await tools.publish_report({
  kind: "trade",
  symbol: "NVDA",
  headline: "Sold NVDA into strength after the breakout failed at the time stop.",
  summary: "Exited the full position at $187.42, two days before the time stop, after price closed back below the breakout level. The stop discipline held; the entry was a day early on volume that never confirmed.",
  grade: "B",
  gradeReason: "Followed the stop and time-stop rules, but entered before the volume confirmation the plan required.",
  sections: [
    { title: "What worked", body: "Sold into strength at the planned level; no renegotiation." },
    { title: "What didn't", body: "Entry front-ran the volume trigger by a day." },
  ],
  lessons: ["Wait for volume confirmation on breakout entries."],
  nextSteps: ["Watch for a retest with volume before re-entering."],
});
const daily = await tools.publish_report({
  kind: "daily",
  headline: "Flat day, no entries; one stop exit held the loss to plan.",
  summary: "No setups met the bar, so no entries. The NVDA exit followed the time stop and cost 0.8R. Equity ended the day near its open.",
  sections: [{ title: "Market", body: "Quote the regime and the index move from the tool's returned facts." }],
  lessons: [],
  nextSteps: ["Carry the two watchlist names into tomorrow's plan."],
});
// Quote only what the tool returns, e.g. daily reports "pnl +$12.30 (+1.02%), benchmark +0.40%, 2 trades closed".
return daily;
```

## Failure modes

- Publishing a report before the review: the review decides the grades, not the other way around.
- Grading the outcome: a green trade that broke the rules is a failure of process, and the grade must say so.
- Repeating the journal verbatim: the report is the owner's summary, not the agent's notes; compress it.
- Skipping the weekly report on the last trading day of the week: the cycle input names the day, follow it.
