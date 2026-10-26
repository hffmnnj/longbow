const MINUS = "\u2212";

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const numFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const pctFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Timestamp formatters run in the viewer's own time zone (the device clock) unless an
 * explicit `timeZone` is passed. Formatters are cached per zone; tests pass "America/New_York".
 */
type StampFormatters = {
  hm: Intl.DateTimeFormat;
  hms: Intl.DateTimeFormat;
  md: Intl.DateTimeFormat;
  dayKey: Intl.DateTimeFormat;
  weekday: Intl.DateTimeFormat;
};

const formatterCache = new Map<string, StampFormatters>();

function stampFormatters(timeZone?: string): StampFormatters {
  const key = timeZone ?? "";
  let cached = formatterCache.get(key);
  if (!cached) {
    const zone = timeZone ? { timeZone } : {};
    cached = {
      hm: new Intl.DateTimeFormat("en-US", { ...zone, hour: "numeric", minute: "2-digit", hour12: false, timeZoneName: "short" }),
      hms: new Intl.DateTimeFormat("en-US", { ...zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "short" }),
      md: new Intl.DateTimeFormat("en-US", { ...zone, month: "short", day: "numeric" }),
      dayKey: new Intl.DateTimeFormat("en-CA", { ...zone }),
      weekday: new Intl.DateTimeFormat("en-US", { ...zone, weekday: "short" }),
    };
    formatterCache.set(key, cached);
  }
  return cached;
}

/** $1,234.50 (always two decimals). Negative values use a true minus sign. */
export function usd(value: number): string {
  const s = usdFmt.format(Math.abs(value));
  return value < 0 && Math.abs(value) >= 0.005 ? MINUS + s : s;
}

/** +$1,234.50 or −$1,234.50; zero has no sign. */
export function usdSigned(value: number): string {
  if (Math.abs(value) < 0.005) return usdFmt.format(0);
  return (value > 0 ? "+" : MINUS) + usdFmt.format(Math.abs(value));
}

/** +1.25% or −0.40%; zero has no sign. `value` is already a percentage. */
export function pctSigned(value: number): string {
  if (Math.abs(value) < 0.005) return pctFmt.format(0) + "%";
  return (value > 0 ? "+" : MINUS) + pctFmt.format(Math.abs(value)) + "%";
}

export function pct(value: number): string {
  return pctFmt.format(value) + "%";
}

export function qty(value: number): string {
  return numFmt.format(value);
}

export type Tone = "gain" | "loss" | "flat";
export function tone(value: number): Tone {
  if (Math.abs(value) < 0.005) return "flat";
  return value > 0 ? "gain" : "loss";
}

/** 14:05 MST (the viewer's zone, or `timeZone` when given) */
export function etTime(ms: number, timeZone?: string): string {
  return normalizeHour(stampFormatters(timeZone).hm.format(ms));
}

/** 14:05:09 MST */
export function etClock(ms: number, timeZone?: string): string {
  return normalizeHour(stampFormatters(timeZone).hms.format(ms));
}

/** "Today 14:05 MST", "Oct 23 14:05 MST" */
export function etStamp(ms: number, now = Date.now(), timeZone?: string): string {
  const f = stampFormatters(timeZone);
  const same = f.dayKey.format(ms) === f.dayKey.format(now);
  return same ? etTime(ms, timeZone) : `${f.md.format(ms)} ${etTime(ms, timeZone)}`;
}

export function etDay(ms: number, timeZone?: string): string {
  const f = stampFormatters(timeZone);
  return `${f.weekday.format(ms)} ${f.md.format(ms)}`;
}

/** Some runtimes emit "24:05" for midnight with hour12:false. */
function normalizeHour(s: string): string {
  return s.startsWith("24") ? "00" + s.slice(2) : s;
}

/** 3h 12m, 12m 05s, 45s. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** 12s ago, 4m ago, 3h ago, then a date. */
export function ago(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  if (diff < 45_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return stampFormatters().md.format(ms);
}

/** 412ms, 1.8s, 12s, 1m 05s. */
export function durationShort(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

/** Calendar day as YYYY-MM-DD in the viewer's zone, for "today" comparisons. */
export const etDayKey = (ms: number): string => stampFormatters().dayKey.format(ms);

const isoShortFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
/** "2026-10-05" -> "Oct 5". Falls back to the input when it is not a date. */
export function isoShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : isoShortFmt.format(d);
}

const isoDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
/** "2026-10-26" -> "Mon, Oct 26". Falls back to the input when it is not a date. */
export function isoDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : isoDayFmt.format(d);
}

/** 4.18 -> "4.18%" for yields, always two decimals. */
export const yieldPct = (v: number): string => `${v.toFixed(2)}%`;

/** Dollars without cents for axes and big figures: $25,432. */
export function usd0(value: number): string {
  return usd(Math.round(value)).replace(/\.00$/, "");
}

/** 41200000 -> "$41M", for dollar volume. */
export function usdCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${Math.round(value / 1e6)}M`;
  if (abs >= 1e3) return `$${Math.round(value / 1e3)}K`;
  return `$${Math.round(value)}`;
}
