import type { Bar } from "@rh/shared";
import { MarketCache, MarketError, TTL } from "../cache.ts";

/**
 * Nasdaq Data Link free endpoints: daily price history, the daily earnings
 * calendar, the per-symbol next-earnings endpoint, and the economic calendar.
 * Remote JSON is untrusted data; only the fields named here are parsed.
 */

export const NASDAQ_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  Accept: "application/json",
};

export type NasdaqAsset = "stocks" | "etf";

export interface EarningsRow {
  symbol: string;
  name: string;
  /** Normalized: "pre-market", "after hours", "during market", or the raw value. */
  time: string;
  epsForecast?: string;
  /** Reported EPS, present on historical calendar rows once results are out. */
  actualEps?: string;
  marketCap?: string;
  marketCapNum?: number;
}

export interface UpcomingEarnings {
  date: string;
  time?: string;
  epsForecast?: string;
}

export interface EconEvent {
  /** GMT time HH:MM as published. */
  time: string;
  country: string;
  event: string;
  actual?: string;
  consensus?: string;
  previous?: string;
}

/** Parse "$671.23", "12,345,678", 42, or "42" strictly; undefined otherwise. */
export function parseNasdaqNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[$,]/g, "").trim();
  if (cleaned === "" || !/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : undefined;
}

interface NasdaqRow {
  date?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
}

/** Rows are newest first upstream; the result is oldest first with bad rows dropped. */
export function parseNasdaqHistory(payload: unknown): Bar[] {
  if (typeof payload !== "object" || payload === null) return [];
  const rows = (payload as { data?: { tradesTable?: { rows?: unknown } } }).data?.tradesTable?.rows;
  if (!Array.isArray(rows)) return [];
  const bars: Bar[] = [];
  const seen = new Set<string>();
  for (const entry of rows) {
    const row = entry as NasdaqRow;
    if (typeof row !== "object" || row === null || typeof row.date !== "string") continue;
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(row.date) && !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const date = row.date.includes("/") ? toIsoDate(row.date) : row.date;
    if (date === undefined || seen.has(date)) continue;
    const open = parseNasdaqNumber(row.open);
    const high = parseNasdaqNumber(row.high);
    const low = parseNasdaqNumber(row.low);
    const close = parseNasdaqNumber(row.close);
    const volume = parseNasdaqNumber(row.volume);
    if (open === undefined || high === undefined || low === undefined || close === undefined || volume === undefined) {
      continue;
    }
    seen.add(date);
    bars.push({ date, open, high, low, close, volume });
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return bars;
}

function toIsoDate(mdy: string): string | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mdy);
  if (!m) return undefined;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

export function historyUrl(symbol: string, asset: NasdaqAsset, from: string, to: string): string {
  return (
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical` +
    `?assetclass=${asset}&fromdate=${from}&todate=${to}&limit=9999`
  );
}

export async function fetchNasdaqHistory(
  cache: MarketCache,
  symbol: string,
  asset: NasdaqAsset,
  from: string,
  to: string,
  ttlMs: number,
): Promise<Bar[]> {
  const url = historyUrl(symbol, asset, from, to);
  return cache.getOrFetch(`nasdaq-history-${asset}-${symbol}-${from}-${to}`, ttlMs, async () => {
    const text = await cache.fetchText(url, { headers: NASDAQ_HEADERS });
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new MarketError("bad_response", `nasdaq history for ${symbol} returned invalid JSON`);
    }
    return parseNasdaqHistory(payload);
  });
}

function cleanCell(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const stripped = value.replace(/&nbsp;|\u00a0/g, "").trim();
  return stripped === "" ? undefined : stripped;
}

function normalizeEarningsTime(raw: unknown): string {
  const value = cleanCell(raw) ?? "";
  const map: Record<string, string> = {
    "time-pre-market": "pre-market",
    "time-after-hours": "after hours",
    "time-during-market": "during market",
  };
  if (map[value] !== undefined) return map[value] as string;
  return value
    .replace(/^time-/, "")
    .replace(/-/g, " ")
    .trim();
}

function parseMarketCap(value: unknown): number | undefined {
  const num = parseNasdaqNumber(value);
  return num === undefined ? undefined : num;
}

export function parseEarningsCalendar(payload: unknown): EarningsRow[] {
  if (typeof payload !== "object" || payload === null) return [];
  const rows = (payload as { data?: { rows?: unknown } }).data?.rows;
  if (!Array.isArray(rows)) return [];
  const out: EarningsRow[] = [];
  for (const entry of rows) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const symbol = cleanCell(row["symbol"]);
    const name = cleanCell(row["name"]);
    if (symbol === undefined || name === undefined) continue;
    const epsForecast = cleanCell(row["epsForecast"]);
    const actualEps = cleanCell(row["eps"]);
    const marketCap = cleanCell(row["marketCap"]);
    out.push({
      symbol,
      name,
      time: normalizeEarningsTime(row["time"]),
      ...(epsForecast === undefined ? {} : { epsForecast }),
      ...(actualEps === undefined ? {} : { actualEps }),
      ...(marketCap === undefined ? {} : { marketCap }),
      ...(parseMarketCap(row["marketCap"]) === undefined ? {} : { marketCapNum: parseMarketCap(row["marketCap"]) }),
    });
  }
  return out;
}

export async function fetchEarningsCalendar(cache: MarketCache, date: string): Promise<EarningsRow[]> {
  return cache.getOrFetch(`nasdaq-earnings-${date}`, TTL.calendarMs, async () => {
    const text = await cache.fetchText(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, {
      headers: NASDAQ_HEADERS,
    });
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new MarketError("bad_response", `nasdaq earnings calendar for ${date} returned invalid JSON`);
    }
    return parseEarningsCalendar(payload);
  });
}

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

/**
 * Parse the per-symbol earnings-date endpoint. Returns the expected report
 * date plus the session and consensus forecast when the text carries them.
 */
export function parseEarningsDate(payload: unknown): UpcomingEarnings | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const data = (payload as { data?: Record<string, unknown> }).data;
  if (typeof data !== "object" || data === null) return undefined;
  const report = typeof data["reportText"] === "string" ? data["reportText"] : "";
  const announcement = typeof data["announcement"] === "string" ? data["announcement"] : "";
  let date = parseReportTextDate(report);
  date ??= parseAnnouncementDate(announcement);
  if (date === undefined) return undefined;
  const out: UpcomingEarnings = { date };
  const lower = `${report} ${announcement}`.toLowerCase();
  if (lower.includes("after market close") || lower.includes("after hours")) out.time = "after hours";
  else if (lower.includes("before market open") || lower.includes("pre-market") || lower.includes("premarket")) {
    out.time = "pre-market";
  } else if (lower.includes("during market")) out.time = "during market";
  const eps = /consensus EPS forecast for the quarter is \$([\d,]+(?:\.\d+)?)/.exec(report)?.[1];
  if (eps !== undefined) out.epsForecast = `$${eps}`;
  return out;
}

function parseReportTextDate(report: string): string | undefined {
  const m = /report earnings on\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(report);
  if (!m) return undefined;
  return `${m[3]}-${m[1]}-${m[2]}`;
}

function parseAnnouncementDate(announcement: string): string | undefined {
  const m = /([A-Z][a-z]{2}) (\d{2}), (\d{4})/.exec(announcement);
  if (!m || MONTHS[m[1] as string] === undefined) return undefined;
  return `${m[3]}-${MONTHS[m[1] as string]}-${m[2]}`;
}

export async function fetchEarningsDate(cache: MarketCache, symbol: string): Promise<UpcomingEarnings | undefined> {
  return cache.getOrFetch(`nasdaq-earnings-date-${symbol}`, TTL.calendarMs, async () => {
    const text = await cache.fetchText(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(symbol)}/earnings-date`, {
      headers: NASDAQ_HEADERS,
    });
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new MarketError("bad_response", `nasdaq earnings date for ${symbol} returned invalid JSON`);
    }
    return parseEarningsDate(payload);
  });
}

/**
 * Scan the daily earnings calendar for the next `days` calendar days and
 * return the first upcoming report for `symbol`, if any.
 */
export async function findUpcomingEarnings(
  cache: MarketCache,
  symbol: string,
  fromDate: string,
  days = 30,
): Promise<UpcomingEarnings | undefined> {
  const start = new Date(`${fromDate}T12:00:00Z`).getTime();
  if (Number.isNaN(start)) return undefined;
  for (let i = 0; i <= days; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    let rows: EarningsRow[];
    try {
      rows = await fetchEarningsCalendar(cache, date);
    } catch {
      continue;
    }
    const match = rows.find((r) => r.symbol === symbol);
    if (match !== undefined) {
      return {
        date,
        ...(match.time === "" ? {} : { time: match.time }),
        ...(match.epsForecast === undefined ? {} : { epsForecast: match.epsForecast }),
      };
    }
  }
  return undefined;
}

export function parseEconomicEvents(payload: unknown): EconEvent[] {
  if (typeof payload !== "object" || payload === null) return [];
  const rows = (payload as { data?: { rows?: unknown } }).data?.rows;
  if (!Array.isArray(rows)) return [];
  const out: EconEvent[] = [];
  for (const entry of rows) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const time = cleanCell(row["gmt"]);
    const country = cleanCell(row["country"]);
    const event = cleanCell(row["eventName"]);
    if (time === undefined || country === undefined || event === undefined) continue;
    out.push({
      time,
      country,
      event,
      ...(cleanCell(row["actual"]) === undefined ? {} : { actual: cleanCell(row["actual"]) }),
      ...(cleanCell(row["consensus"]) === undefined ? {} : { consensus: cleanCell(row["consensus"]) }),
      ...(cleanCell(row["previous"]) === undefined ? {} : { previous: cleanCell(row["previous"]) }),
    });
  }
  return out;
}

export async function fetchEconomicEvents(cache: MarketCache, date: string): Promise<EconEvent[]> {
  return cache.getOrFetch(`nasdaq-econ-${date}`, TTL.calendarMs, async () => {
    const text = await cache.fetchText(`https://api.nasdaq.com/api/calendar/economicevents?date=${date}`, {
      headers: NASDAQ_HEADERS,
    });
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new MarketError("bad_response", `nasdaq economic calendar for ${date} returned invalid JSON`);
    }
    return parseEconomicEvents(payload);
  });
}
