import { describe, expect, test } from '@rstest/core';
import { CONFIG } from '../src/config';
import { hashSeed } from '../src/rng';
import { startGeneration } from '../src/simulation/lifecycle';
import {
  createEvolutionState,
  createSimulationState,
  generationSeedFor,
} from '../src/simulation/state';
import { updateTick } from '../src/simulation/update';
import type { SimulationControls, SimulationState } from '../src/types';

const WIDTH = 480;
const HEIGHT = 320;
const TICKS = 400;
const DT = 16;

function makeControls(targetPopulation = 4): SimulationControls {
  return {
    simSpeed: 1,
    flyRate: 0.3,
    targetPopulation,
    immortality: false,
  };
}

function bootstrap(seed: number, targetPopulation = 4) {
  const state = createSimulationState(WIDTH, HEIGHT, seed);
  const evolution = createEvolutionState();
  const controls = makeControls(targetPopulation);
  startGeneration(state, evolution, controls, CONFIG);
  return { state, evolution, controls };
}

/** Everything an observer could use to tell two runs apart. */
function snapshot(state: SimulationState) {
  return {
    genTimer: state.genTimer,
    globalTime: state.globalTime,
    nodes: state.world.nodes.length,
    springs: state.world.springs.length,
    threads: state.world.threads.length,
    nodePositions: state.world.nodes.map((n) => [n.x, n.y]),
    agents: state.agents.map((agent) => ({
      id: agent.id,
      x: agent.x,
      y: agent.y,
      energy: agent.energy,
      score: agent.score,
      alive: agent.alive,
      state: agent.state,
      direction: agent.direction,
      threads: agent.threadIds.length,
      genome: agent.genome,
      // Sensorimotor memory: discovered, so it has to replay identically too.
      silkMode: agent.silkMode,
      building: agent.building,
      heading: agent.heading,
      distanceSinceAttach: agent.distanceSinceAttach,
      homeNodeId: agent.homeNodeId,
      homeDegree: agent.homeDegree,
    })),
  };
}

function run(seed: number, ticks = TICKS, targetPopulation = 4) {
  const { state, controls } = bootstrap(seed, targetPopulation);
  for (let i = 0; i < ticks; i++) updateTick(state, controls, CONFIG, DT);
  return { state, result: snapshot(state) };
}

describe('stream derivation', () => {
  test('the generation seed is hash(rootSeed, "gen", generation)', () => {
    const { state } = bootstrap(4242);
    expect(state.seed).toBe(4242);
    expect(state.generationSeed).toBe(generationSeedFor(4242, 1));
    expect(state.generationSeed).toBe(hashSeed(4242, 'gen', 1));
    expect(state.rng.seed).toBe(state.generationSeed);
  });

  test('agents get hash(generationSeed, agentId) streams', () => {
    const { state } = bootstrap(4242);
    for (const agent of state.agents) {
      expect(agent.rng.seed).toBe(hashSeed(state.generationSeed, agent.id));
    }
    const seeds = new Set(state.agents.map((a) => a.rng.seed));
    expect(seeds.size).toBe(state.agents.length);
  });

  test('the prey stream does not depend on the population', () => {
    const small = bootstrap(4242, 2);
    const large = bootstrap(4242, 12);
    expect(small.state.flyRng.seed).toBe(large.state.flyRng.seed);
    expect(small.state.flyRng.next()).toBe(large.state.flyRng.next());
  });

  test('generations of one run get distinct seeds', () => {
    const seeds = new Set<number>();
    for (let generation = 1; generation <= 20; generation++) {
      seeds.add(generationSeedFor(999, generation));
    }
    expect(seeds.size).toBe(20);
  });
});

describe('end-to-end determinism', () => {
  test('the same seed replays identically', () => {
    const a = run(20260829);
    const b = run(20260829);
    expect(b.result).toEqual(a.result);
  });

  test('a different seed diverges', () => {
    const a = run(20260829);
    const b = run(11111);
    expect(b.result).not.toEqual(a.result);
  });

  test('generation setup (world + genomes) is reproducible on its own', () => {
    const a = bootstrap(777);
    const b = bootstrap(777);
    expect(snapshot(b.state)).toEqual(snapshot(a.state));
    expect(b.state.agents.map((x) => x.genome)).toEqual(
      a.state.agents.map((x) => x.genome),
    );
    expect(b.state.frameThreadIds).toEqual(a.state.frameThreadIds);
  });

  test('per-tick state stays finite (no NaN leaks into the sim)', () => {
    const { state } = run(20260829);
    for (const agent of state.agents) {
      expect(Number.isFinite(agent.x)).toBe(true);
      expect(Number.isFinite(agent.y)).toBe(true);
      expect(Number.isFinite(agent.energy)).toBe(true);
      for (const value of Object.values(agent.genome)) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
    for (const node of state.world.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  test('the run actually does something (agents build and spend energy)', () => {
    const { state, controls } = bootstrap(20260829);
    const initialEnergy = state.agents.map((a) => a.energy);
    for (let i = 0; i < TICKS; i++) updateTick(state, controls, CONFIG, DT);

    const built = state.agents.reduce((sum, a) => sum + a.threadIds.length, 0);
    expect(built).toBeGreaterThan(0);
    expect(state.world.springs.length).toBeGreaterThan(0);
    expect(state.agents.every((a, i) => a.energy !== initialEnergy[i])).toBe(
      true,
    );
  });

  test('cleanup bookkeeping lives on the state, not in module scope', () => {
    const first = bootstrap(31337);
    for (let i = 0; i < 30; i++)
      updateTick(first.state, first.controls, CONFIG, DT);
    expect(first.state.cleanupCounter).toBe(30);

    // A second, independent state starts its own counter.
    const second = bootstrap(31337);
    expect(second.state.cleanupCounter).toBe(0);
    for (let i = 0; i < 5; i++)
      updateTick(second.state, second.controls, CONFIG, DT);
    expect(second.state.cleanupCounter).toBe(5);
  });
});
