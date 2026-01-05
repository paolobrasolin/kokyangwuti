import type { Agent, EvolutionState, Genome, Line, SimulationControls, SimulationState } from '../types';
import type { Config } from '../config';
import { createAgent, mutate } from './agents';

export function buildFrameLines(width: number, height: number): Line[] {
  const frameColor = 'rgba(50,50,80,0.3)';
  return [
    { x1: 0, y1: 0, x2: width, y2: 0, id: 0, color: frameColor },
    { x1: width, y1: 0, x2: width, y2: height, id: 1, color: frameColor },
    { x1: width, y1: height, x2: 0, y2: height, id: 2, color: frameColor },
    { x1: 0, y1: height, x2: 0, y2: 0, id: 3, color: frameColor },
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
