import type { Bar } from "@rh/shared";
import type { MarketCalendar } from "../ports.ts";
import { NYSE_HOLIDAY_COVERAGE } from "../risk/calendar.ts";

/** Convert an ET wall time without assuming a fixed DST offset. */
export function etInstant(date: string, hour: number, minute = 0): number {
  const noon = Date.parse(`${date}T12:00:00Z`);
  const etHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(noon));
  return noon + ((hour - etHour) * 60 + minute) * 60_000;
}

export function pathPrice(bar: Bar, fraction: number): number {
  const points = bar.close >= bar.open ? [bar.open, bar.low, bar.high, bar.close] : [bar.open, bar.high, bar.low, bar.close];
  const scaled = Math.max(0, Math.min(1, fraction)) * 3;
  const i = Math.min(2, Math.floor(scaled));
  return points[i]! + (points[i + 1]! - points[i]!) * (scaled - i);
}

export function sessionFraction(date: string, at: number, close = etInstant(date, 16)): number {
  const open = etInstant(date, 9, 30);
  return Math.max(0, Math.min(1, (at - open) / (close - open)));
}

/** Include every turn between checks, not just their endpoints. */
export function pathSegment(bar: Bar, from: number, to: number, close = etInstant(bar.date, 16)): { at: number; price: number }[] {
  const open = etInstant(bar.date, 9, 30);
  const third = (close - open) / 3;
  const times = [Math.max(open, from), open + third, open + 2 * third, Math.min(close, to)]
    .filter((at) => at >= Math.max(open, from) && at <= Math.min(close, to));
  return [...new Set(times)].sort((a, b) => a - b).map((at) => ({ at, price: pathPrice(bar, sessionFraction(bar.date, at, close)) }));
}

export function tradingDays(bars: Bar[], startDate: string, days: number): Bar[] {
  return bars.filter((bar) => bar.date >= startDate).sort((a, b) => a.date.localeCompare(b.date)).slice(0, days);
}

/** In covered years, don't replace a missing scored session with a later one. */
export function assertReplayBenchmarkCoverage(dates: string[], startDate: string, calendar: MarketCalendar): void {
  const lastDate = dates.at(-1);
  if (lastDate === undefined) return;
  const first = startDate < NYSE_HOLIDAY_COVERAGE.first ? NYSE_HOLIDAY_COVERAGE.first : startDate;
  const last = lastDate > NYSE_HOLIDAY_COVERAGE.last ? NYSE_HOLIDAY_COVERAGE.last : lastDate;
  const observed = new Set(dates);
  const through = Date.parse(`${last}T12:00:00Z`);
  for (let at = Date.parse(`${first}T12:00:00Z`); at <= through; at += 86_400_000) {
    const date = new Date(at).toISOString().slice(0, 10);
    if (!observed.has(date) && calendar.clock(at).tradingDay === date) {
      throw new Error(`Missing SPY bar for scheduled replay session ${date}`);
    }
  }
}

/** Intraday grid for realistic execution: 78 five-minute intervals from 09:30 to 16:00 ET. */
export const REALISTIC_INTERVALS = 78;

const realisticCache = new Map<string, { at: number; price: number }[]>();

function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): () => number {
  let spare: number | undefined;
  return () => {
    if (spare !== undefined) {
      const value = spare;
      spare = undefined;
      return value;
    }
    let u = 0;
    while (u === 0) u = rng();
    const v = rng();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    spare = magnitude * Math.sin(2 * Math.PI * v);
    return magnitude * Math.cos(2 * Math.PI * v);
  };
}

/** One bridge segment between two pinned anchors, scaled to stay strictly inside (low, high). */
function bridgeInto(prices: number[], fromIdx: number, fromPrice: number, toIdx: number, toPrice: number,
  range: number, gauss: () => number, low: number, high: number): void {
  const steps = toIdx - fromIdx;
  const walk = [0];
  for (let k = 1; k <= steps; k++) walk.push(walk[k - 1]! + gauss());
  const pinned = walk[steps]!;
  const sigma = range * 0.2 / Math.sqrt(Math.max(1, steps));
  const deviations = walk.map((w, i) => (w - (i / steps) * pinned) * sigma);
  let scale = 1;
  for (let i = 1; i < steps; i++) {
    const linear = fromPrice + (toPrice - fromPrice) * (i / steps);
    const headroom = Math.min(high - linear, linear - low);
    const magnitude = Math.abs(deviations[i]!);
    if (magnitude === 0) continue;
    if (headroom <= 0) {
      scale = 0;
      break;
    }
    scale = Math.min(scale, (0.999 * headroom) / magnitude);
  }
  for (let i = 0; i <= steps; i++) {
    prices[fromIdx + i] = fromPrice + (toPrice - fromPrice) * (i / steps) + scale * deviations[i]!;
  }
}

function buildRealisticPath(bar: Bar, symbol: string, seed: number, close: number): { at: number; price: number }[] {
  const open = etInstant(bar.date, 9, 30);
  const count = Math.max(3, Math.round((close - open) / (5 * 60_000)));
  const step = (close - open) / count;
  const at = (i: number): number => open + i * step;
  // Even an inconsistent vendor range must not silently replace the quoted open or close.
  const reportedLow = Math.min(bar.low, bar.high);
  const reportedHigh = Math.max(bar.low, bar.high);
  const low = Math.min(reportedLow, bar.open, bar.close);
  const high = Math.max(reportedHigh, bar.open, bar.close);
  if (!(high > low)) {
    return Array.from({ length: count + 1 }, (_, i) => ({ at: at(i), price: bar.open }));
  }
  const rng = mulberry32(hashSeed(`${seed}|${symbol}|${bar.date}`));
  const lowFirst = rng() < (bar.close >= bar.open ? 0.65 : 0.35);
  let first = 1 + Math.floor(rng() * (count - 1));
  let second = 1 + Math.floor(rng() * (count - 1));
  let guard = 0;
  while (second === first && guard++ < 100) second = 1 + Math.floor(rng() * (count - 1));
  if (second === first) second = first > 1 ? first - 1 : first + 1;
  const lowIdx = lowFirst ? Math.min(first, second) : Math.max(first, second);
  const highIdx = lowFirst ? Math.max(first, second) : Math.min(first, second);
  const gauss = gaussian(rng);
  const prices = new Array<number>(count + 1);
  const anchors: Array<[number, number]> = [[0, bar.open], [count, bar.close]];
  // An expanded extreme is already observed at an endpoint, not separately inside the session.
  if (low === reportedLow) anchors.push([lowIdx, low]);
  if (high === reportedHigh) anchors.push([highIdx, high]);
  anchors.sort((a, b) => a[0] - b[0]);
  for (let s = 0; s < anchors.length - 1; s++) {
    const from = anchors[s]!;
    const to = anchors[s + 1]!;
    bridgeInto(prices, from[0], from[1], to[0], to[1], high - low, gauss, low, high);
  }
  return prices.map((price, i) => ({ at: at(i), price }));
}

/**
 * Seeded Brownian bridge through a session: starts at the open, ends at the
 * close, and draws a visit to each extreme at seeded interior points.
 * An inconsistent high/low is expanded only enough to include observed endpoints.
 * The stream derives from seed, symbol and date, and
 * the path is cached, so a symbol and date always map to the same path.
 */
export function realisticPath(bar: Bar, symbol: string, seed: number, close = etInstant(bar.date, 16)): { at: number; price: number }[] {
  const key = `${seed}|${symbol}|${bar.date}|${close}|${bar.open}|${bar.high}|${bar.low}|${bar.close}`;
  const cached = realisticCache.get(key);
  if (cached !== undefined) return cached.map((p) => ({ ...p }));
  const points = buildRealisticPath(bar, symbol, seed, close);
  realisticCache.set(key, points);
  return points.map((p) => ({ ...p }));
}

/** Linear interpolation of the realistic path, clamped to the session. */
export function realisticPrice(bar: Bar, symbol: string, seed: number, at: number, close = etInstant(bar.date, 16)): number {
  const path = realisticPath(bar, symbol, seed, close);
  const first = path[0]!;
  const last = path[path.length - 1]!;
  if (at <= first.at) return first.price;
  if (at >= last.at) return last.price;
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid]!.at <= at) lo = mid;
    else hi = mid;
  }
  const a = path[lo]!;
  const b = path[hi]!;
  return a.price + (b.price - a.price) * ((at - a.at) / (b.at - a.at));
}

/** The realistic path sliced to [from, to], with interpolated endpoints and no future points. */
export function realisticSegment(bar: Bar, symbol: string, seed: number, from: number, to: number, close = etInstant(bar.date, 16)): { at: number; price: number }[] {
  const path = realisticPath(bar, symbol, seed, close);
  const start = Math.max(path[0]!.at, from);
  const end = Math.min(path[path.length - 1]!.at, to);
  if (end < start) return [];
  const points = [{ at: start, price: realisticPrice(bar, symbol, seed, start, close) }];
  for (const p of path) {
    if (p.at > start && p.at < end) points.push({ ...p });
  }
  if (end > start) points.push({ at: end, price: realisticPrice(bar, symbol, seed, end, close) });
  return points;
}
