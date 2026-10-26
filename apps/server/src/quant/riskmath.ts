import { beta, correlation } from "../market/indicators.ts";

export type DatedReturn = {
  date: string;
  r: number;
}

/**
 * Intersect return series on date and return the last `days` paired points,
 * oldest first. Symbols missing dates simply contribute fewer points.
 */
export function alignLast(
  series: Map<string, DatedReturn[]>,
  symbols: string[],
  days: number,
): { dates: string[]; matrix: Map<string, number[]> } {
  const lists = symbols.map((s) => series.get(s) ?? []);
  const count = new Map<string, number>();
  for (const list of lists) for (const p of list) count.set(p.date, (count.get(p.date) ?? 0) + 1);
  const common = [...count.entries()]
    .filter(([, n]) => n === symbols.length)
    .map(([d]) => d)
    .sort()
    .slice(-days);
  const matrix = new Map<string, number[]>();
  for (let k = 0; k < symbols.length; k++) {
    const byDate = new Map((lists[k] ?? []).map((p) => [p.date, p.r] as const));
    matrix.set(symbols[k]!, common.map((d) => byDate.get(d) ?? 0));
  }
  return { dates: common, matrix };
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
