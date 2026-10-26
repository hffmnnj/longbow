import { MarketCache, MarketError, TTL } from "../cache.ts";

/**
 * CBOE daily index history CSVs (VIX and the VIX3M/VIX9D term-structure
 * legs). Columns: DATE (MM/DD/YYYY), OPEN, HIGH, LOW, CLOSE.
 */

export interface VixBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type VixKind = "VIX" | "VIX3M" | "VIX9D";

export function vixUrl(kind: VixKind): string {
  return `https://cdn.cboe.com/api/global/us_indices/daily_prices/${kind}_History.csv`;
}

export function parseCboeCsv(text: string): VixBar[] {
  const lines = text.split(/\r?\n/);
  const bars: VixBar[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const cells = line.split(",").map((c) => c.trim());
    if (cells.length < 5) continue;
    const [rawDate, rawOpen, rawHigh, rawLow, rawClose] = cells as [string, string, string, string, string];
    const date = parseCboeDate(rawDate);
    const open = parseNum(rawOpen);
    const high = parseNum(rawHigh);
    const low = parseNum(rawLow);
    const close = parseNum(rawClose);
    if (date === undefined || open === undefined || high === undefined || low === undefined || close === undefined) {
      continue;
    }
    if (seen.has(date)) continue;
    seen.add(date);
    bars.push({ date, open, high, low, close });
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return bars;
}

function parseCboeDate(raw: string): string | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (!m) return undefined;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function parseNum(raw: string): number | undefined {
  if (raw === "" || !/^-?\d+(\.\d+)?$/.test(raw)) return undefined;
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
}

export async function fetchVixSeries(cache: MarketCache, kind: VixKind): Promise<VixBar[]> {
  return cache.getOrFetch(`cboe-${kind}`, TTL.vixMs, async () => {
    const text = await cache.fetchText(vixUrl(kind));
    const bars = parseCboeCsv(text);
    if (bars.length === 0) throw new MarketError("bad_response", `cboe ${kind} history returned no usable rows`);
    return bars;
  });
}
