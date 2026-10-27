import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  RNG_STREAMS,
  createRngStates,
  createStreamState,
  hashString,
  nextFloat,
  nextInt,
  nextUint32,
  weightedIndex,
  type RngState,
} from "../src/game/random";

function draw(state: RngState, n: number): number[] {
  return Array.from({ length: n }, () => nextUint32(state));
}

describe("hashString", () => {
  it("matches FNV-1a reference values", () => {
    expect(hashString("")).toBe(0x811c9dc5);
    expect(hashString("a")).toBe(0xe40c292c);
    expect(hashString("foobar")).toBe(0xbf9cf968);
  });
});

describe("streams", () => {
  it("are deterministic for the same seed", () => {
    expect(draw(createStreamState(42, "combat"), 50)).toEqual(draw(createStreamState(42, "combat"), 50));
  });

  it("differ between stream names and seeds", () => {
    const states = createRngStates(42);
    const sequences = RNG_STREAMS.map((name) => draw(states[name], 8).join(","));
    expect(new Set(sequences).size).toBe(RNG_STREAMS.length);
    expect(draw(createStreamState(43, "combat"), 8)).not.toEqual(draw(createStreamState(42, "combat"), 8));
  });

  it("are independent: consuming one stream does not affect another", () => {
    const a = createRngStates(7);
    const b = createRngStates(7);
    draw(a.combat, 1000);
    expect(draw(a.loot, 20)).toEqual(draw(b.loot, 20));
  });

  it("state survives a JSON round-trip mid-sequence", () => {
    const state = createStreamState(99, "craft");
    draw(state, 17);
    const copy = JSON.parse(JSON.stringify(state)) as RngState;
    expect(draw(copy, 30)).toEqual(draw(state, 30));
  });

  it("keeps state as uint32 words", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const state = createStreamState(seed, "map");
        draw(state, 5);
        return state.every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffffffff);
      }),
    );
  });
});

describe("nextFloat / nextInt", () => {
  it("nextFloat stays in [0, 1)", () => {
    const state = createStreamState(1, "combat");
    for (let i = 0; i < 10_000; i++) {
      const v = nextFloat(state);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("nextInt stays within inclusive bounds", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (seed, min, span) => {
          const state = createStreamState(seed, "loot");
          const v = nextInt(state, min, min + span);
          return Number.isInteger(v) && v >= min && v <= min + span;
        },
      ),
    );
  });

  it("nextInt rejects invalid ranges", () => {
    const state = createStreamState(1, "loot");
    expect(() => nextInt(state, 5, 4)).toThrow(RangeError);
    expect(() => nextInt(state, 0.5, 4)).toThrow(RangeError);
  });
});

describe("weightedIndex", () => {
  it("follows the weight distribution (chi-square, fixed seed)", () => {
    const weights = [50, 35, 15];
    const n = 30_000;
    const counts = [0, 0, 0];
    const state = createStreamState(12345, "encounter");
    for (let i = 0; i < n; i++) {
      counts[weightedIndex(state, weights)]!++;
    }
    const total = weights.reduce((s, w) => s + w, 0);
    const chi2 = counts.reduce((sum, observed, i) => {
      const expected = (n * weights[i]!) / total;
      return sum + (observed - expected) ** 2 / expected;
    }, 0);
    // Critical value for df = 2 at p = 0.001.
    expect(chi2).toBeLessThan(13.82);
  });

  it("never picks zero-weight entries", () => {
    const state = createStreamState(3, "loot");
    for (let i = 0; i < 5000; i++) {
      expect(weightedIndex(state, [0, 1, 0, 2, 0])).not.toBe(0);
    }
  });

  it("consumes exactly one draw", () => {
    const a = createStreamState(5, "loot");
    const b = createStreamState(5, "loot");
    weightedIndex(a, [1, 2, 3]);
    nextUint32(b);
    expect(a).toEqual(b);
  });

  it("rejects invalid weights", () => {
    const state = createStreamState(1, "loot");
    expect(() => weightedIndex(state, [])).toThrow(RangeError);
    expect(() => weightedIndex(state, [0, 0])).toThrow(RangeError);
    expect(() => weightedIndex(state, [1, -1])).toThrow(RangeError);
    expect(() => weightedIndex(state, [1, Number.NaN])).toThrow(RangeError);
  });
});
