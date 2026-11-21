import { beta, correlation } from "../market/indicators.ts";
import type { Bar } from "@rh/shared";

export type DatedReturn = {
  from: string;
  date: string;
  r: number;
}

export function datedReturns(bars: Bar[]): DatedReturn[] {
  const out: DatedReturn[] = [];
  for (let i = 1; i < bars.length; i++) {
    const before = bars[i - 1]!;
    const after = bars[i]!;
    if (before.date >= after.date || !Number.isFinite(before.close) || before.close <= 0 ||
      !Number.isFinite(after.close) || after.close <= 0) continue;
    out.push({ from: before.date, date: after.date, r: after.close / before.close - 1 });
  }
  return out;
}

/**
 * Intersect exact return intervals. A missing session must not turn a
 * two-session price move into a one-session risk observation.
 */
export function alignLast(
  series: Map<string, DatedReturn[]>,
  symbols: string[],
  days: number,
): { dates: string[]; matrix: Map<string, number[]> } {
  const maps = symbols.map((s) => new Map((series.get(s) ?? []).map((p) => [`${p.date}/${p.from}`, p] as const)));
  const common = [...(maps[0]?.keys() ?? [])].filter((key) => maps.every((map) => map.has(key))).sort().slice(-days);
  const matrix = new Map<string, number[]>();
  for (let k = 0; k < symbols.length; k++) {
    const map = maps[k]!;
    matrix.set(symbols[k]!, common.map((key) => map.get(key)!.r));
  }
  return { dates: common.map((key) => maps[0]!.get(key)!.date), matrix };
}

export type PairwiseTop = {
  a: string;
  b: string;
  correlation: number;
}

export function correlationMatrix(vectors: Map<string, number[]>): {
  symbols: string[];
  matrix: (number | null)[][];
  top?: PairwiseTop;
} {
  const symbols = [...vectors.keys()];
  const matrix: (number | null)[][] = symbols.map((a) =>
    symbols.map((b) => {
      if (a === b) return 1;
      const va = vectors.get(a) ?? [];
      const vb = vectors.get(b) ?? [];
      return correlation(va, vb) ?? null;
    }),
  );
  let top: PairwiseTop | undefined;
  for (let x = 0; x < symbols.length; x++) {
    for (let y = x + 1; y < symbols.length; y++) {
      const v = matrix[x]?.[y];
      if (v === null || v === undefined) continue;
      if (top === undefined || v > top.correlation) {
        top = { a: symbols[x]!, b: symbols[y]!, correlation: v };
      }
    }
  }
  return { symbols, matrix, ...(top === undefined ? {} : { top }) };
}

/** Weighted portfolio return series from aligned component vectors and weights summing to 1. */
export function portfolioSeries(vectors: Map<string, number[]>, weights: Map<string, number>): number[] {
  const names = [...vectors.keys()];
  const len = Math.min(...names.map((n) => vectors.get(n)?.length ?? 0));
  if (!Number.isFinite(len) || len <= 0) return [];
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (const n of names) s += (weights.get(n) ?? 0) * (vectors.get(n)?.[i] ?? 0);
    out.push(s);
  }
  return out;
}

export function annualizedVol(daily: number[]): number | undefined {
  if (daily.length < 2) return undefined;
  const mean = daily.reduce((a, b) => a + b, 0) / daily.length;
  const variance = daily.reduce((a, r) => a + (r - mean) ** 2, 0) / (daily.length - 1);
  return Math.sqrt(variance * 252);
}

/** 1-day 95% historical VaR and expected shortfall as positive loss fractions. */
export function varEs95(daily: number[]): { varPct: number; esPct: number } | undefined {
  if (daily.length < 20) return undefined;
  const sorted = [...daily].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(0.05 * sorted.length) - 1);
  const cutoff = sorted[idx] ?? 0;
  const tail = sorted.slice(0, idx + 1);
  return {
    varPct: Math.max(0, -cutoff),
    esPct: Math.max(0, -tail.reduce((a, b) => a + b, 0) / Math.max(1, tail.length)),
  };
}

export function portfolioBeta(port: number[], bench: number[]): number | undefined {
  return beta(port, bench);
}

/** Indices of the `n` worst benchmark days, oldest first. */
export function worstDayIndices(bench: number[], n: number): number[] {
  return bench
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r - b.r)
    .slice(0, Math.min(n, bench.length))
    .sort((a, b) => a.i - b.i)
    .map((p) => p.i);
}
