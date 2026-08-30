import { describe, expect, test } from '@rstest/core';
import { PHYSICS } from '../src/physics/config';
import { applyForceToSpring, stepPhysics } from '../src/physics/solver';
import type { PhysicsWorld } from '../src/physics/types';
import { addNode, addSpring, createWorld } from '../src/physics/world';

const ITERATIONS = PHYSICS.constraintIterations;

/** A world with no gravity and no global damping, so springs can be isolated. */
function quietWorld(): PhysicsWorld {
  const world = createWorld();
  world.gravity = 0;
  world.globalDamping = 0;
  return world;
}

function dist(world: PhysicsWorld, aId: number, bId: number): number {
  const a = world.nodeMap.get(aId);
  const b = world.nodeMap.get(bId);
  if (!a || !b) throw new Error('missing node');
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function link(
  world: PhysicsWorld,
  aId: number,
  bId: number,
  restLength: number,
  maxExtension = 1000,
) {
  return addSpring(
    world,
    aId,
    bId,
    restLength,
    1,
    0.1,
    maxExtension,
    0,
    'radial',
    0,
    '#fff',
  );
}

describe('stepPhysics — springs at rest', () => {
  test('a two-node spring at its rest length does not move', () => {
    const world = quietWorld();
    const a = addNode(world, 0, 0, false, 0);
    const b = addNode(world, 10, 0, false, 0);
    link(world, a.id, b.id, 10);

    for (let i = 0; i < 10; i++) stepPhysics(world, 16, ITERATIONS);

    expect(a.x).toBeCloseTo(0);
    expect(a.y).toBeCloseTo(0);
    expect(b.x).toBeCloseTo(10);
    expect(b.y).toBeCloseTo(0);
  });

  test('a spring between two pinned nodes never moves them', () => {
    const world = quietWorld();
    const a = addNode(world, 0, 0, true, -1);
    const b = addNode(world, 80, 0, true, -1);
    link(world, a.id, b.id, 10);

    for (let i = 0; i < 5; i++) stepPhysics(world, 16, ITERATIONS);

    expect(a.x).toBe(0);
    expect(b.x).toBe(80);
  });

  test('pinned nodes ignore gravity while free ones fall', () => {
    const world = createWorld();
    const pinned = addNode(world, 0, 0, true, -1);
    const free = addNode(world, 50, 0, false, 0);

    for (let i = 0; i < 5; i++) stepPhysics(world, 16, ITERATIONS);

    expect(pinned.y).toBe(0);
    expect(free.y).toBeGreaterThan(0);
  });
});

describe('stepPhysics — constraint relaxation', () => {
  test('a stretched spring pulls both free nodes together, symmetrically', () => {
    const world = quietWorld();
    const a = addNode(world, 0, 0, false, 0);
    const b = addNode(world, 20, 0, false, 0);
    link(world, a.id, b.id, 10);

    stepPhysics(world, 16, ITERATIONS);

    const d = dist(world, a.id, b.id);
    expect(d).toBeLessThan(20);
    expect(d).toBeGreaterThanOrEqual(10);
    // Equal masses: the midpoint stays put.
    expect((a.x + b.x) / 2).toBeCloseTo(10);
    expect(a.x).toBeGreaterThan(0);
    expect(b.x).toBeLessThan(20);
  });

  test('repeated steps settle at the rest length', () => {
    const world = quietWorld();
    const a = addNode(world, 0, 0, false, 0);
    const b = addNode(world, 40, 0, false, 0);
    link(world, a.id, b.id, 10);

    for (let i = 0; i < 60; i++) {
      stepPhysics(world, 16, ITERATIONS);
      expect(dist(world, a.id, b.id)).toBeLessThanOrEqual(40);
    }
    expect(dist(world, a.id, b.id)).toBeCloseTo(10, 1);
  });

  test('a compressed spring pushes nodes apart', () => {
    const world = quietWorld();
    const a = addNode(world, 0, 0, false, 0);
    const b = addNode(world, 4, 0, false, 0);
    link(world, a.id, b.id, 20);

    stepPhysics(world, 16, ITERATIONS);

    expect(dist(world, a.id, b.id)).toBeGreaterThan(4);
  });

  test('a pinned anchor stays put and only the free node is pulled in', () => {
    const world = quietWorld();
    const anchor = addNode(world, 0, 0, true, -1);
    const free = addNode(world, 30, 0, false, 0);
    link(world, anchor.id, free.id, 10);

    stepPhysics(world, 16, ITERATIONS);

    expect(anchor.x).toBe(0);
    expect(anchor.y).toBe(0);
    expect(free.x).toBeLessThan(30);
    expect(free.x).toBeGreaterThanOrEqual(10);
  });

  test('the heavier node of a pair moves less', () => {
    const world = quietWorld();
    const light = addNode(world, 0, 0, false, 0, 0.1);
    const heavy = addNode(world, 20, 0, false, 0, 10);
    link(world, light.id, heavy.id, 10);

    stepPhysics(world, 16, ITERATIONS);

    expect(Math.abs(light.x - 0)).toBeGreaterThan(Math.abs(heavy.x - 20));
  });
});

describe('stepPhysics — breaking', () => {
  test('a spring stretched past maxExtension breaks and stops acting', () => {
    const world = quietWorld();
    const a = addNode(world, 0, 0, false, 0);
    const b = addNode(world, 100, 0, false, 0);
    const spring = link(world, a.id, b.id, 10, 50);

    stepPhysics(world, 16, ITERATIONS);

    expect(spring.broken).toBe(true);
    expect(a.x).toBe(0);
    expect(b.x).toBe(100);
  });

  test('a spring within maxExtension survives', () => {
    const world = quietWorld();
    const a = addNode(world, 0, 0, false, 0);
    const b = addNode(world, 30, 0, false, 0);
    const spring = link(world, a.id, b.id, 10, 50);

    stepPhysics(world, 16, ITERATIONS);

    expect(spring.broken).toBe(false);
  });
});

describe('stepPhysics — damping and integration', () => {
  test('global damping bleeds off velocity', () => {
    const makeMoving = (damping: number) => {
      const world = createWorld();
      world.gravity = 0;
      world.globalDamping = damping;
      const node = addNode(world, 0, 0, false, 0);
      node.prevX = -1; // one unit of velocity per step, in +x
      return { world, node };
    };

    const undamped = makeMoving(0);
    const damped = makeMoving(0.2);
    for (let i = 0; i < 20; i++) {
      stepPhysics(undamped.world, 16, ITERATIONS);
      stepPhysics(damped.world, 16, ITERATIONS);
    }

    expect(undamped.node.x).toBeCloseTo(20);
    expect(damped.node.x).toBeLessThan(undamped.node.x);
    // Velocity decays geometrically, so the damped node converges.
    const damping = damped.node.x - damped.node.prevX;
    expect(Math.abs(damping)).toBeLessThan(0.02);
  });

  test('damping strictly reduces kinetic energy over time', () => {
    const kineticEnergyAfter = (globalDamping: number, steps: number) => {
      const world = createWorld();
      world.gravity = 0;
      world.globalDamping = globalDamping;
      const node = addNode(world, 0, 0, false, 0, 2);
      node.prevX = -3;
      node.prevY = -4; // speed 5
      for (let i = 0; i < steps; i++) stepPhysics(world, 16, ITERATIONS);
      const vx = node.x - node.prevX;
      const vy = node.y - node.prevY;
      return 0.5 * node.mass * (vx * vx + vy * vy);
    };

    expect(kineticEnergyAfter(0, 30)).toBeCloseTo(0.5 * 2 * 25);
    expect(kineticEnergyAfter(0.1, 30)).toBeLessThan(
      kineticEnergyAfter(0.1, 5),
    );
    expect(kineticEnergyAfter(0.1, 5)).toBeLessThan(kineticEnergyAfter(0, 5));
  });

  test('dt is capped at PHYSICS.maxDt', () => {
    const fall = (dt: number) => {
      const world = createWorld();
      const node = addNode(world, 0, 0, false, 0);
      stepPhysics(world, dt, ITERATIONS);
      return node.y;
    };

    expect(fall(5000)).toBeCloseTo(fall(PHYSICS.maxDt));
    expect(fall(16)).toBeLessThan(fall(PHYSICS.maxDt));
  });

  test('accumulators are cleared after each step', () => {
    const world = quietWorld();
    const a = addNode(world, 0, 0, false, 0);
    const b = addNode(world, 10, 0, false, 0);
    const spring = link(world, a.id, b.id, 10);

    applyForceToSpring(world, spring.id, 0.5, 100, 100);
    stepPhysics(world, 16, ITERATIONS);

    expect(a.accX).toBe(0);
    expect(a.accY).toBe(0);
    expect(b.accX).toBe(0);
    expect(b.accY).toBe(0);
  });
});

describe('applyForceToSpring', () => {
  test('splits the force between the endpoints by t, scaled by 1/mass', () => {
    const world = quietWorld();
    const a = addNode(world, 0, 0, false, 0, 0.1);
    const b = addNode(world, 10, 0, false, 0, 0.1);
    const spring = link(world, a.id, b.id, 10);

    applyForceToSpring(world, spring.id, 0.25, 4, 8);

    expect(a.accX).toBeCloseTo((4 * 0.75) / 0.1);
    expect(a.accY).toBeCloseTo((8 * 0.75) / 0.1);
    expect(b.accX).toBeCloseTo((4 * 0.25) / 0.1);
    expect(b.accY).toBeCloseTo((8 * 0.25) / 0.1);
  });

  test('gives the whole force to one end at t = 0', () => {
    const world = quietWorld();
    const a = addNode(world, 0, 0, false, 0, 1);
    const b = addNode(world, 10, 0, false, 0, 1);
    const spring = link(world, a.id, b.id, 10);

    applyForceToSpring(world, spring.id, 0, 0, 10);

    expect(a.accY).toBeCloseTo(10);
    expect(b.accY).toBeCloseTo(0);
  });

  test('pinned endpoints absorb nothing', () => {
    const world = quietWorld();
    const a = addNode(world, 0, 0, true, -1);
    const b = addNode(world, 10, 0, false, 0, 1);
    const spring = link(world, a.id, b.id, 10);

    applyForceToSpring(world, spring.id, 0.5, 0, 10);

    expect(a.accY).toBe(0);
    expect(b.accY).toBeCloseTo(5);
  });

  test('is a no-op for missing or broken springs', () => {
    const world = quietWorld();
    const a = addNode(world, 0, 0, false, 0, 1);
    const b = addNode(world, 10, 0, false, 0, 1);
    const spring = link(world, a.id, b.id, 10);
    spring.broken = true;

    applyForceToSpring(world, spring.id, 0.5, 0, 10);
    applyForceToSpring(world, 9999, 0.5, 0, 10);

    expect(a.accY).toBe(0);
    expect(b.accY).toBe(0);
  });
});
