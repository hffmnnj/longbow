import type { Bar } from "@rh/shared";

/** Simple moving average of closes; entries before `period` bars exist are omitted. */
export function sma(bars: readonly Bar[], period: number): { time: string; value: number }[] {
  const out: { time: string; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i]!.close;
    if (i >= period) sum -= bars[i - period]!.close;
    if (i >= period - 1) out.push({ time: bars[i]!.date, value: sum / period });
  }
  return out;
}

/** Percent change from the first close to the last close. */
export function periodReturn(bars: readonly Bar[]): number | undefined {
  const first = bars[0]?.close;
  const last = bars[bars.length - 1]?.close;
  if (first === undefined || last === undefined || first === 0) return undefined;
  return ((last - first) / first) * 100;
}

const TICKER = /^[A-Z]{1,5}(\.[A-Z])?$/;
export const isTicker = (s: string) => TICKER.test(s);
