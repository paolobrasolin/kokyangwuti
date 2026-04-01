import type {
  Agent,
  EvolutionState,
  Genome,
  SilkProfile,
  SilkType,
  SimulationControls,
  SimulationState,
} from '../types';
import type { Config } from '../config';
import { createAgent, mutate } from './agents';
import { buildFrame, createWorld } from '../physics/world';

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
}

export function startGeneration(
  state: SimulationState,
  evolution: EvolutionState,
  controls: SimulationControls,
  config: Config,
): { generation: number; genome: Genome } {
  state.genTimer = 0;
  state.active = true;

  buildFrameWorld(state);

  state.agents = [];
  for (let i = 0; i < controls.targetPopulation; i++) {
    const genome = mutate(evolution.bestGenome);
    state.agents.push(createAgent(i, genome, state, config));
  }

  return { generation: evolution.generation, genome: evolution.bestGenome };
}

export function endGeneration(
  state: SimulationState,
  evolution: EvolutionState,
): { newBest: boolean; bestFitness: number; genome: Genome; bestAgent: Agent | null } {
  state.active = false;
  let best: Agent | undefined;
  let maxFit = -Infinity;

  state.agents.forEach((agent) => {
    let fitness = agent.energy + agent.score * 1500;
    if (!agent.alive) fitness = -1000 + agent.score * 500;
    if (fitness > maxFit) {
      maxFit = fitness;
      best = agent;
    }
  });

  let newBest = false;
  const currentBest = best ?? null;
  if (currentBest && maxFit > -500) {
    if (maxFit > evolution.bestFitness) {
      evolution.bestFitness = maxFit;
      newBest = true;
    }
    evolution.bestGenome = { ...currentBest.genome };
  }

  evolution.history.push({ generation: evolution.generation, genome: { ...evolution.bestGenome } });
  if (evolution.history.length > 160) evolution.history.shift();

  evolution.generation += 1;

  return {
    newBest,
    bestFitness: evolution.bestFitness,
    genome: evolution.bestGenome,
    bestAgent: currentBest,
  };
}
