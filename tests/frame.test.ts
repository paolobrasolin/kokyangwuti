/**
 * Render frames: the packed picture of the world that crosses from the
 * simulation thread to the page, and the renderer that draws it.
 */

import { describe, expect, test } from '@rstest/core';
import { CONFIG } from '../src/config';
import { markGeometryChanged } from '../src/physics/grid';
import { draw, drawIdle } from '../src/render/draw';
import {
  AGENT_STRIDE,
  buildRenderFrame,
  FLY_STRIDE,
  frameBuffers,
  MARK_STRIDE,
  SEGMENT_WIDTHS,
} from '../src/render/frame';
import { startGeneration } from '../src/simulation/lifecycle';
import {
  createEvolutionState,
  createSimulationState,
} from '../src/simulation/state';
import { updateTick } from '../src/simulation/update';
import type { SimulationControls } from '../src/types';

const WIDTH = 480;
const HEIGHT = 320;

function world(ticks: number) {
  const state = createSimulationState(WIDTH, HEIGHT, 20260829);
  const evolution = createEvolutionState(20260829, 4);
  const controls: SimulationControls = {
    flyRate: 0.5,
    targetPopulation: 4,
    immortality: false,
  };
  startGeneration(state, evolution, controls, CONFIG);
  for (let i = 0; i < ticks; i++) updateTick(state, controls, CONFIG, 16);
  return state;
}

/** A 2D context that records which methods were called. */
function recorder(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const target: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(target, {
    get(t, property) {
      if (property in t) return t[property];
      return (..._args: unknown[]) => {
        calls.push(String(property));
      };
    },
    set(t, property, value) {
      t[property] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('buildRenderFrame', () => {
  const state = world(500);
  const frame = buildRenderFrame(state);

  test('one segment per unbroken spring, four coordinates each', () => {
    const live = state.world.springs.filter((s) => !s.broken).length;
    expect(frame.segmentColor.length).toBe(live);
    expect(frame.segmentWidth.length).toBe(live);
    expect(frame.segments.length).toBe(live * 4);
  });

  test('segments carry their endpoints', () => {
    const first = state.world.springs.find((s) => !s.broken);
    expect(first).toBeDefined();
    if (!first) return;
    const { a, b } = first;
    expect(frame.segments[0]).toBeCloseTo(a.x, 3);
    expect(frame.segments[1]).toBeCloseTo(a.y, 3);
    expect(frame.segments[2]).toBeCloseTo(b.x, 3);
    expect(frame.segments[3]).toBeCloseTo(b.y, 3);
  });

  test('widths are by silk type and colours come through the palette', () => {
    let i = 0;
    for (const spring of state.world.springs) {
      if (spring.broken) continue;
      const expected =
        spring.type === 'capture' ? 0 : spring.type === 'frame' ? 2 : 1;
      expect(frame.segmentWidth[i]).toBe(expected);
      expect(SEGMENT_WIDTHS[frame.segmentWidth[i]]).toBeDefined();
      const color = frame.palette[frame.segmentColor[i]];
      expect(typeof color).toBe('string');
      i++;
    }
    expect(frame.palette).toContain('rgba(50,50,80,0.3)');
  });

  test('a thread near breaking is recoloured for stress', () => {
    const fresh = world(300);
    const spring = fresh.world.springs.find(
      (s) => !s.broken && s.ownerAgentId >= 0,
    );
    expect(spring).toBeDefined();
    if (!spring) return;
    const { a, b } = spring;
    // Stretch it to 95% of its breaking length. Hand-moving a node bypasses
    // the solver, so the spatial index has to be told.
    markGeometryChanged(fresh.world);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const target = spring.maxExtension * 0.95;
    b.x = a.x + ((b.x - a.x) / len) * target;
    b.y = a.y + ((b.y - a.y) / len) * target;
    const stressed = buildRenderFrame(fresh);
    const index = fresh.world.springs.filter((s) => !s.broken).indexOf(spring);
    const color = stressed.palette[stressed.segmentColor[index]];
    expect(color).not.toBe(spring.color);
    expect(color.startsWith('rgba(')).toBe(true);
  });

  test('flies, agents and markers use their strides', () => {
    expect(frame.flies.length).toBe(state.flies.length * FLY_STRIDE);
    const alive = state.agents.filter((a) => a.alive).length;
    expect(frame.agents.length).toBe(alive * AGENT_STRIDE);
    const marks = state.agents.reduce((n, a) => n + a.fliesCaught.length, 0);
    expect(frame.marks.length).toBe(marks * MARK_STRIDE);
    for (let o = 0; o < frame.agents.length; o += AGENT_STRIDE) {
      expect(frame.palette[frame.agents[o + 7]]).toMatch(/^hsl/);
      expect(frame.palette[frame.agents[o + 8]]).toMatch(/^hsla/);
    }
  });

  test('frame size and animation clock come along', () => {
    expect(frame.width).toBe(WIDTH);
    expect(frame.height).toBe(HEIGHT);
    expect(frame.globalTime).toBe(state.globalTime);
  });

  test('frameBuffers lists six distinct buffers to transfer', () => {
    const buffers = frameBuffers(frame);
    expect(buffers).toHaveLength(6);
    expect(new Set(buffers).size).toBe(6);
    for (const buffer of buffers) expect(buffer).toBeInstanceOf(ArrayBuffer);
  });
});

describe('draw', () => {
  test('strokes the web in batches rather than one spring at a time', () => {
    const frame = buildRenderFrame(world(500));
    const { ctx, calls } = recorder();
    draw(ctx, frame);
    const strokes = calls.filter((c) => c === 'stroke').length;
    const lines = calls.filter((c) => c === 'lineTo').length;
    expect(lines).toBeGreaterThanOrEqual(frame.segmentColor.length);
    // Every distinct (colour, width) pair is one stroke; spiders add a few.
    expect(strokes).toBeLessThan(frame.segmentColor.length / 4);
    expect(calls).toContain('fillRect');
  });

  test('an empty frame still paints the background', () => {
    const frame = buildRenderFrame(createSimulationState(WIDTH, HEIGHT, 1));
    const { ctx, calls } = recorder();
    draw(ctx, frame);
    expect(calls[0]).toBe('fillRect');
  });

  test('drawIdle writes its note', () => {
    const { ctx, calls } = recorder();
    drawIdle(ctx, WIDTH, HEIGHT, ['a', 'b']);
    expect(calls.filter((c) => c === 'fillText')).toHaveLength(2);
  });
});
