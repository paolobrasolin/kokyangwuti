// Headless throughput benchmark. Not part of `npm test`; run with
//   npx rstest run --include "bench/**/*.bench.ts" --testTimeout 600000 --disableConsoleIntercept
import { describe, test } from '@rstest/core';
import { CONFIG } from '../src/config';
import { PHYSICS } from '../src/physics/config';
import { stepPhysics } from '../src/physics/solver';
import { findNearestSpring, rayVsSprings } from '../src/physics/world';
import { startGeneration } from '../src/simulation/lifecycle';
import { localSilkDensity } from '../src/simulation/senses';
import {
  createEvolutionState,
  createSimulationState,
} from '../src/simulation/state';
import { updateTick } from '../src/simulation/update';
import type { SimulationControls } from '../src/types';

const WIDTH = 1280;
const HEIGHT = 720;
const SEED = 20260829;
const TICKS = Math.round(CONFIG.genDurationMs / 16); // one generation

function controls(pop: number): SimulationControls {
  return {
    flyRate: CONFIG.defaultFlyRate,
    targetPopulation: pop,
    immortality: false,
  };
}

describe('throughput', () => {
  for (const pop of [8, 24]) {
    test(`one generation, population ${pop}`, () => {
      const state = createSimulationState(WIDTH, HEIGHT, SEED);
      const evolution = createEvolutionState(SEED, pop);
      const ctl = controls(pop);
      startGeneration(state, evolution, ctl, CONFIG);
      const t0 = performance.now();
      for (let i = 0; i < TICKS; i++) updateTick(state, ctl, CONFIG, 16);
      const ms = performance.now() - t0;
      const ticksPerSec = (TICKS / ms) * 1000;
      const live = state.world.springs.filter((s) => !s.broken).length;
      console.log(
        `[pop ${pop}] ${TICKS} ticks in ${ms.toFixed(0)} ms => ${ticksPerSec.toFixed(0)} ticks/s = ${(ticksPerSec / 62.5).toFixed(1)}x realtime; springs=${live} nodes=${state.world.nodes.length} caught=${state.agents.reduce((s, a) => s + a.score, 0)}`,
      );

      // Micro-costs on the final world, to see where a tick goes.
      const w = state.world;
      let t = performance.now();
      for (let i = 0; i < 200; i++)
        stepPhysics(w, 16, PHYSICS.constraintIterations);
      console.log(
        `  stepPhysics x1: ${((performance.now() - t) / 200).toFixed(3)} ms`,
      );
      t = performance.now();
      // A fly's step: a few px, the way the simulation actually queries.
      for (let i = 0; i < 200; i++)
        rayVsSprings(w, 300 + i, 200 + i, 306 + i, 204 + i);
      console.log(
        `  rayVsSprings x1: ${((performance.now() - t) / 200).toFixed(3)} ms`,
      );
      t = performance.now();
      for (let i = 0; i < 200; i++) findNearestSpring(w, i, i, 0);
      console.log(
        `  findNearestSpring x1: ${((performance.now() - t) / 200).toFixed(3)} ms`,
      );
      t = performance.now();
      for (let i = 0; i < 200; i++) localSilkDensity(w, 400 + i, 300, 0);
      console.log(
        `  localSilkDensity x1: ${((performance.now() - t) / 200).toFixed(3)} ms`,
      );
    });
  }
});
