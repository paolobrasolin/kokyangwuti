/**
 * Seeded pseudo-random number generation.
 *
 * Every stochastic decision in the simulation and physics layers must flow
 * through an `Rng` so that a run is fully reproducible from its root seed.
 * `Math.random()` is reserved for purely cosmetic use in the render layer.
 *
 * Streams are *splittable*: `rng.fork(label)` derives a child stream from the
 * parent's **seed** (not its current position), so a fork is stable no matter
 * how many numbers the parent has already drawn. That makes constructions such
 * as `generationRng.fork(agentId)` — i.e. `hash(generationSeed, agentId)` —
 * deterministic and order-independent.
 */

export interface Rng {
  /** The 32-bit seed this stream was created from. Forks derive from it. */
  readonly seed: number;
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max], both ends inclusive. */
  int(min: number, max: number): number;
  /** True with probability `p` (p <= 0 never, p >= 1 always). */
  chance(p: number): boolean;
  /** +1 or -1 with equal probability. */
  sign(): 1 | -1;
  /** A uniformly chosen element of `items`. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** An independent child stream derived from `hash(this.seed, label)`. */
  fork(label: string | number): Rng;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function mixString(hash: number, text: string): number {
  let h = hash;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h;
}

/**
 * Combine any number of labels into a 32-bit unsigned seed.
 * Order matters, and the parts are separated so that `hash('a', 'bc')` and
 * `hash('ab', 'c')` differ.
 */
export function hashSeed(...parts: Array<string | number>): number {
  let h = FNV_OFFSET;
  for (const part of parts) {
    h = mixString(h, typeof part === 'number' ? numberToKey(part) : part);
    // Separator + avalanche between parts.
    h = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13;
  }
  h ^= h >>> 16;
  return h >>> 0;
}

function numberToKey(value: number): string {
  // Distinguish -0 from 0 and keep non-finite values addressable.
  if (Object.is(value, -0)) return '-0';
  return String(value);
}

/** mulberry32: tiny, fast, statistically decent for simulation noise. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create a stream from a numeric seed or an arbitrary string label. */
export function createRng(seed: number | string): Rng {
  const normalized = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  const next = mulberry32(normalized);

  const rng: Rng = {
    seed: normalized,
    next,
    range(min: number, max: number): number {
      return min + next() * (max - min);
    },
    int(min: number, max: number): number {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (hi < lo) return lo;
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    chance(p: number): boolean {
      return next() < p;
    },
    sign(): 1 | -1 {
      return next() < 0.5 ? 1 : -1;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('rng.pick: empty array');
      return items[Math.floor(next() * items.length)];
    },
    fork(label: string | number): Rng {
      return createRng(hashSeed(normalized, label));
    },
  };

  return rng;
}
