import { BASE_GENOME, CONFIG } from '../config';
import { createWorld } from '../physics/world';
import { createRng, hashSeed } from '../rng';
import type { EvolutionState, SimulationState } from '../types';
import { initialPopulation } from './evolution';

/** Seed of the generation-`generation` streams for a run rooted at `seed`. */
export function generationSeedFor(seed: number, generation: number): number {
  return hashSeed(seed, 'gen', generation);
}

export function createSimulationState(
  width = 0,
  height = 0,
  seed: number = CONFIG.defaultSeed,
): SimulationState {
  const generationSeed = generationSeedFor(seed, 0);
  const rng = createRng(generationSeed);
  return {
    active: false,
    genTimer: 0,
    width,
    height,
    world: createWorld(),
    frameThreadIds: [],
    agents: [],
    globalTime: 0,
    seed,
    generationSeed,
    rng,
    flyRng: rng.fork('flies'),
    flies: [],
    nextFlyId: 0,
    fliesSpawned: 0,
    cleanupCounter: 0,
  };
}

/** Re-seed the per-generation streams. Called at the start of each generation. */
export function seedGeneration(
  state: SimulationState,
  generation: number,
): void {
  state.generationSeed = generationSeedFor(state.seed, generation);
  state.rng = createRng(state.generationSeed);
  state.flyRng = state.rng.fork('flies');
  state.flies = [];
  state.nextFlyId = 0;
  state.fliesSpawned = 0;
  state.cleanupCounter = 0;
}

export function resizeSimulation(
  state: SimulationState,
  width: number,
  height: number,
): void {
  state.width = width;
  state.height = height;
}

/**
 * The starting population is drawn from `hash(seed, 'init')`, a stream of its
 * own: the founders must not shift when anything else about the run changes.
 */
export function createEvolutionState(
  seed: number = CONFIG.defaultSeed,
  size: number = CONFIG.defaultPopulation,
): EvolutionState {
  return {
    generation: 1,
    bestFitness: -Infinity,
    bestGenome: { ...BASE_GENOME },
    population: initialPopulation(size, createRng(hashSeed(seed, 'init'))),
    lastFitness: [],
    fitnessHistory: [],
    history: [{ generation: 1, genome: { ...BASE_GENOME } }],
  };
}
