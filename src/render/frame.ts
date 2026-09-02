/**
 * A render frame: everything the page needs to draw one picture of the world,
 * packed into flat typed arrays.
 *
 * The simulation normally runs in a Web Worker, so a frame has to cross a
 * thread boundary on every draw. Structured-cloning the physics world — some
 * thousands of node and spring objects plus their maps — would cost more per
 * frame than the drawing does. A handful of typed arrays is a few transfers of
 * ownership and no copying at all, and it gives the renderer a format it can
 * batch by colour instead of stroking one spring at a time.
 */

import type { SimulationState } from '../types';

export interface RenderFrame {
  width: number;
  height: number;
  /** Animation clock for wiggles and buzzes; not simulation time. */
  globalTime: number;
  /** Colour strings; segments and agents refer to them by index. */
  palette: string[];
  /** Per unbroken spring: x1, y1, x2, y2. */
  segments: Float32Array;
  /** Per spring: palette index. */
  segmentColor: Uint16Array;
  /** Per spring: index into `SEGMENT_WIDTHS`. */
  segmentWidth: Uint8Array;
  /** Per live fly, `FLY_STRIDE` wide: x, y, mass, id, stuck (0/1). */
  flies: Float32Array;
  /**
   * Per living agent, `AGENT_STRIDE` wide: x, y, heading angle, body scale,
   * falling (0/1), dragline start x, y, body colour, web colour, leg phase.
   */
  agents: Float32Array;
  /** Per eaten-fly marker, `MARK_STRIDE` wide: x, y, alpha. */
  marks: Float32Array;
}

export const SEGMENT_WIDTHS = [1, 1.5, 2] as const;
export const FLY_STRIDE = 5;
export const AGENT_STRIDE = 10;
export const MARK_STRIDE = 3;

/** Thread colour once it is stretched past 70% of its breaking length. */
const STRESS_LEVELS = 8;
const STRESS_COLORS = Array.from({ length: STRESS_LEVELS }, (_, k) => {
  const t = k / (STRESS_LEVELS - 1);
  const r = Math.max(Math.round(255 * t), 80);
  const g = Math.round(150 * t);
  const b = Math.round(40 * (1 - t));
  return `rgba(${r}, ${g}, ${b}, ${(0.4 + t * 0.4).toFixed(2)})`;
});

/** The buffers to hand to `postMessage` as transferables. */
export function frameBuffers(frame: RenderFrame): ArrayBuffer[] {
  return [
    frame.segments.buffer,
    frame.segmentColor.buffer,
    frame.segmentWidth.buffer,
    frame.flies.buffer,
    frame.agents.buffer,
    frame.marks.buffer,
  ] as ArrayBuffer[];
}

/** Read a frame off the live simulation state. Pure; allocates the arrays. */
export function buildRenderFrame(state: SimulationState): RenderFrame {
  const world = state.world;
  const palette: string[] = [];
  const paletteIndex = new Map<string, number>();
  const colorIndex = (color: string): number => {
    let index = paletteIndex.get(color);
    if (index === undefined) {
      index = palette.length;
      palette.push(color);
      paletteIndex.set(color, index);
    }
    return index;
  };

  // --- Silk and substrate ---
  let live = 0;
  for (const spring of world.springs) if (!spring.broken) live++;
  let segments = new Float32Array(live * 4);
  let segmentColor = new Uint16Array(live);
  let segmentWidth = new Uint8Array(live);
  let n = 0;
  for (const spring of world.springs) {
    if (spring.broken) continue;
    const a = world.nodeMap.get(spring.nodeA);
    const b = world.nodeMap.get(spring.nodeB);
    if (!a || !b) continue;
    const o = n * 4;
    segments[o] = a.x;
    segments[o + 1] = a.y;
    segments[o + 2] = b.x;
    segments[o + 3] = b.y;

    let color = spring.color;
    let width = 1;
    if (spring.type === 'frame') {
      width = 2;
    } else {
      if (spring.type === 'capture') width = 0;
      const ratio = Math.hypot(b.x - a.x, b.y - a.y) / spring.maxExtension;
      if (ratio > 0.7) {
        const level = Math.round(((ratio - 0.7) / 0.3) * (STRESS_LEVELS - 1));
        color = STRESS_COLORS[Math.min(STRESS_LEVELS - 1, level)];
      }
    }
    segmentColor[n] = colorIndex(color);
    segmentWidth[n] = width;
    n++;
  }
  if (n < live) {
    segments = segments.slice(0, n * 4);
    segmentColor = segmentColor.slice(0, n);
    segmentWidth = segmentWidth.slice(0, n);
  }

  // --- Prey ---
  const flies = new Float32Array(state.flies.length * FLY_STRIDE);
  state.flies.forEach((fly, i) => {
    const o = i * FLY_STRIDE;
    flies[o] = fly.x;
    flies[o + 1] = fly.y;
    flies[o + 2] = fly.mass;
    flies[o + 3] = fly.id;
    flies[o + 4] = fly.nodeId >= 0 ? 1 : 0;
  });

  // --- Spiders and what they ate ---
  let markCount = 0;
  let aliveCount = 0;
  for (const agent of state.agents) {
    markCount += agent.fliesCaught.length;
    if (agent.alive) aliveCount++;
  }
  const marks = new Float32Array(markCount * MARK_STRIDE);
  const agents = new Float32Array(aliveCount * AGENT_STRIDE);
  let m = 0;
  let k = 0;
  for (const agent of state.agents) {
    for (const eaten of agent.fliesCaught) {
      marks[m++] = eaten.x;
      marks[m++] = eaten.y;
      marks[m++] = Math.max(0, 1 - eaten.ageMs / 6000);
    }
    if (!agent.alive) continue;

    let angle = 0;
    if (agent.state === 'crawling') {
      const spring = world.springMap.get(agent.currentSpringId);
      const a = spring ? world.nodeMap.get(spring.nodeA) : undefined;
      const b = spring ? world.nodeMap.get(spring.nodeB) : undefined;
      if (a && b) angle = Math.atan2(b.y - a.y, b.x - a.x);
    } else {
      angle = Math.atan2(agent.vy, agent.vx);
    }
    const drop = agent.state === 'falling' ? agent.dropStartPos : null;

    const o = k * AGENT_STRIDE;
    agents[o] = agent.x;
    agents[o + 1] = agent.y;
    agents[o + 2] = angle;
    agents[o + 3] = Math.min(1.4, 0.7 + agent.genome.bodyMass * 0.4);
    agents[o + 4] = drop ? 1 : 0;
    agents[o + 5] = drop ? drop.x : 0;
    agents[o + 6] = drop ? drop.y : 0;
    agents[o + 7] = colorIndex(agent.color);
    agents[o + 8] = colorIndex(agent.webColor);
    agents[o + 9] = agent.legPhase;
    k++;
  }

  return {
    width: state.width,
    height: state.height,
    globalTime: state.globalTime,
    palette,
    segments,
    segmentColor,
    segmentWidth,
    flies,
    agents,
    marks,
  };
}
