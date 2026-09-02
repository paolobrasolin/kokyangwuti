/**
 * Long-tick regression.
 *
 * The sensorimotor loop is a discrete decision process, and every one of its
 * rules is guarded by "where on the thread am I": exploratory drops and capture
 * bridging only fire *between* junctions, gap filling only fires *at* one. A
 * tick that moves the agent further than the segment it stands on therefore
 * skips the mid-thread rules entirely — at `dt = 320` even the slowest genome
 * clears 80 px, `applyMidThreadRules` never runs, no exploratory drop ever
 * fires, and the whole population builds literally nothing.
 *
 * The app never produces such a tick any more (its scheduler always steps by
 * `TICK_MS`; see `tests/engine.test.ts`), but `updateTick` still splits a long
 * `dt` into substeps of at most `MAX_SUBSTEP_DT`, so any other caller gets time
 * compression rather than a different simulation. These tests pin that.
 */

import { describe, expect, test } from '@rstest/core';
import { CONFIG } from '../src/config';
import type { PhysicsWorld } from '../src/physics/types';
import { startGeneration } from '../src/simulation/lifecycle';
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

function makeControls(): SimulationControls {
  return {
    flyRate: CONFIG.defaultFlyRate,
    targetPopulation: POPULATION,
    immortality: false,
  };
}

/** Run `SIM_MS` of simulated time in ticks of `dt`. */
function run(dt: number, seed = SEED): SimulationState {
  const state = createSimulationState(WIDTH, HEIGHT, seed);
  const evolution = createEvolutionState(seed, POPULATION);
  const controls = makeControls();
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

  test('dt 320 is simulated in full', () => {
    expect(substepCount(320)).toBe(10);
    expect(substepCount(320)).toBeLessThanOrEqual(MAX_SUBSTEPS);
  });

  test('the substep count is capped so a tick still returns', () => {
    expect(substepCount(1e9)).toBe(MAX_SUBSTEPS);
  });

  test('a non-finite dt degrades to a single step rather than hanging', () => {
    expect(substepCount(Number.NaN)).toBe(1);
    expect(substepCount(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('a long tick is a shorter tick repeated', () => {
  const long = run(320);
  const short = run(16);

  test('every spider spins a web at dt 320, not zero silk', () => {
    for (const agent of long.agents) {
      expect(agent.threadIds.length).toBeGreaterThan(4);
      expect(ownSprings(long.world, agent.id).length).toBeGreaterThan(20);
    }
  });

  test('mid-thread rules still fire: exploratory drops reach the substrate', () => {
    const anchored = long.world.springs.some(
      (s) => !s.broken && s.ownerAgentId >= 0,
    );
    expect(anchored).toBe(true);
  });

  test('webs are comparable in size to the same run at dt 16', () => {
    const ratio = totalSilk(long) / totalSilk(short);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(2.5);
  });

  test('prey is still caught, by the solver, at a long tick', () => {
    expect(totalCaught(long)).toBeGreaterThan(0);
  });

  test('the prey stream keeps delivering at a compressed tick', () => {
    expect(long.fliesSpawned).toBeGreaterThan(short.fliesSpawned * 0.7);
  });

  test('nothing goes non-finite', () => {
    for (const agent of long.agents) {
      expect(Number.isFinite(agent.x)).toBe(true);
      expect(Number.isFinite(agent.y)).toBe(true);
      expect(Number.isFinite(agent.energy)).toBe(true);
    }
    for (const node of long.world.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  test('a long-tick run is reproducible from the seed', () => {
    const again = run(320);
    expect(
      again.world.springs.map((s) => [s.id, s.nodeA, s.nodeB, s.type]),
    ).toEqual(long.world.springs.map((s) => [s.id, s.nodeA, s.nodeB, s.type]));
    expect(again.agents.map((a) => [a.x, a.y, a.score])).toEqual(
      long.agents.map((a) => [a.x, a.y, a.score]),
    );
  });

  test('dt 80 spins silk too', () => {
    const state = run(80);
    for (const agent of state.agents) {
      expect(agent.threadIds.length).toBeGreaterThan(4);
    }
  });

  test('past the substep cap fidelity degrades, but the population is not inert', () => {
    const state = run(1600);
    expect(totalSilk(state)).toBeGreaterThan(0);
  });
});
