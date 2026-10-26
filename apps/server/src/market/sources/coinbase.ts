import type { Bar } from "@rh/shared";
import { MarketCache, MarketError } from "../cache.ts";
import { NASDAQ_HEADERS } from "./nasdaq.ts";

/**
 * Coinbase Exchange public candles for crypto pairs (e.g. BTC-USD):
 * daily UTC-day candles, newest first upstream, at most 300 per request.
 * Remote JSON is untrusted data; only the fields named here are parsed.
 */

export const COINBASE_HEADERS: Record<string, string> = {
  "User-Agent": NASDAQ_HEADERS["User-Agent"] ?? "Mozilla/5.0",
  Accept: "application/json",
};

/** One candle: [time (epoch seconds, UTC midnight), low, high, open, close, volume]. */
export function parseCoinbaseCandles(payload: unknown): Bar[] {
  if (!Array.isArray(payload)) return [];
  const bars: Bar[] = [];
  const seen = new Set<string>();
  for (const entry of payload) {
    if (!Array.isArray(entry) || entry.length < 6) continue;
    const [time, low, high, open, close, volume] = entry;
    if (typeof time !== "number" || !Number.isFinite(time)) continue;
    const nums = [low, high, open, close, volume];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    const date = new Date(time * 1000).toISOString().slice(0, 10);
    if (seen.has(date)) continue;
    seen.add(date);
    bars.push({ date, open, high, low, close, volume });
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return bars;
}

export function coinbaseUrl(pair: string, startIso: string, endIso: string): string {
  return (
    `https://api.exchange.coinbase.com/products/${encodeURIComponent(pair)}/candles` +
    `?granularity=86400&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`
  );
}

/** Maximum span of one candles request; the API caps responses at 300 candles. */
export const COINBASE_WINDOW_DAYS = 290;

function isoDayPlus(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Daily bars for a crypto pair over `from..to` (oldest first), paged in
 * windows of at most 290 days so multi-year ranges work. Each window is
 * cached separately under the same TTL the caller chose.
 */
export async function fetchCoinbaseHistory(
  cache: MarketCache,
  pair: string,
  from: string,
  to: string,
  ttlMs: number,
): Promise<Bar[]> {
  if (from > to) return [];
  const out: Bar[] = [];
  const seen = new Set<string>();
  let start = from;
  while (start <= to) {
    let end = isoDayPlus(start, COINBASE_WINDOW_DAYS - 1);
    if (end > to) end = to;
    const startIso = `${start}T00:00:00Z`;
    // The candle for `end` opens at midnight of `end`, so the window ends at
    // midnight of the next day to include it.
    const endIso = `${isoDayPlus(end, 1)}T00:00:00Z`;
    const url = coinbaseUrl(pair, startIso, endIso);
    const chunk = await cache.getOrFetch<Bar[]>(`coinbase-candles-${pair}-${start}-${end}`, ttlMs, async () => {
      const text = await cache.fetchText(url, { headers: COINBASE_HEADERS });
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new MarketError("bad_response", `coinbase candles for ${pair} returned invalid JSON`);
      }
      return parseCoinbaseCandles(payload);
    });
    for (const b of chunk) {
      if (b.date < from || b.date > to) continue;
      if (seen.has(b.date)) continue;
      seen.add(b.date);
      out.push(b);
    }
    start = isoDayPlus(end, 1);
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}
