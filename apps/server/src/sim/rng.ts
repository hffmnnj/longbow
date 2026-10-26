/**
 * Small seeded PRNG (mulberry32) for simulation markets. Every random choice
 * in a blind or bootstrap run flows through one of these, so the same config
 * and seed reproduce the same market exactly.
 */

/** 32-bit seed from any integer (negative seeds are folded in). */
export function createRng(seed: number): () => number {
  let state = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform double in [min, max). */
export function uniform(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Uniform integer in [min, max] inclusive. */
export function intIn(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** One element of a non-empty array. */
export function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("Cannot pick from an empty array");
  return item;
}

/**
 * Geometric block length with the given mean (at least 1), for the stationary
 * bootstrap: after each session, start a new block with probability 1/mean.
 */
export function geometricLength(rng: () => number, mean: number): number {
  let length = 1;
  while (rng() < 1 - 1 / mean) length++;
  return length;
}
