---
name: fundamentals-check
description: Runs a 5-minute quality and trend veto from sec_company facts and recent filings; load to reject bad businesses before any entry, never to value them.
---

Use when: a technical setup passed and you need to confirm the business is not disqualified before entry.

## Rules

1. This check vetoes; it never approves. A clean check means "not disqualified." Valuation is out of scope for this system; momentum and risk control do that work.
2. Pull `sec_company` and read the last 8 periods: revenue must be flat or growing year over year in at least 6 of 8. Two consecutive quarters of decline is a veto.
3. Earnings trajectory: net income positive in at least 6 of the last 8 periods, with no single quarter worse than negative 10 percent of revenue. One blowup quarter needs an explained, filed reason or it is a veto.
4. Dilution: shares outstanding growth under 5 percent annualized. Above that without a filed acquisition explanation is a veto; shareholders are being harvested.
5. Balance sheet: cash must cover at least 6 months of the recent quarterly cash burn (use net income as a rough proxy when cash flow is absent), and long-term debt must not have doubled in the last 2 years without a matching revenue step. Either failure is a veto.
6. Filings scan: open the most recent 10-Q or 10-K and the last two 8-Ks. Search for going-concern language, auditor changes, delayed filings, restatements, insider selling disclosure, and covenant waivers. Any hit is a veto until explained by a subsequent filing.
7. Five minutes means five minutes. If the facts above check out, stop reading and return to the setup. Deep dives are how entries get talked out of existence.

## Tool workflow

```js
const c = await tools.sec_company({ symbol: SYM });
const rev = c.revenue.slice(-8), ni = c.netIncome.slice(-8), sh = c.shares.slice(-8);
const growingQ = rev.filter((v, i) => i > 0 && v > rev[i - 1]).length;
const profitableQ = ni.filter(v => v > 0).length;
const dilution = (sh[sh.length - 1] - sh[0]) / sh[0]; // ~2y window, must be < ~0.10
const veto = growingQ < 5 || profitableQ < 6 || dilution > 0.10
  || c.longTermDebt[c.longTermDebt.length - 1] > 2 * c.longTermDebt[0];
// then scan c.filings links: latest 10-Q/10-K plus two newest 8-Ks
```

## Failure modes

- Turning the veto into a buy thesis. Good fundamentals do not time entries; they only remove landmines.
- Excusing dilution as "growth investment" without a filed explanation. Unexplained dilution is the veto working as designed.
- Skipping the check for ETFs and index trades. This skill is for single names; index ETFs bypass it by construction.
