import type { Bar, HistoryRange, NoteContent, NoteFile, Skill, SkillSummary, SubagentRun } from "@rh/shared";

/** Dev-only generated market data, notes and skills (VITE_MOCK_API=1). */

const BASE: Record<string, number> = {
  NVDA: 134.4, XLE: 91.6, JPM: 246.2, MSFT: 413.2, SPY: 584.3, QQQ: 506.8, AMD: 158.9, XLF: 49.7, TSLA: 262.4,
};
const DAYS: Record<HistoryRange, number> = { "1m": 21, "3m": 63, "6m": 126, "1y": 252, "2y": 504, "5y": 1260 };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function tradingDates(count: number, end = new Date()): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (out.length < count) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

export function mockHistory(symbol: string, range: HistoryRange): Bar[] {
  const total = DAYS["5y"];
  const rand = rng(hash(symbol));
  const end = BASE[symbol] ?? 40 + (hash(symbol) % 300);
  // Walk backwards from today's price so the series always ends at `end`.
  const closes: number[] = [end];
  const drift = 0.0004 + (rand() - 0.5) * 0.0004;
  for (let i = 1; i < total; i++) {
    const prev = closes[i - 1]!;
    closes.push(Math.max(2, prev / (1 + drift + (rand() - 0.5) * 0.028)));
  }
  closes.reverse();
  const dates = tradingDates(total);
  const n = DAYS[range];
  const bars: Bar[] = [];
  for (let i = total - n; i < total; i++) {
    const close = closes[i]!;
    const open = i === 0 ? close : closes[i - 1]! * (1 + (rand() - 0.5) * 0.006);
    const high = Math.max(open, close) * (1 + rand() * 0.008);
    const low = Math.min(open, close) * (1 - rand() * 0.008);
    bars.push({
      date: dates[i]!,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume: Math.round((8 + rand() * 14) * 1e6 * (1 + Math.abs(close - open) / close * 40)),
    });
  }
  return bars;
}

const NOW = Date.now();
const MIN = 60_000;

const NOTE_BODIES: Record<string, string> = {
  "plan.md": `# Plan

Stay selective into CPI. Energy is the weak sector, tech is where the relative strength sits.

## This week
- Exit **XLE** before its time stop on Monday
- Re-enter **NVDA** only on a retest of 128 with falling volume
- Hold \`MSFT\` entry at 413.20 until the 14:00 ET volatility window clears

## Risk budget
| Item | Used | Limit |
|---|---|---|
| Entries today | 1 | 2 |
| Sector tech | 11.2% | 20% |

> Cash is a position. No setup, no trade.
`,
  "lessons.md": `# Lessons

1. Quotes older than 60 seconds are not a basis for a limit price. Re-quote first.
2. Post-earnings drift works when the gap holds the 20 day; it fails when volume dries up on day two.
3. Do not average into a position that has already hit its invalidation.
`,
  "theses/NVDA.md": `# NVDA thesis

**Long, 12 shares at 118.40.** Data center demand read is intact.

- Invalidation: close under **112**
- Time stop: 2026-11-13
- Catalyst: supply checks into the next print

## Evidence
- Hyperscaler capex guides raised in all four reports
- Relative strength vs SMH at a three month high

## Open questions
- Does gross margin hold above 74% as Blackwell ramps?
`,
  "theses/MSFT.md": `# MSFT thesis

Post-earnings drift with a clean hold above the 20 day. Azure growth 34%, guidance raised, implied move priced.

Entry 413.20, invalidation 407.10 (gap fill), target 430.
`,
};

export const mockNotes = (): NoteFile[] =>
  Object.entries(NOTE_BODIES).map(([path, body], i) => ({
    path,
    size: body.length,
    updatedAt: NOW - (i * 47 + 9) * MIN,
  }));

export const mockNote = (path: string): NoteContent | undefined => {
  const body = NOTE_BODIES[path];
  return body === undefined ? undefined : { path, content: body, updatedAt: NOW - 30 * MIN };
};

const SKILLS: SkillSummary[] = [
  { name: "post-earnings-drift", description: "Entry rules and sizing for post-earnings drift setups." },
  { name: "trend-pullback", description: "Buying pullbacks to the 20 and 50 day in confirmed uptrends." },
  { name: "risk-review", description: "Checklist the risk reviewer applies before any order is proposed." },
  { name: "position-sizing", description: "Size from the invalidation price and the per-trade risk budget." },
  { name: "sector-rotation", description: "Reading relative strength across sector ETFs." },
  { name: "macro-calendar", description: "How to trade around CPI, FOMC and jobs data." },
  { name: "exit-discipline", description: "Time stops, invalidation exits and scaling out." },
  { name: "journal-writing", description: "How to write a decision entry that can be audited later." },
];

export const mockSkills = (): SkillSummary[] => SKILLS;

export const mockSkill = (name: string): Skill | undefined => {
  const s = SKILLS.find((x) => x.name === name);
  if (!s) return undefined;
  return {
    ...s,
    files: ["checklist.md"],
    body: `# ${s.name}\n\n${s.description}\n\n## When to use\n- A named catalyst or a clean technical setup exists\n- The spread is under 20 bps and the quote is fresh\n\n## Steps\n1. Pull daily history and compute the 20 and 50 day averages.\n2. Define the invalidation price before the entry.\n3. Size so the loss to invalidation stays under the per-trade budget.\n4. Write the thesis in \`theses/<SYMBOL>.md\`.\n\n## Do not\n- Chase a move that already ran more than 2 ATR\n- Enter inside the first 30 minutes of the session\n`,
  };
};

export const ROLE_TASKS: Record<string, string> = {
  bull: "Make the strongest case for buying MSFT here.",
  bear: "Make the strongest case against buying MSFT here.",
  risk_reviewer: "Review the proposed MSFT order against the risk limits.",
};

export const ROLE_TEXT: Record<string, string> = {
  bull: "Azure growth of 34% with guidance raised is the cleanest catalyst on the board. The stock held the 20 day through the gap and relative strength vs QQQ is at a three month high. Implied move is already priced, so the asymmetry favors a limit entry near 413.20 with invalidation at the gap fill.",
  bear: "The easy money was the gap. Volume is fading on day two and the 50 day sits 4% below, so a failed hold gives back the move fast. Capex intensity is rising faster than revenue, and the spread widens into the 14:00 window. Skip, or halve the size.",
  risk_reviewer:
    "Risk to invalidation is 0.78% of equity against a 1.00% limit. Position after fill is 4.9% of equity against 5.0%. Technology exposure lands at 11.2% of 20%. All checks pass; the only soft spot is the quote age, which must be under 60 seconds at submit.",
};

export const mockRun = (id: string, role: SubagentRun["role"], startedAt: number, done: boolean): SubagentRun => ({
  id,
  role,
  symbol: "MSFT",
  task: ROLE_TASKS[role] ?? "Review the setup.",
  startedAt,
  status: done ? "done" : "running",
  ...(done ? { endedAt: startedAt + 9_000, answer: ROLE_TEXT[role] } : {}),
});
