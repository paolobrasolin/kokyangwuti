import type {
  Agent,
  EvolutionState,
  Genome,
  Line,
  SilkProfile,
  SilkType,
  SimulationControls,
  SimulationState,
} from '../types';
import type { Config } from '../config';
import { createAgent, mutate } from './agents';

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

export function buildFrameLines(width: number, height: number): Line[] {
  const frameColor = 'rgba(50,50,80,0.3)';
  return [
    { ...getSilkProfile('frame'), x1: 0, y1: 0, x2: width, y2: 0, id: 0, color: frameColor, type: 'frame' },
    {
      ...getSilkProfile('frame'),
      x1: width,
      y1: 0,
      x2: width,
      y2: height,
      id: 1,
      color: frameColor,
      type: 'frame',
    },
    {
      ...getSilkProfile('frame'),
      x1: width,
      y1: height,
      x2: 0,
      y2: height,
      id: 2,
      color: frameColor,
      type: 'frame',
    },
    {
      ...getSilkProfile('frame'),
      x1: 0,
      y1: height,
      x2: 0,
      y2: 0,
      id: 3,
      color: frameColor,
      type: 'frame',
    },
  ];
}

export function startGeneration(
  state: SimulationState,
  evolution: EvolutionState,
  controls: SimulationControls,
  config: Config,
): { generation: number; genome: Genome } {
  state.genTimer = 0;
  state.active = true;
  state.frameLines = buildFrameLines(state.width, state.height);

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

  evolution.generation += 1;

  return {
    newBest,
    bestFitness: evolution.bestFitness,
    genome: evolution.bestGenome,
    bestAgent: currentBest,
  };
}
