/**
 * The headless runner's core: one seed, its generations, a summary. The
 * parallel runner only spreads calls to this over worker threads, so what it
 * has to guarantee is that a seed means the same run wherever it is executed.
 */

import { describe, expect, test } from '@rstest/core';
import { runSeed } from '../bench/headless';

const OPTIONS = {
  generations: 1,
  pop: 2,
  width: 480,
  height: 320,
  flyRate: 0.1,
};

describe('runSeed', () => {
  test('reports every generation and a matching summary', () => {
    const events: number[] = [];
    const summary = runSeed({ ...OPTIONS, seed: 5 }, (e) =>
      events.push(e.ticks),
    );
    expect(events).toHaveLength(1);
    expect(summary.generations).toBe(1);
    expect(summary.ticks).toBe(events[0]);
    expect(summary.ticks).toBeGreaterThan(0);
    expect(Number.isFinite(summary.allTimeBest)).toBe(true);
    expect(Object.keys(summary.lastBestGenome)).toHaveLength(15);
  });

  test('the same seed is the same run', () => {
    const a = runSeed({ ...OPTIONS, seed: 5 });
    const b = runSeed({ ...OPTIONS, seed: 5 });
    const { ms: _a, ...restA } = a;
    const { ms: _b, ...restB } = b;
    expect(restB).toEqual(restA);
  });

  test('a different seed is a different run', () => {
    const a = runSeed({ ...OPTIONS, seed: 5 });
    const b = runSeed({ ...OPTIONS, seed: 6 });
    expect([b.allTimeBest, b.lastMean]).not.toEqual([
      a.allTimeBest,
      a.lastMean,
    ]);
  });
});
