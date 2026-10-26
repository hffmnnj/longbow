import { MarketCache, MarketError, TTL } from "../cache.ts";

/**
 * US Treasury daily par yield curve CSV. Header columns look like
 * `"1 Mo", "3 Mo", ..., "30 Yr"` and dates are M/D/YYYY.
 */

export interface YieldRow {
  date: string;
  /** Tenor keys like "1M", "3M", "6M", "1Y", ..., "30Y" (percent values). */
  curve: Record<string, number>;
}

/** Headers we keep, mapped to compact tenor keys. */
const TENORS: Record<string, string> = {
  "1 mo": "1M",
  "3 mo": "3M",
  "6 mo": "6M",
  "1 yr": "1Y",
  "2 yr": "2Y",
  "3 yr": "3Y",
  "5 yr": "5Y",
  "7 yr": "7Y",
  "10 yr": "10Y",
  "20 yr": "20Y",
  "30 yr": "30Y",
};

export function treasuryUrl(year: number): string {
  return (
    `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/` +
    `daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`
  );
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseTreasuryDate(raw: string): string | undefined {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!m) return undefined;
  return `${m[3]}-${m[1]?.padStart(2, "0")}-${m[2]?.padStart(2, "0")}`;
}

export function parseTreasuryCsv(text: string): YieldRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0] as string);
  const dateIdx = 0;
  const tenorIdx: { key: string; idx: number }[] = [];
  for (let i = 1; i < header.length; i++) {
    const norm = (header[i] ?? "").toLowerCase();
    const key = TENORS[norm];
    if (key !== undefined) tenorIdx.push({ key, idx: i });
  }
  if (tenorIdx.length === 0) return [];
  const rows: YieldRow[] = [];
  const seen = new Set<string>();
  for (let n = 1; n < lines.length; n++) {
    const cells = splitCsvLine(lines[n] as string);
    const date = parseTreasuryDate(cells[dateIdx] ?? "");
    if (date === undefined || seen.has(date)) continue;
    const curve: Record<string, number> = {};
    let ok = false;
    for (const { key, idx } of tenorIdx) {
      const raw = cells[idx] ?? "";
      if (raw === "" || raw.toLowerCase() === "n/a") continue;
      if (!/^-?\d+(\.\d+)?$/.test(raw)) continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      curve[key] = num;
      ok = true;
    }
    if (!ok) continue;
    seen.add(date);
    rows.push({ date, curve });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

/** Full-year CSVs for the current and previous year, merged oldest first. */
export async function fetchYieldCurve(cache: MarketCache, year: number): Promise<YieldRow[]> {
  const current = await cache.getOrFetch(`treasury-${year}`, TTL.yieldsMs, async () => {
    const rows = parseTreasuryCsv(await cache.fetchText(treasuryUrl(year)));
    if (rows.length === 0) throw new MarketError("bad_response", `treasury yield curve for ${year} returned no usable rows`);
    return rows;
  });
  const prev = await cache.getOrFetch(`treasury-${year - 1}`, TTL.yieldsMs, async () => {
    try {
      return parseTreasuryCsv(await cache.fetchText(treasuryUrl(year - 1)));
    } catch {
      return [];
    }
  });
  const merged = [...prev, ...current.filter((r) => !prev.some((p) => p.date === r.date))];
  merged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return merged;
}
