import type { Config } from '../config';
import { buildBranches, buildFrame, createWorld } from '../physics/world';
import type {
  Agent,
  EvolutionState,
  Genome,
  SilkProfile,
  SilkType,
  SimulationControls,
  SimulationState,
  WebMetrics,
} from '../types';
import { createAgent } from './agents';
import {
  computeFitness,
  evolvePopulation,
  measureWeb,
  normalizeFitness,
  resizePopulation,
} from './evolution';
import { seedGeneration } from './state';

const SILK_PROFILES: Record<SilkType, SilkProfile> = {
  frame: {
    strength: 1.0,
    extensibility: 0.25,
    damping: 0.15,
    adhesion: 0,
    tension: 0.35,
  },
  radial: {
    strength: 0.92,
    extensibility: 0.35,
    damping: 0.22,
    adhesion: 0.05,
    tension: 0.3,
  },
  capture: {
    strength: 0.45,
    extensibility: 1.0,
    damping: 0.75,
    adhesion: 0.9,
    tension: 0.2,
  },
};

export function getSilkProfile(type: SilkType): SilkProfile {
  return { ...SILK_PROFILES[type] };
}

export function buildFrameWorld(state: SimulationState): void {
  state.world = createWorld();
  state.frameThreadIds = buildFrame(state.world, state.width, state.height);
  // Add tree branches as additional anchor structures. A dedicated fork keeps
  // the branch layout stable for a generation even across resizes/rebuilds.
  const branchThreadIds = buildBranches(
    state.world,
    state.width,
    state.height,
    state.rng.fork('world'),
  );
  state.frameThreadIds.push(...branchThreadIds);
}

/** Snapshots kept for the genome chart. */
const HISTORY_LIMIT = 160;

/**
 * Instantiate the persistent population in a fresh arena.
 *
 * Agents are always constructed from scratch: an `Agent` carries world node ids
 * (`homeNodeId`, `currentSpringId`) that mean nothing once the world is rebuilt,
 * so only the *genome* survives a generation boundary.
 */
export function startGeneration(
  state: SimulationState,
  evolution: EvolutionState,
  controls: SimulationControls,
  config: Config,
): { generation: number; genome: Genome; population: Genome[] } {
  state.genTimer = 0;
  state.active = true;

  seedGeneration(state, evolution.generation);
  buildFrameWorld(state);

  // The population slider may have moved since the last generation.
  evolution.population = resizePopulation(
    evolution.population,
    controls.targetPopulation,
    state.rng.fork('resize'),
  );

  state.agents = evolution.population.map((genome, index) =>
    createAgent(index, { ...genome }, state, config),
  );

  return {
    generation: evolution.generation,
    genome: evolution.bestGenome,
    population: evolution.population,
  };
}

export interface GenerationReport {
  generation: number;
  /** True when this generation beat the all-time best fitness. */
  newBest: boolean;
  /** Best fitness of this generation, normalised by prey supply. */
  bestFitness: number;
  /** Mean fitness of this generation, normalised by prey supply. */
  meanFitness: number;
  /** All-time best normalised fitness of the run. */
  allTimeBest: number;
  /** Flies the prey stream offered this generation — the fitness denominator. */
  preySpawned: number;
  /** Best genome of this generation. */
  genome: Genome;
  bestAgent: Agent | null;
  /** Web metrics of every agent, index-aligned with the evaluated population. */
  metrics: WebMetrics[];
  /** Metrics of `bestAgent`. */
  bestMetrics: WebMetrics | null;
}

/**
 * Score the generation, record it, and breed the next population.
 *
 * The population that gets bred is exactly the set of genomes that were
 * evaluated (`state.agents.map(a => a.genome)`), so fitness and genome can never
 * drift out of alignment. Selection draws from `hash(generationSeed,
 * 'selection')`, which makes the next population a pure function of the run seed
 * and the generation number.
 */
export function endGeneration(
  state: SimulationState,
  evolution: EvolutionState,
): GenerationReport {
  state.active = false;

  const preySpawned = state.fliesSpawned;
  const evaluated = state.agents.map((agent) => ({ ...agent.genome }));
  // Selection reads raw fitness (one arena, one prey stream, so the denominator
  // is shared); everything reported or recorded is normalised so that numbers
  // from different generations mean the same thing.
  const fitnesses = state.agents.map(computeFitness);
  const scored = fitnesses.map((fitness) =>
    normalizeFitness(fitness, preySpawned),
  );
  const metrics = state.agents.map((agent) =>
    measureWeb(state.world, agent, preySpawned),
  );

  let bestIndex = -1;
  let bestFitness = Number.NEGATIVE_INFINITY;
  let total = 0;
  scored.forEach((fitness, index) => {
    total += fitness;
    if (fitness > bestFitness) {
      bestFitness = fitness;
      bestIndex = index;
    }
  });

  const meanFitness = scored.length > 0 ? total / scored.length : 0;
  const bestAgent = bestIndex >= 0 ? state.agents[bestIndex] : null;
  const genome = bestAgent
    ? { ...bestAgent.genome }
    : { ...evolution.bestGenome };

  let newBest = false;
  if (bestAgent && bestFitness > evolution.bestFitness) {
    evolution.bestFitness = bestFitness;
    evolution.bestGenome = genome;
    newBest = true;
  }

  evolution.lastFitness = scored;
  evolution.fitnessHistory.push({
    generation: evolution.generation,
    best: bestIndex >= 0 ? bestFitness : 0,
    mean: meanFitness,
  });
  if (evolution.fitnessHistory.length > HISTORY_LIMIT)
    evolution.fitnessHistory.shift();

  // The chart tracks the lineage, so it plots this generation's winner rather
  // than the frozen all-time champion.
  evolution.history.push({ generation: evolution.generation, genome });
  if (evolution.history.length > HISTORY_LIMIT) evolution.history.shift();

  if (evaluated.length > 0) {
    evolution.population = evolvePopulation(
      evaluated,
      fitnesses,
      state.rng.fork('selection'),
    );
  }

  evolution.generation += 1;

  return {
    generation: evolution.generation - 1,
    newBest,
    bestFitness: bestIndex >= 0 ? bestFitness : 0,
    meanFitness,
    allTimeBest: evolution.bestFitness,
    preySpawned,
    genome,
    bestAgent,
    metrics,
    bestMetrics: bestIndex >= 0 ? metrics[bestIndex] : null,
  };
}
