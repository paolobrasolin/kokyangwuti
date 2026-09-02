// Golden checksum of one full-physics generation. Optimizations that claim to
// be pure refactors must leave this hash unchanged.
//   npx rstest run --include "bench/**/golden.bench.ts" --testTimeout 600000 --disableConsoleIntercept
import { describe, test } from '@rstest/core';
import { CONFIG } from '../src/config';
import { startGeneration } from '../src/simulation/lifecycle';
import {
  createEvolutionState,
  createSimulationState,
} from '../src/simulation/state';
import { updateTick } from '../src/simulation/update';
import type { SimulationControls } from '../src/types';

function fnv(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

describe('golden', () => {
  for (const [pop, w, h, ticks] of [
    [8, 1280, 720, 3750],
    [4, 640, 480, 1500],
  ] as const) {
    test(`pop ${pop} ${w}x${h} ${ticks} ticks`, () => {
      const state = createSimulationState(w, h, 20260829);
      const evolution = createEvolutionState(20260829, pop);
      const ctl: SimulationControls = {
        flyRate: CONFIG.defaultFlyRate,
        targetPopulation: pop,
        immortality: false,
      };
      startGeneration(state, evolution, ctl, CONFIG);
      for (let i = 0; i < ticks; i++) updateTick(state, ctl, CONFIG, 16);
      const nodes = state.world.nodes.map((n) => [
        n.id,
        n.x,
        n.y,
        n.prevX,
        n.prevY,
        n.mass,
      ]);
      const springs = state.world.springs.map((s) => [
        s.id,
        s.nodeA,
        s.nodeB,
        s.broken,
        s.type,
      ]);
      const agents = state.agents.map((a) => [
        a.id,
        a.x,
        a.y,
        a.energy,
        a.score,
        a.alive,
        a.state,
        a.silkSpent,
        a.threadIds.length,
      ]);
      const flies = state.flies.map((f) => [f.id, f.x, f.y, f.nodeId]);
      console.log(
        `GOLDEN pop${pop} nodes=${fnv(JSON.stringify(nodes))} springs=${fnv(JSON.stringify(springs))} agents=${fnv(JSON.stringify(agents))} flies=${fnv(JSON.stringify(flies))} spawned=${state.fliesSpawned}`,
      );
    });
  }
});
