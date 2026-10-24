const TZ = "America/New_York";
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

const hm = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
  hour12: false,
});
const hms = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const md = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" });

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

/** 14:05 ET */
export function etTime(ms: number): string {
  return `${normalizeHour(hm.format(ms))} ET`;
}

/** 14:05:09 ET */
export function etClock(ms: number): string {
  return `${normalizeHour(hms.format(ms))} ET`;
}

/** "Today 14:05 ET", "Oct 23 14:05 ET" */
export function etStamp(ms: number, now = Date.now()): string {
  const same = dayKey.format(ms) === dayKey.format(now);
  return same ? etTime(ms) : `${md.format(ms)} ${etTime(ms)}`;
}

export function etDay(ms: number): string {
  return `${weekday.format(ms)} ${md.format(ms)}`;
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
  return `${md.format(ms)}`;
}
