// One seed, all its generations, no DOM and no clock: the loop the page's
// engine runs, minus the pacing. Shared by the single-thread runner and by the
// worker threads of the parallel one, so every run is exactly what the page
// would compute for that seed.
import { CONFIG } from '../src/config';
import { endGeneration, startGeneration } from '../src/simulation/lifecycle';
import {
  createEvolutionState,
  createSimulationState,
} from '../src/simulation/state';
import { updateTick } from '../src/simulation/update';
import type { Genome, SimulationControls } from '../src/types';

/** The app's tick. */
export const DT = 16;

export interface RunOptions {
  seed: number;
  generations: number;
  pop: number;
  width: number;
  height: number;
  flyRate: number;
}

export interface GenerationEvent {
  seed: number;
  generation: number;
  /** Best and mean normalised fitness of the generation. */
  best: number;
  mean: number;
  prey: number;
  ticks: number;
  ms: number;
}

export interface RunSummary {
  seed: number;
  generations: number;
  ticks: number;
  ms: number;
  /** All-time best normalised fitness of the run. */
  allTimeBest: number;
  lastBest: number;
  lastMean: number;
  /** Genome of the final generation's winner. */
  lastBestGenome: Genome;
}

export function runSeed(
  options: RunOptions,
  onGeneration?: (event: GenerationEvent) => void,
): RunSummary {
  const { seed, generations, pop } = options;
  const state = createSimulationState(options.width, options.height, seed);
  const evolution = createEvolutionState(seed, pop);
  const controls: SimulationControls = {
    flyRate: options.flyRate,
    targetPopulation: pop,
    immortality: false,
  };

  const start = performance.now();
  let ticks = 0;
  let lastBest = 0;
  let lastMean = 0;
  let lastBestGenome = evolution.bestGenome;

  for (let g = 0; g < generations; g++) {
    startGeneration(state, evolution, controls, CONFIG);
    const genStart = performance.now();
    let n = 0;
    while (state.genTimer < CONFIG.genDurationMs) {
      updateTick(state, controls, CONFIG, DT);
      n++;
      // Same early end as the page: nobody left alive after the first second.
      if (state.genTimer > 1000 && state.agents.every((a) => !a.alive)) break;
    }
    ticks += n;
    const report = endGeneration(state, evolution);
    lastBest = report.bestFitness;
    lastMean = report.meanFitness;
    lastBestGenome = report.genome;
    onGeneration?.({
      seed,
      generation: report.generation,
      best: report.bestFitness,
      mean: report.meanFitness,
      prey: report.preySpawned,
      ticks: n,
      ms: performance.now() - genStart,
    });
  }

  return {
    seed,
    generations,
    ticks,
    ms: performance.now() - start,
    allTimeBest: evolution.bestFitness,
    lastBest,
    lastMean,
    lastBestGenome,
  };
}
