import type { EvolutionState, SimulationState } from '../types';
import { BASE_GENOME } from '../config';
import { createWorld } from '../physics/world';

export function createSimulationState(width = 0, height = 0): SimulationState {
  return {
    active: false,
    genTimer: 0,
    width,
    height,
    world: createWorld(),
    frameThreadIds: [],
    agents: [],
    globalTime: 0,
  };
}

export function resizeSimulation(state: SimulationState, width: number, height: number): void {
  state.width = width;
  state.height = height;
}

export function createEvolutionState(): EvolutionState {
  return {
    generation: 1,
    bestFitness: -Infinity,
    bestGenome: { ...BASE_GENOME },
    history: [{ generation: 1, genome: { ...BASE_GENOME } }],
  };
}
