import type { Bar } from "@rh/shared";

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

export function sessionFraction(date: string, at: number): number {
  return Math.max(0, Math.min(1, (at - etInstant(date, 9, 30)) / (390 * 60_000)));
}

/** Include every turn between checks, not just their endpoints. */
export function pathSegment(bar: Bar, from: number, to: number): { at: number; price: number }[] {
  const open = etInstant(bar.date, 9, 30);
  const close = etInstant(bar.date, 16);
  const times = [Math.max(open, from), open + 130 * 60_000, open + 260 * 60_000, Math.min(close, to)]
    .filter((at) => at >= Math.max(open, from) && at <= Math.min(close, to));
  return [...new Set(times)].sort((a, b) => a - b).map((at) => ({ at, price: pathPrice(bar, sessionFraction(bar.date, at)) }));
}

export function tradingDays(bars: Bar[], startDate: string, days: number): Bar[] {
  return bars.filter((bar) => bar.date >= startDate).sort((a, b) => a.date.localeCompare(b.date)).slice(0, days);
}
