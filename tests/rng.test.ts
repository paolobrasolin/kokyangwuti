import { describe, expect, test } from '@rstest/core';
import { createRng, hashSeed } from '../src/rng';

function take(rng: { next(): number }, n: number): number[] {
  return Array.from({ length: n }, () => rng.next());
}

describe('hashSeed', () => {
  test('is deterministic and returns a uint32', () => {
    const a = hashSeed('gen', 3);
    expect(a).toBe(hashSeed('gen', 3));
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 ** 32);
  });

  test('is order sensitive and separates parts', () => {
    expect(hashSeed('a', 'b')).not.toBe(hashSeed('b', 'a'));
    expect(hashSeed('a', 'bc')).not.toBe(hashSeed('ab', 'c'));
    expect(hashSeed(1, 2)).not.toBe(hashSeed(12));
  });
});

describe('createRng', () => {
  test('same seed produces the same sequence', () => {
    expect(take(createRng(1234), 20)).toEqual(take(createRng(1234), 20));
  });

  test('different seeds produce different sequences', () => {
    expect(take(createRng(1234), 20)).not.toEqual(take(createRng(1235), 20));
  });

  test('accepts a string seed', () => {
    expect(take(createRng('hello'), 5)).toEqual(take(createRng('hello'), 5));
    expect(take(createRng('hello'), 5)).not.toEqual(
      take(createRng('world'), 5),
    );
    expect(createRng('hello').seed).toBe(hashSeed('hello'));
  });

  test('next() stays in [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 5000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('next() is roughly uniform', () => {
    const rng = createRng(99);
    const buckets = new Array(10).fill(0);
    const n = 20000;
    for (let i = 0; i < n; i++) buckets[Math.floor(rng.next() * 10)] += 1;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(n / 10 - n / 40);
      expect(count).toBeLessThan(n / 10 + n / 40);
    }
  });
});

describe('fork', () => {
  test('derives an independent stream from the parent seed', () => {
    const parent = createRng(42);
    const a = parent.fork('flies');
    const b = parent.fork('flies');
    expect(take(a, 10)).toEqual(take(b, 10));
    expect(a.seed).toBe(hashSeed(42, 'flies'));
  });

  test('different labels give different streams', () => {
    const parent = createRng(42);
    expect(take(parent.fork('flies'), 10)).not.toEqual(
      take(parent.fork('mutation'), 10),
    );
    expect(take(parent.fork(0), 10)).not.toEqual(take(parent.fork(1), 10));
  });

  test('is independent of how far the parent has advanced', () => {
    const fresh = createRng(42);
    const advanced = createRng(42);
    for (let i = 0; i < 137; i++) advanced.next();
    expect(take(advanced.fork(3), 10)).toEqual(take(fresh.fork(3), 10));
  });

  test('forks of different parents differ', () => {
    expect(take(createRng(1).fork('x'), 10)).not.toEqual(
      take(createRng(2).fork('x'), 10),
    );
  });

  test('nests: hash(generationSeed, agentId) style derivation', () => {
    const generation = createRng(hashSeed(20260829, 'gen', 4));
    const agent = generation.fork(2);
    const again = createRng(hashSeed(20260829, 'gen', 4)).fork(2);
    expect(take(agent, 8)).toEqual(take(again, 8));
  });
});

describe('helpers', () => {
  test('range stays within bounds', () => {
    const rng = createRng(3);
    for (let i = 0; i < 1000; i++) {
      const v = rng.range(-2, 5);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(5);
    }
  });

  test('range with equal bounds is constant', () => {
    const rng = createRng(3);
    expect(rng.range(4, 4)).toBe(4);
  });

  test('int is inclusive on both ends and hits both', () => {
    const rng = createRng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(1, 3);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  test('int with a single value and with inverted bounds', () => {
    const rng = createRng(11);
    expect(rng.int(5, 5)).toBe(5);
    expect(rng.int(5, 4)).toBe(5);
  });

  test('chance approximates the requested probability', () => {
    const rng = createRng(2024);
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) if (rng.chance(0.25)) hits += 1;
    expect(hits / n).toBeGreaterThan(0.23);
    expect(hits / n).toBeLessThan(0.27);
  });

  test('chance is total at the extremes', () => {
    const rng = createRng(5);
    for (let i = 0; i < 200; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  test('sign returns +1/-1 about evenly', () => {
    const rng = createRng(8);
    let positive = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      const s = rng.sign();
      expect(Math.abs(s)).toBe(1);
      if (s === 1) positive += 1;
    }
    expect(positive / n).toBeGreaterThan(0.47);
    expect(positive / n).toBeLessThan(0.53);
  });

  test('pick returns members and covers the array', () => {
    const rng = createRng(13);
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(rng.pick(items));
    expect([...seen].sort()).toEqual(['a', 'b', 'c']);
  });

  test('pick throws on an empty array', () => {
    expect(() => createRng(1).pick([])).toThrow();
  });

  test('helpers draw from the same underlying stream', () => {
    const a = createRng(77);
    const b = createRng(77);
    const mixed = [
      a.next(),
      a.range(0, 10),
      a.int(0, 100),
      a.chance(0.5),
      a.sign(),
    ];
    const expected = [
      b.next(),
      b.range(0, 10),
      b.int(0, 100),
      b.chance(0.5),
      b.sign(),
    ];
    expect(mixed).toEqual(expected);
  });
});
