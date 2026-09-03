// Headless generation runner (Node, no DOM). Usage:
//   node --import ./bench/register.mjs bench/run.ts --generations 5 --pop 8
import { CONFIG } from '../src/config';
import { endGeneration, startGeneration } from '../src/simulation/lifecycle';
import {
  createEvolutionState,
  createSimulationState,
} from '../src/simulation/state';
import { updateTick } from '../src/simulation/update';
import type { SimulationControls } from '../src/types';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

const generations = arg('generations', 3);
const pop = arg('pop', CONFIG.defaultPopulation);
const seed = arg('seed', CONFIG.defaultSeed);
const width = arg('width', 1280);
const height = arg('height', 720);
const flyRate = arg('flyRate', CONFIG.defaultFlyRate);
const DT = 16;

const state = createSimulationState(width, height, seed);
const evolution = createEvolutionState(seed, pop);
const controls = {
  flyRate,
  targetPopulation: pop,
  immortality: false,
} as SimulationControls;

const t0 = performance.now();
let ticks = 0;
for (let g = 0; g < generations; g++) {
  startGeneration(state, evolution, controls, CONFIG);
  const tg = performance.now();
  let n = 0;
  while (state.genTimer < CONFIG.genDurationMs) {
    updateTick(state, controls, CONFIG, DT);
    n++;
    if (state.genTimer > 1000 && state.agents.every((a) => !a.alive)) break;
  }
  ticks += n;
  const report = endGeneration(state, evolution);
  const ms = performance.now() - tg;
  const grid = state.world.grid;
  console.log(
    `gen ${report.generation}: best ${report.bestFitness.toFixed(0)} mean ${report.meanFitness.toFixed(0)} prey ${report.preySpawned} | ${n} ticks in ${ms.toFixed(0)} ms (${((n * DT) / ms).toFixed(1)}x) | grid rebuilds ${grid?.rebuilds ?? 0}, refiles ${grid?.refiles ?? 0}`,
  );
}
const total = performance.now() - t0;
console.log(
  `${ticks} ticks in ${total.toFixed(0)} ms => ${((ticks * DT) / total).toFixed(1)}x realtime`,
);
