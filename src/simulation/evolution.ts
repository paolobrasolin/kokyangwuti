/**
 * Population-based evolution.
 *
 * The unit of selection is a *population* of genomes that persists across
 * generations, not a single champion whose mutants get re-rolled every round.
 * One generation is: instantiate every genome as an agent, run them all in the
 * same arena against the same prey stream, score them, then breed the next
 * population from the scores.
 *
 * Breeding is deliberately plain and interpretable:
 *
 * - **elitism** — the top `ELITE_COUNT` genomes are copied through unchanged, so
 *   fitness can never go backwards by accident;
 * - **tournament selection** (`TOURNAMENT_SIZE` = 3) — cheap, rank-based, and
 *   indifferent to the absolute scale of the fitness numbers;
 * - **uniform crossover** — each field is taken from either parent with equal
 *   probability, since the genome's fields are independent rule parameters with
 *   no linkage worth preserving;
 * - **jitter mutation** — `mutate` from `agents.ts`, clamped to `GENOME_RANGES`.
 *
 * `evolvePopulation` is a pure function of (population, fitnesses, rng): given
 * the same generation seed it yields the same next population forever. All of
 * its randomness is drawn unconditionally (a tournament always draws
 * `TOURNAMENT_SIZE` indices, crossover always draws one number per field), so
 * the stream position never depends on the values being compared.
 */

import { BASE_GENOME, CONFIG, GENOME_RANGES } from '../config';
import type { PhysicsWorld } from '../physics/types';
import type { Rng } from '../rng';
import type { Agent, Genome, WebMetrics } from '../types';
import { mutate } from './agents';

/** Fixed field order, so every genome-wide loop consumes the rng identically. */
export const GENOME_KEYS = Object.keys(GENOME_RANGES) as Array<keyof Genome>;

/** Genomes copied through untouched each generation. */
export const ELITE_COUNT = 2;
/** Candidates drawn per tournament. */
export const TOURNAMENT_SIZE = 3;
/** Probability that uniform crossover takes a field from the first parent. */
export const CROSSOVER_BIAS = 0.5;

/** Fitness weights. Kept here so the shape of selection is one place. */
export const FITNESS = {
  /** Energy value of one fly caught, on top of the energy actually eaten. */
  scoreWeight: 1500,
  /** Starving to death costs this much. */
  deathPenalty: -1000,
  /** A dead spider still gets credit for what its web caught while it lived. */
  deadScoreWeight: 500,
} as const;

/** The part of an agent selection actually reads. */
export type FitnessInput = Pick<
  Agent,
  'alive' | 'energy' | 'startEnergy' | 'score'
>;

/**
 * Causal fitness: the energy the spider *earned* over the generation, plus the
 * value of the prey its web took. Death is punished but the catches still
 * count — a web that fed the spider until the silk bill came due is not the
 * same as a web that caught nothing.
 *
 * The energy term is a **delta from birth**, not the final balance. Birth energy
 * is `startingEnergy * bodyMass`, so scoring the balance paid up to 1600 free
 * fitness for the single act of being heavy — a loophole with no causal story
 * behind it, and one that selection found. Scoring the delta makes body mass
 * exactly what the physiology says it is: a cost (faster baseline drain, dearer
 * crawling, dearer draglines) that has to be earned back.
 */
export function computeFitness(agent: FitnessInput): number {
  if (!agent.alive)
    return FITNESS.deathPenalty + agent.score * FITNESS.deadScoreWeight;
  return agent.energy - agent.startEnergy + agent.score * FITNESS.scoreWeight;
}

/**
 * Prey supply one generation of `genDurationMs` at `defaultFlyRate` offers,
 * i.e. `genDurationMs / 16 * defaultFlyRate`. Normalised fitness is quoted at
 * this supply, so the numbers stay on the scale they had before normalisation.
 */
export const REFERENCE_PREY = Math.round(
  (CONFIG.genDurationMs / 16) * CONFIG.defaultFlyRate,
);

/**
 * Rescale a fitness to a fixed prey supply.
 *
 * Every spider in an arena competes for the *same* flies, and near enough all of
 * them get eaten, so raw fitness is pinned by how much prey the generation
 * happened to offer rather than by how good the webs were. That is harmless
 * within a generation — the ranking is untouched, because this is multiplication
 * by a positive constant — but it makes "best fitness of generation 3" and "best
 * fitness of generation 11" incomparable, which is exactly what the UI's
 * all-time-best readout and the fitness history claim to compare. So the
 * *reported and recorded* numbers are normalised; selection still reads the raw
 * ones.
 */
export function normalizeFitness(fitness: number, preySpawned: number): number {
  if (!Number.isFinite(fitness)) return fitness;
  const supply = Math.max(1, preySpawned);
  return (fitness * REFERENCE_PREY) / supply;
}

/** Non-finite scores must never poison a comparison; they simply rank last. */
function finiteFitness(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value)
    ? value
    : -Number.MAX_VALUE;
}

/** A genome drawn uniformly from `GENOME_RANGES`. */
export function randomGenome(rng: Rng): Genome {
  const genome = { ...BASE_GENOME };
  for (const key of GENOME_KEYS) {
    const [min, max] = GENOME_RANGES[key];
    genome[key] = rng.range(min, max);
  }
  return genome;
}

/**
 * Generation 0: the hand-tuned base genome plus uniformly random individuals.
 * The base genome is kept so the run always has one member known to build
 * *something*; the rest are there to spread the population over the space.
 */
export function initialPopulation(size: number, rng: Rng): Genome[] {
  const count = Math.max(1, Math.round(size));
  const population: Genome[] = [{ ...BASE_GENOME }];
  while (population.length < count) population.push(randomGenome(rng));
  return population.slice(0, count);
}

/**
 * Fit a population to a new size (the UI can move the population slider between
 * generations). Shrinking keeps the head of the array, which holds the elites;
 * growing fills with mutants of the existing members.
 */
export function resizePopulation(
  population: readonly Genome[],
  size: number,
  rng: Rng,
): Genome[] {
  const count = Math.max(1, Math.round(size));
  if (population.length === 0) return initialPopulation(count, rng);

  const next = population.slice(0, count).map((genome) => ({ ...genome }));
  let source = 0;
  while (next.length < count) {
    next.push(mutate(population[source % population.length], rng));
    source++;
  }
  return next;
}

/** Indices of `population`, best fitness first; ties broken by index. */
export function rankedOrder(
  population: readonly Genome[],
  fitnesses: readonly number[],
): number[] {
  return population
    .map((_, index) => index)
    .sort((a, b) => {
      const fa = finiteFitness(fitnesses[a]);
      const fb = finiteFitness(fitnesses[b]);
      if (fb > fa) return 1;
      if (fb < fa) return -1;
      return a - b;
    });
}

/** Best of `TOURNAMENT_SIZE` uniformly drawn candidates. */
export function tournament(
  population: readonly Genome[],
  fitnesses: readonly number[],
  rng: Rng,
  size = TOURNAMENT_SIZE,
): Genome {
  const last = population.length - 1;
  let bestIndex = rng.int(0, last);
  let bestFitness = finiteFitness(fitnesses[bestIndex]);
  for (let i = 1; i < size; i++) {
    const candidate = rng.int(0, last);
    const fitness = finiteFitness(fitnesses[candidate]);
    if (fitness > bestFitness) {
      bestIndex = candidate;
      bestFitness = fitness;
    }
  }
  return population[bestIndex];
}

/** Uniform crossover: each field comes from either parent, 50/50. */
export function crossover(a: Genome, b: Genome, rng: Rng): Genome {
  const child = { ...a };
  for (const key of GENOME_KEYS) {
    if (!rng.chance(CROSSOVER_BIAS)) child[key] = b[key];
  }
  return child;
}

/**
 * One generational step. Pure: the output depends only on the population, the
 * fitnesses and the stream, so two runs with the same seed breed identically
 * forever.
 */
export function evolvePopulation(
  population: readonly Genome[],
  fitnesses: readonly number[],
  rng: Rng,
  targetSize: number = population.length,
): Genome[] {
  const count = Math.max(1, Math.round(targetSize));
  if (population.length === 0) return initialPopulation(count, rng);

  const order = rankedOrder(population, fitnesses);
  const elites = Math.min(ELITE_COUNT, count, population.length);

  const next: Genome[] = [];
  for (let i = 0; i < elites; i++) next.push({ ...population[order[i]] });
  while (next.length < count) {
    const parentA = tournament(population, fitnesses, rng);
    const parentB = tournament(population, fitnesses, rng);
    next.push(mutate(crossover(parentA, parentB, rng), rng));
  }
  return next;
}

/**
 * Read one agent's web off the world at the end of a generation. `silkSpent` is
 * the agent's own running total (it includes silk that has since torn), the
 * lengths are what is still standing. `preySpawned` normalises the reported
 * fitness onto the common scale (see `normalizeFitness`).
 */
export function measureWeb(
  world: PhysicsWorld,
  agent: Agent,
  preySpawned = REFERENCE_PREY,
): WebMetrics {
  let silkLength = 0;
  let captureLength = 0;

  for (const spring of world.springs) {
    if (spring.broken || spring.ownerAgentId !== agent.id) continue;
    const nodeA = world.nodeMap.get(spring.nodeA);
    const nodeB = world.nodeMap.get(spring.nodeB);
    if (!nodeA || !nodeB) continue;
    const length = Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);
    silkLength += length;
    if (spring.type === 'capture') captureLength += length;
  }

  return {
    agentId: agent.id,
    fitness: normalizeFitness(computeFitness(agent), preySpawned),
    alive: agent.alive,
    energy: agent.energy,
    fliesCaught: agent.score,
    threadCount: agent.threadIds.length,
    silkSpent: agent.silkSpent,
    silkLength,
    captureLength,
  };
}
