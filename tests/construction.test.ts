import { describe, expect, test } from '@rstest/core';
import { BASE_GENOME, CONFIG } from '../src/config';
import type { PhysicsWorld } from '../src/physics/types';
import { startGeneration } from '../src/simulation/lifecycle';
import {
  createEvolutionState,
  createSimulationState,
} from '../src/simulation/state';
import { updateTick } from '../src/simulation/update';
import type {
  Genome,
  SilkType,
  SimulationControls,
  SimulationState,
} from '../src/types';

const WIDTH = 480;
const HEIGHT = 320;
const POPULATION = 4;
const TICKS = 1200;
const DT = 16;
const SEED = 20260829;

/**
 * Prey is switched off: these tests are about construction only, and a fly that
 * snaps a thread would turn a connectivity assertion into a coin flip.
 */
function makeControls(): SimulationControls {
  return {
    simSpeed: 1,
    flyRate: 0,
    targetPopulation: POPULATION,
    immortality: false,
  };
}

/**
 * Run one generation headlessly with a known genome for every agent (mutation
 * is undone on purpose so the assertions describe the genome under test).
 */
function build(genome: Genome, ticks = TICKS, seed = SEED): SimulationState {
  const state = createSimulationState(WIDTH, HEIGHT, seed);
  const evolution = createEvolutionState();
  evolution.bestGenome = genome;
  const controls = makeControls();
  startGeneration(state, evolution, controls, CONFIG);
  for (const agent of state.agents) agent.genome = { ...genome };
  for (let i = 0; i < ticks; i++) updateTick(state, controls, CONFIG, DT);
  return state;
}

function ownSprings(world: PhysicsWorld, agentId: number) {
  return world.springs.filter((s) => !s.broken && s.ownerAgentId === agentId);
}

function countSilk(
  world: PhysicsWorld,
  agentId: number,
  type: SilkType,
): number {
  return ownSprings(world, agentId).filter((s) => s.type === type).length;
}

/** Connected components of an agent's silk graph, over unbroken springs. */
function componentCount(world: PhysicsWorld, agentId: number): number {
  const springs = ownSprings(world, agentId);
  const adjacency = new Map<number, number[]>();
  for (const spring of springs) {
    for (const [a, b] of [
      [spring.nodeA, spring.nodeB],
      [spring.nodeB, spring.nodeA],
    ]) {
      const list = adjacency.get(a);
      if (list) list.push(b);
      else adjacency.set(a, [b]);
    }
  }
  let components = 0;
  const seen = new Set<number>();
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    components++;
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const node = stack.pop();
      if (node == null) continue;
      for (const next of adjacency.get(node) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return components;
}

/** Highest own-silk degree in the web: how hub-like it got. */
function maxDegree(world: PhysicsWorld, agentId: number): number {
  const degree = new Map<number, number>();
  let best = 0;
  for (const spring of ownSprings(world, agentId)) {
    for (const node of [spring.nodeA, spring.nodeB]) {
      const d = (degree.get(node) ?? 0) + 1;
      degree.set(node, d);
      if (d > best) best = d;
    }
  }
  return best;
}

/** Everything an observer could use to tell two construction runs apart. */
function geometryDigest(state: SimulationState) {
  return {
    springs: state.world.springs.map((s) => [
      s.id,
      s.nodeA,
      s.nodeB,
      s.type,
      s.ownerAgentId,
      s.broken,
    ]),
    nodes: state.world.nodes.map((n) => [n.id, n.x, n.y]),
    agents: state.agents.map((a) => [
      a.x,
      a.y,
      a.silkMode,
      a.building,
      a.homeNodeId,
      a.homeDegree,
      a.threadIds.length,
    ]),
  };
}

describe('emergent construction', () => {
  const state = build(BASE_GENOME);

  test('every spider spins a substantial web', () => {
    for (const agent of state.agents) {
      expect(agent.threadIds.length).toBeGreaterThan(8);
      expect(ownSprings(state.world, agent.id).length).toBeGreaterThan(40);
    }
  });

  test('each web is a single connected structure', () => {
    for (const agent of state.agents) {
      expect(componentCount(state.world, agent.id)).toBe(1);
    }
  });

  test('webs are more than a handful of threads: they have hubs', () => {
    for (const agent of state.agents) {
      // A tangle of independent draglines would peak at degree 2-3.
      expect(maxDegree(state.world, agent.id)).toBeGreaterThanOrEqual(5);
      expect(agent.homeNodeId).toBeGreaterThanOrEqual(0);
      expect(agent.homeDegree).toBeGreaterThanOrEqual(3);
    }
  });

  test('the default genome reaches capture mode and lays both silks', () => {
    for (const agent of state.agents) {
      expect(countSilk(state.world, agent.id, 'radial')).toBeGreaterThan(20);
      expect(countSilk(state.world, agent.id, 'capture')).toBeGreaterThan(0);
    }
  });

  test('nothing goes non-finite', () => {
    for (const agent of state.agents) {
      expect(Number.isFinite(agent.x)).toBe(true);
      expect(Number.isFinite(agent.y)).toBe(true);
      expect(Number.isFinite(agent.energy)).toBe(true);
      expect(Number.isFinite(agent.heading)).toBe(true);
      expect(Number.isFinite(agent.distanceSinceAttach)).toBe(true);
    }
    for (const node of state.world.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  test('construction is reproducible from the seed', () => {
    expect(geometryDigest(build(BASE_GENOME))).toEqual(geometryDigest(state));
  });
});

describe('the genome parameterizes rules, not shapes', () => {
  test('a low stopDensity halts building early and leaves a sparser web', () => {
    const totalSilk = (s: SimulationState) =>
      s.agents.reduce((sum, a) => sum + ownSprings(s.world, a.id).length, 0);
    const sparse = build({ ...BASE_GENOME, stopDensity: 1 });
    const normal = build(BASE_GENOME);
    expect(totalSilk(sparse)).toBeLessThan(totalSilk(normal) * 0.7);
  });

  test('a tighter angleGapThreshold packs more threads into a junction', () => {
    const tight = build({ ...BASE_GENOME, angleGapThreshold: 0.2 });
    const wide = build({ ...BASE_GENOME, angleGapThreshold: 1.5 });
    const peak = (s: SimulationState) =>
      Math.max(...s.agents.map((a) => maxDegree(s.world, a.id)));
    // Radial count is never encoded; it falls out of the gap threshold.
    expect(peak(tight)).toBeGreaterThan(peak(wide));
  });

  test('an agent that never explores and never fills gaps builds nothing', () => {
    const inert = build({
      ...BASE_GENOME,
      exploreDropRate: 0,
      angleGapThreshold: 1.5,
    });
    for (const agent of inert.agents) {
      expect(agent.threadIds.length).toBe(0);
      expect(ownSprings(inert.world, agent.id)).toHaveLength(0);
    }
  });
});
