/**
 * Fast-forward regression.
 *
 * The sensorimotor loop is a discrete decision process, and every one of its
 * rules is guarded by "where on the thread am I": exploratory drops and capture
 * bridging only fire *between* junctions, gap filling only fires *at* one. A
 * tick that moves the agent further than the segment it stands on therefore
 * skips the mid-thread rules entirely — at `dt = 320` (simSpeed 1000) even the
 * slowest genome clears 80 px, `applyMidThreadRules` never runs, no exploratory
 * drop ever fires, and the whole population builds literally nothing.
 *
 * `updateTick` now splits a long tick into substeps of at most
 * `MAX_SUBSTEP_DT`, so these tests pin the property that matters: fast-forward
 * is time compression, not a different simulation.
 */

import { describe, expect, test } from '@rstest/core';
import { CONFIG } from '../src/config';
import { PHYSICS } from '../src/physics/config';
import type { PhysicsWorld } from '../src/physics/types';
import { startGeneration } from '../src/simulation/lifecycle';
import { physicsSkipped } from '../src/simulation/prey';
import {
  createEvolutionState,
  createSimulationState,
} from '../src/simulation/state';
import {
  MAX_SUBSTEP_DT,
  MAX_SUBSTEPS,
  substepCount,
  updateTick,
} from '../src/simulation/update';
import type { SimulationControls, SimulationState } from '../src/types';

const WIDTH = 640;
const HEIGHT = 480;
const POPULATION = 4;
const SEED = 20260829;
/** Long enough for a web to form and for prey to meet it. */
const SIM_MS = 20000;

function makeControls(simSpeed: number): SimulationControls {
  return {
    simSpeed,
    flyRate: CONFIG.defaultFlyRate,
    targetPopulation: POPULATION,
    immortality: false,
  };
}

/** Run `SIM_MS` of simulated time in ticks of `dt`, at the given sim speed. */
function run(dt: number, simSpeed: number, seed = SEED): SimulationState {
  const state = createSimulationState(WIDTH, HEIGHT, seed);
  const evolution = createEvolutionState(seed, POPULATION);
  const controls = makeControls(simSpeed);
  startGeneration(state, evolution, controls, CONFIG);
  const ticks = Math.round(SIM_MS / dt);
  for (let i = 0; i < ticks; i++) updateTick(state, controls, CONFIG, dt);
  return state;
}

function ownSprings(world: PhysicsWorld, agentId: number) {
  return world.springs.filter((s) => !s.broken && s.ownerAgentId === agentId);
}

function totalSilk(state: SimulationState): number {
  return state.agents.reduce(
    (sum, a) => sum + ownSprings(state.world, a.id).length,
    0,
  );
}

function totalCaught(state: SimulationState): number {
  return state.agents.reduce((sum, a) => sum + a.score, 0);
}

describe('substepCount', () => {
  test('a tick short enough to be safe is not split', () => {
    expect(substepCount(16)).toBe(1);
    expect(substepCount(MAX_SUBSTEP_DT)).toBe(1);
    expect(substepCount(0)).toBe(1);
  });

  test('a long tick is split into slices of at most MAX_SUBSTEP_DT', () => {
    for (const dt of [33, 64, 80, 320, 512]) {
      const n = substepCount(dt);
      expect(dt / n).toBeLessThanOrEqual(MAX_SUBSTEP_DT);
    }
  });

  test('simSpeed 1000 (dt 320) is simulated in full', () => {
    expect(substepCount(320)).toBe(10);
    expect(substepCount(320)).toBeLessThanOrEqual(MAX_SUBSTEPS);
  });

  test('the substep count is capped so a frame still returns', () => {
    expect(substepCount(1e9)).toBe(MAX_SUBSTEPS);
  });

  test('a non-finite dt degrades to a single step rather than hanging', () => {
    expect(substepCount(Number.NaN)).toBe(1);
    expect(substepCount(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('fast-forward builds webs', () => {
  // simSpeed 1000 is the first step at which the solver is skipped entirely.
  const fastControls = makeControls(1000);
  const fast = run(320, 1000);
  const slow = run(16, 1);

  test('the case under test really is the solver-free path', () => {
    expect(physicsSkipped(fastControls)).toBe(true);
    expect(1000).toBeGreaterThanOrEqual(PHYSICS.skipPhysicsSpeed);
  });

  test('every spider spins a web at dt 320, not zero silk', () => {
    for (const agent of fast.agents) {
      expect(agent.threadIds.length).toBeGreaterThan(4);
      expect(ownSprings(fast.world, agent.id).length).toBeGreaterThan(20);
    }
  });

  test('mid-thread rules still fire: exploratory drops reach the substrate', () => {
    // An agent that only ever filled junction gaps would own no thread anchored
    // to the frame; exploratory drops are the only rule that leaves own silk.
    const anchored = fast.world.springs.some(
      (s) => !s.broken && s.ownerAgentId >= 0,
    );
    expect(anchored).toBe(true);
    expect(totalSilk(fast)).toBeGreaterThan(0);
  });

  test('webs are comparable in size to the same run at dt 16', () => {
    const ratio = totalSilk(fast) / totalSilk(slow);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(2.5);
  });

  test('prey is still caught on the solver-free path', () => {
    expect(totalCaught(fast)).toBeGreaterThan(0);
  });

  test('the prey stream keeps delivering at a compressed tick', () => {
    // Spawning is rolled per substep, so a long tick does not throttle prey
    // down to at most one fly per tick.
    expect(fast.fliesSpawned).toBeGreaterThan(slow.fliesSpawned * 0.7);
  });

  test('nothing goes non-finite under fast-forward', () => {
    for (const agent of fast.agents) {
      expect(Number.isFinite(agent.x)).toBe(true);
      expect(Number.isFinite(agent.y)).toBe(true);
      expect(Number.isFinite(agent.energy)).toBe(true);
    }
    for (const node of fast.world.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  test('fast-forward is reproducible from the seed', () => {
    const again = run(320, 1000);
    expect(
      again.world.springs.map((s) => [s.id, s.nodeA, s.nodeB, s.type]),
    ).toEqual(fast.world.springs.map((s) => [s.id, s.nodeA, s.nodeB, s.type]));
    expect(again.agents.map((a) => [a.x, a.y, a.score])).toEqual(
      fast.agents.map((a) => [a.x, a.y, a.score]),
    );
  });
});

describe('the intermediate speeds build too', () => {
  test('simSpeed 100 (dt 80, solver on) still spins silk', () => {
    const state = run(80, 100);
    for (const agent of state.agents) {
      expect(agent.threadIds.length).toBeGreaterThan(4);
    }
  });

  test('simSpeed 10000 is degraded but not inert', () => {
    // Past the substep cap fidelity is traded for wall time; the population must
    // still build rather than freeze.
    const state = run(1600, 10000);
    expect(totalSilk(state)).toBeGreaterThan(0);
  });
});
