/**
 * Does selection have anything to select *on*?
 *
 * `evolution.test.ts` proves the breeding machinery is correct given fitnesses.
 * This file asks the prior question: in the real arena, does a better web
 * actually score better than a worse one? If it does not, the EA is a random
 * walk however well its tournaments are implemented.
 *
 * The measurement is a mirrored head-to-head. Two genomes share one arena on
 * alternating slots, and the assignment is then flipped and the arena re-run, so
 * the enormous slot-position advantage (where a spider starts decides how much
 * prey flies past it) cancels exactly instead of being averaged over. Arenas run
 * the real simulation — fixed 16 ms ticks, solver on — so every generation costs
 * seconds and this file lives in the slow suite (`npm run test:slow`).
 */

import { beforeAll, describe, expect, test } from '@rstest/core';
import { BASE_GENOME, CONFIG } from '../../src/config';
import { computeFitness } from '../../src/simulation/evolution';
import { startGeneration } from '../../src/simulation/lifecycle';
import {
  createEvolutionState,
  createSimulationState,
} from '../../src/simulation/state';
import { updateTick } from '../../src/simulation/update';
import type { Genome, SimulationControls } from '../../src/types';

const WIDTH = 1024;
const HEIGHT = 768;
const POPULATION = 8;
/** The app's tick. */
const DT = 16;
/** Ticks between yields to the event loop, so the runner's RPC stays alive. */
const YIELD_EVERY = 250;

const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const SEEDS = [4242, 31337];

interface Side {
  score: number;
  fitness: number;
}

/** One arena: genome `a` on the slots where `(i + flip) % 2 === 0`, `b` on the rest. */
async function arena(
  a: Genome,
  b: Genome,
  seed: number,
  flip: number,
): Promise<{ a: Side; b: Side }> {
  const state = createSimulationState(WIDTH, HEIGHT, seed);
  const evolution = createEvolutionState(seed, POPULATION);
  const controls: SimulationControls = {
    flyRate: CONFIG.defaultFlyRate,
    targetPopulation: POPULATION,
    immortality: false,
  };
  startGeneration(state, evolution, controls, CONFIG);

  state.agents.forEach((agent, index) => {
    agent.genome = { ...((index + flip) % 2 === 0 ? a : b) };
    agent.startEnergy = CONFIG.startingEnergy * agent.genome.bodyMass;
    agent.energy = agent.startEnergy;
  });

  let ticks = 0;
  while (state.genTimer < CONFIG.genDurationMs) {
    updateTick(state, controls, CONFIG, DT);
    if (state.agents.every((agent) => !agent.alive)) break;
    if (++ticks % YIELD_EVERY === 0) await breathe();
  }

  const sides: { a: Side; b: Side } = {
    a: { score: 0, fitness: 0 },
    b: { score: 0, fitness: 0 },
  };
  state.agents.forEach((agent, index) => {
    const side = (index + flip) % 2 === 0 ? sides.a : sides.b;
    side.score += agent.score;
    side.fitness += computeFitness(agent);
  });
  return sides;
}

type HeadToHead = { a: Side; b: Side; arenasWon: number; arenas: number };

/** Mirrored head-to-head over `SEEDS`: totals, plus arenas won on catches. */
async function headToHead(a: Genome, b: Genome): Promise<HeadToHead> {
  const totals: { a: Side; b: Side } = {
    a: { score: 0, fitness: 0 },
    b: { score: 0, fitness: 0 },
  };
  let arenasWon = 0;
  let arenas = 0;
  for (const seed of SEEDS) {
    for (const flip of [0, 1]) {
      const result = await arena(a, b, seed, flip);
      totals.a.score += result.a.score;
      totals.a.fitness += result.a.fitness;
      totals.b.score += result.b.score;
      totals.b.fitness += result.b.fitness;
      arenas += 1;
      if (result.a.score > result.b.score) arenasWon += 1;
    }
  }
  return { ...totals, arenasWon, arenas };
}

/** Every construction rule switched off: explores never, fills no gap, stops early. */
const INERT: Genome = {
  ...BASE_GENOME,
  exploreDropRate: 0,
  angleGapThreshold: 1.5,
  stopDensity: 1,
};

describe('the head-to-head design', () => {
  let mirror: HeadToHead;
  beforeAll(async () => {
    mirror = await headToHead(BASE_GENOME, BASE_GENOME);
  });

  test('mirroring cancels slot advantage exactly', () => {
    // With the same genome on both sides, every slot is counted once for each
    // side across the two flips, so any residual difference would be a bug in
    // the measurement rather than a difference between the genomes.
    expect(mirror.a.score).toBe(mirror.b.score);
    expect(mirror.a.fitness).toBeCloseTo(mirror.b.fitness, 6);
  });

  test('the arenas are not degenerate: prey is offered and taken', () => {
    expect(mirror.a.score).toBeGreaterThan(0);
  });
});

describe('selection has something to select on', () => {
  let result: HeadToHead;
  beforeAll(async () => {
    result = await headToHead(BASE_GENOME, INERT);
  });

  test('a spider that builds beats one that does not, in every arena', () => {
    expect(result.a.score).toBeGreaterThan(result.b.score * 3);
    expect(result.arenasWon).toBe(result.arenas);
  });

  test('fitness ranks them the same way the catches do', () => {
    expect(result.a.fitness).toBeGreaterThan(result.b.fitness);
  });
});

describe('the traits that were pinned now trade off', () => {
  test('body mass is a cost, not a free fitness bonus', async () => {
    // Birth energy is `startingEnergy * bodyMass`. Scoring the final balance
    // paid a heavy spider up to 1600 fitness for nothing; scoring the delta
    // leaves mass as what the physiology says it is — dearer to run.
    const heavy = await headToHead(
      { ...BASE_GENOME, bodyMass: 1.8 },
      BASE_GENOME,
    );
    expect(heavy.a.fitness).toBeLessThan(heavy.b.fitness);
  });

  test('a top-of-range gait is not a free lunch', async () => {
    // Crawling costs more per pixel at a faster gait, so covering more ground
    // has to pay for itself. Beyond the range ceiling it stops doing so.
    const sprinter = await headToHead(
      { ...BASE_GENOME, speed: 3 },
      BASE_GENOME,
    );
    expect(sprinter.a.score).toBeLessThan(sprinter.b.score);
  });
});
