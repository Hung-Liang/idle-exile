export const RNG_STREAMS = ["combat", "encounter", "loot", "craft", "map"] as const;

export type RngStreamName = (typeof RNG_STREAMS)[number];

/** sfc32 state: four uint32 words (a, b, c, counter). Plain array so it stays JSON-serializable. */
export type RngState = [number, number, number, number];

export type RngStates = Record<RngStreamName, RngState>;

/** Discarded outputs after seeding, so nearby seeds diverge before first use. */
const WARMUP_ROUNDS = 12;

/** FNV-1a, 32-bit. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

export function createStreamState(masterSeed: number, name: RngStreamName): RngState {
  const next = splitmix32((masterSeed ^ hashString(name)) >>> 0);
  const state: RngState = [next(), next(), next(), next()];
  for (let i = 0; i < WARMUP_ROUNDS; i++) {
    nextUint32(state);
  }
  return state;
}

export function createRngStates(masterSeed: number): RngStates {
  const states = {} as RngStates;
  for (const name of RNG_STREAMS) {
    states[name] = createStreamState(masterSeed, name);
  }
  return states;
}

/** sfc32 step. Mutates `state` in place. */
export function nextUint32(state: RngState): number {
  let [a, b, c, d] = state;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = ((c << 21) | (c >>> 11)) >>> 0;
  c = (c + t) >>> 0;
  state[0] = a >>> 0;
  state[1] = b;
  state[2] = c;
  state[3] = d;
  return t;
}

/** Uniform float in [0, 1). */
export function nextFloat(state: RngState): number {
  return nextUint32(state) / 0x1_0000_0000;
}

/** Uniform integer in [min, max], both inclusive. */
export function nextInt(state: RngState, min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new RangeError(`nextInt: invalid range [${min}, ${max}]`);
  }
  return min + Math.floor(nextFloat(state) * (max - min + 1));
}

/** Returns true with probability `p` (0..1). Always consumes one draw. */
export function nextChance(state: RngState, p: number): boolean {
  return nextFloat(state) < p;
}

/** Picks an index proportionally to `weights`. Always consumes exactly one draw. */
export function weightedIndex(state: RngState, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) {
    if (!(w >= 0) || !Number.isFinite(w)) {
      throw new RangeError(`weightedIndex: invalid weight ${w}`);
    }
    total += w;
  }
  if (total <= 0) {
    throw new RangeError("weightedIndex: total weight must be positive");
  }
  let roll = nextFloat(state) * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) {
      return i;
    }
  }
  // Floating-point residue: fall back to the last non-zero weight.
  for (let i = weights.length - 1; i >= 0; i--) {
    if (weights[i]! > 0) {
      return i;
    }
  }
  throw new Error("unreachable");
}
