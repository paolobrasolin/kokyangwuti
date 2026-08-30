import { describe, expect, test } from '@rstest/core';
import { addNode, addSpring, createWorld } from '../src/physics/world';
import {
  angularGaps,
  fillableGap,
  incidentDirections,
  localSilkDensity,
  MAX_FILL_GAP,
  nearestOwnSilk,
  normalizeAngle,
  senseAtNode,
  springStrain,
  structureDirection,
  TWO_PI,
} from '../src/simulation/senses';
import type { SilkType } from '../src/types';

const DEG = Math.PI / 180;

function silkWorld() {
  const world = createWorld();
  const link = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    owner: number,
    type: SilkType = 'radial',
    restLength?: number,
  ) => {
    const a = addNode(world, ax, ay, false, owner);
    const b = addNode(world, bx, by, false, owner);
    const len = Math.hypot(bx - ax, by - ay);
    return addSpring(
      world,
      a.id,
      b.id,
      restLength ?? len,
      1,
      0.1,
      len * 3,
      0,
      type,
      owner,
      '#fff',
    );
  };
  return { world, link };
}

describe('normalizeAngle', () => {
  test('wraps into [0, 2pi)', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(TWO_PI + 1)).toBeCloseTo(1);
    expect(normalizeAngle(-0.25)).toBeCloseTo(TWO_PI - 0.25);
  });
});

describe('angularGaps', () => {
  test('no threads: the whole circle is one gap', () => {
    expect(angularGaps([])).toEqual([{ bisector: 0, size: TWO_PI }]);
  });

  test('one thread: the gap is the full turn opposite it', () => {
    const [gap] = angularGaps([0]);
    expect(gap.size).toBeCloseTo(TWO_PI);
    expect(gap.bisector).toBeCloseTo(Math.PI);
  });

  test('four evenly spaced threads give four quarter-turn gaps', () => {
    const gaps = angularGaps([0, 90 * DEG, 180 * DEG, 270 * DEG]);
    expect(gaps).toHaveLength(4);
    for (const gap of gaps) expect(gap.size).toBeCloseTo(Math.PI / 2);
    const bisectors = gaps.map((g) => g.bisector).sort((a, b) => a - b);
    expect(bisectors[0]).toBeCloseTo(45 * DEG);
    expect(bisectors[3]).toBeCloseTo(315 * DEG);
  });

  test('gaps come back widest first, and the bisector splits the gap', () => {
    // Threads at 0, 10 and 100 degrees: gaps of 10, 90 and 260 degrees.
    const gaps = angularGaps([0, 10 * DEG, 100 * DEG]);
    expect(gaps.map((g) => g.size / DEG)).toEqual([
      expect.closeTo(260),
      expect.closeTo(90),
      expect.closeTo(10),
    ]);
    expect(gaps[0].bisector / DEG).toBeCloseTo(230);
    expect(gaps[1].bisector / DEG).toBeCloseTo(55);
    expect(gaps[2].bisector / DEG).toBeCloseTo(5);
  });

  test('two opposite threads split the circle in half', () => {
    const gaps = angularGaps([0, Math.PI]);
    expect(gaps).toHaveLength(2);
    for (const gap of gaps) expect(gap.size).toBeCloseTo(Math.PI);
  });

  test('is insensitive to the order and to full turns', () => {
    const a = angularGaps([0.4, 2.2, 5.0]);
    const b = angularGaps([5.0 + TWO_PI, 0.4 - TWO_PI, 2.2]);
    expect(b).toHaveLength(a.length);
    a.forEach((gap, i) => {
      expect(b[i].size).toBeCloseTo(gap.size);
      expect(b[i].bisector).toBeCloseTo(gap.bisector);
    });
  });

  test('duplicate directions collapse instead of yielding zero-width gaps', () => {
    const gaps = angularGaps([1, 1, 1]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].size).toBeCloseTo(TWO_PI);
  });

  test('gap sizes always sum to a full turn', () => {
    const gaps = angularGaps([0.1, 1.7, 2.9, 4.4, 5.9]);
    const total = gaps.reduce((sum, g) => sum + g.size, 0);
    expect(total).toBeCloseTo(TWO_PI);
  });
});

describe('fillableGap', () => {
  test('a gap wider than a half-turn is an open edge, not a gap to fill', () => {
    // A spider on a straight frame edge sees two half-turn gaps: neither is
    // bounded by threads, so it must not launch outward.
    expect(fillableGap(angularGaps([0, Math.PI]))).toBeNull();
    expect(fillableGap(angularGaps([0]))).toBeNull();
    expect(fillableGap(angularGaps([]))).toBeNull();
  });

  test('picks the widest bounded gap', () => {
    // Frame at 0 and pi plus one thread straight down: the upward half-turn is
    // rejected, the two quarter-turns below are fillable.
    const gaps = angularGaps([0, Math.PI, Math.PI / 2]);
    const gap = fillableGap(gaps);
    expect(gap).not.toBeNull();
    expect(gap?.size).toBeCloseTo(Math.PI / 2);
    expect(gap?.size).toBeLessThan(MAX_FILL_GAP);
  });
});

describe('incidentDirections', () => {
  test('reports the direction of every thread at a node and counts own silk', () => {
    const world = createWorld();
    const hub = addNode(world, 100, 100, false, 7);
    const east = addNode(world, 200, 100, false, 7);
    const south = addNode(world, 100, 200, false, -1);
    const mk = (b: number, owner: number) =>
      addSpring(world, hub.id, b, 100, 1, 0.1, 300, 0, 'radial', owner, '#fff');
    mk(east.id, 7);
    mk(south.id, -1);

    const { directions, ownDegree } = incidentDirections(world, hub.id, 7);
    expect(directions.map(normalizeAngle).sort((a, b) => a - b)).toEqual([
      expect.closeTo(0),
      expect.closeTo(Math.PI / 2),
    ]);
    expect(ownDegree).toBe(1);
    expect(incidentDirections(world, 999, 7).directions).toEqual([]);
  });
});

describe('localSilkDensity', () => {
  test('counts only the agent’s own silk within reach', () => {
    const { world, link } = silkWorld();
    link(0, 0, 70, 0, 1); // own, inside
    link(0, 500, 70, 500, 1); // own, far away
    link(0, 10, 70, 10, 2); // someone else's, inside

    // 70px of own silk within a 70px radius of the origin.
    expect(localSilkDensity(world, 0, 0, 1, 70)).toBeCloseTo(1);
    expect(localSilkDensity(world, 0, 0, 2, 70)).toBeCloseTo(1);
    expect(localSilkDensity(world, 0, 0, 3, 70)).toBe(0);
  });

  test('grows with the amount of silk crossing the sensed disc', () => {
    const { world, link } = silkWorld();
    const sparse = localSilkDensity(world, 0, 0, 1, 50);
    for (let i = 0; i < 6; i++) link(-40, i * 5, 40, i * 5, 1);
    const dense = localSilkDensity(world, 0, 0, 1, 50);
    expect(sparse).toBe(0);
    expect(dense).toBeGreaterThan(9);
  });
});

describe('nearestOwnSilk', () => {
  test('finds the closest own thread of a type and points at it', () => {
    const { world, link } = silkWorld();
    link(-100, 40, 100, 40, 1, 'capture');
    link(-100, -10, 100, -10, 1, 'radial');

    const cap = nearestOwnSilk(world, 0, 0, 1, 'capture');
    expect(cap.dist).toBeCloseTo(40);
    expect(cap.uy).toBeCloseTo(1);

    const rad = nearestOwnSilk(world, 0, 0, 1, 'radial');
    expect(rad.dist).toBeCloseTo(10);
    expect(rad.uy).toBeCloseTo(-1);
  });

  test('reports Infinity when nothing of that type is in range', () => {
    const { world, link } = silkWorld();
    link(-100, 400, 100, 400, 1, 'capture');
    expect(nearestOwnSilk(world, 0, 0, 1, 'capture', 100).dist).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(nearestOwnSilk(world, 0, 0, 2, 'capture').dist).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('structureDirection', () => {
  test('points toward nearby silk and ignores the substrate', () => {
    const { world, link } = silkWorld();
    link(40, -10, 40, 10, 5);
    const dir = structureDirection(world, 0, 0, 100);
    expect(dir.ux).toBeCloseTo(1);
    expect(dir.uy).toBeCloseTo(0);
  });

  test('is the zero vector when only the substrate is around', () => {
    const { world, link } = silkWorld();
    link(40, -10, 40, 10, -1, 'frame');
    expect(structureDirection(world, 0, 0, 100)).toEqual({ ux: 0, uy: 0 });
  });
});

describe('springStrain', () => {
  test('is zero at rest, positive when stretched', () => {
    const { world, link } = silkWorld();
    const relaxed = link(0, 0, 100, 0, 1, 'radial');
    const stretched = link(0, 50, 150, 50, 1, 'radial', 100);
    expect(springStrain(world, relaxed.id)).toBeCloseTo(0);
    expect(springStrain(world, stretched.id)).toBeCloseTo(0.5);
    expect(springStrain(world, 999)).toBeNull();
  });
});

describe('senseAtNode', () => {
  test('bundles degree, gaps and density for one junction', () => {
    const world = createWorld();
    const hub = addNode(world, 0, 0, false, 1);
    const mk = (x: number, y: number, owner: number) => {
      const n = addNode(world, x, y, false, owner);
      addSpring(
        world,
        hub.id,
        n.id,
        Math.hypot(x, y),
        1,
        0.1,
        999,
        0,
        'radial',
        owner,
        '#fff',
      );
    };
    mk(50, 0, 1);
    mk(-50, 0, -1);
    mk(0, 50, 1);

    const senses = senseAtNode(world, hub.id, 1, 70);
    expect(senses).not.toBeNull();
    expect(senses?.totalDegree).toBe(3);
    expect(senses?.ownDegree).toBe(2);
    // Threads east, west and south: the northern half-turn is not fillable.
    expect(senses?.gaps[0].size).toBeCloseTo(Math.PI);
    expect(senses?.fillableGap?.size).toBeCloseTo(Math.PI / 2);
    expect(senses?.density).toBeGreaterThan(0);
    expect(senseAtNode(world, 999, 1)).toBeNull();
  });
});
