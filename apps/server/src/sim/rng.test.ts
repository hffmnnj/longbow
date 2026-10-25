import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRng, geometricLength, intIn, pick, uniform } from "./rng.ts";

describe("seeded PRNG", () => {
  it("replays_the_same_sequence_for_the_same_seed", () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 50; i++) assert.equal(a(), b());
  });

  it("differs_across_seeds", () => {
    const a = createRng(7);
    const b = createRng(8);
    const first = Array.from({ length: 10 }, () => a());
    const second = Array.from({ length: 10 }, () => b());
    assert.notDeepEqual(first, second);
  });

  it("stays_in_unit_range_with_helpers_inside_bounds", () => {
    const rng = createRng(123);
    for (let i = 0; i < 200; i++) {
      const value = rng();
      assert.ok(value >= 0 && value < 1, `out of range: ${value}`);
      assert.ok(uniform(rng, 0.4, 2.5) >= 0.4 && uniform(rng, 0.4, 2.5) < 2.5);
      const n = intIn(rng, 0, 530);
      assert.ok(Number.isInteger(n) && n >= 0 && n <= 530);
    }
    assert.equal(pick(rng, ["only"]), "only");
    assert.throws(() => pick(rng, []), /empty/);
  });

  it("draws_geometric_lengths_with_the_requested_mean", () => {
    const rng = createRng(42);
    const lengths = Array.from({ length: 20000 }, () => geometricLength(rng, 10));
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    assert.ok(lengths.every((n) => n >= 1));
    assert.ok(Math.abs(mean - 10) < 0.5, `mean ${mean} far from 10`);
  });
});
