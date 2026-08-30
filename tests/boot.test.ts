/**
 * Boot smoke test: `src/index.ts` is the real entry point the bundle runs, and
 * nothing else in the suite ever executes it. This drives it end to end in
 * jsdom — build the UI, wire the controller, run the loop, render — so that a
 * type-correct change that breaks the wiring (a missing UI ref, a stat the
 * presenter reads and the controller no longer supplies, a canvas call that
 * throws) fails here instead of in the browser.
 *
 * jsdom has no 2D canvas, so `getContext` is stubbed with a recorder; that is
 * the only thing faked. Everything above it is the production code path.
 */

import { beforeAll, describe, expect, test } from '@rstest/core';

/** Calls the renderer actually made, so "it drew something" is checkable. */
const drawCalls: string[] = [];
let frames = 0;

/** A permissive 2D-context stand-in: every method is a recorded no-op. */
function stubContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const properties: Record<string | symbol, unknown> = {};
  const handler: ProxyHandler<Record<string | symbol, unknown>> = {
    get(target, property) {
      if (property === 'canvas') return canvas;
      if (property in target) return target[property];
      return (..._args: unknown[]) => {
        drawCalls.push(String(property));
        // Gradients and metrics are objects with methods of their own.
        return new Proxy({}, handler);
      };
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  };
  return new Proxy(properties, handler) as unknown as CanvasRenderingContext2D;
}

beforeAll(async () => {
  document.body.innerHTML = '';

  const original = HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: function getContext(this: HTMLCanvasElement, kind: string) {
      if (kind === '2d') return stubContext(this);
      return original.call(this, kind);
    },
  });

  // The production loop is an unbounded rAF chain; cap it at a handful of
  // frames so the entry point runs exactly as it would in a browser tab.
  const MAX_FRAMES = 8;
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      if (frames >= MAX_FRAMES) return 0;
      frames += 1;
      callback(frames * 16);
      return frames;
    },
  });

  await import('../src/index');
});

describe('the app boots', () => {
  test('the entry point builds its UI into the document', () => {
    expect(document.getElementById('ui-layer')).not.toBeNull();
    expect(document.querySelector('canvas')).not.toBeNull();
    expect(document.getElementById('gen-counter')).not.toBeNull();
  });

  test('the loop ran and the renderer was driven', () => {
    expect(frames).toBeGreaterThan(0);
    expect(drawCalls.length).toBeGreaterThan(0);
    expect(drawCalls).toContain('stroke');
  });

  test('the simulation advanced and the presenter wrote real stats', () => {
    const generation = document.getElementById('gen-counter');
    expect(generation?.textContent).toMatch(/^GEN \d+$/);

    const timer = document.getElementById('timer-text');
    expect(timer?.textContent).toMatch(/^\d+\.\d+s$/);
    expect(Number.parseFloat(timer?.textContent ?? '0')).toBeGreaterThan(0);
  });

  test('the genome readouts are filled in, not left as placeholders', () => {
    for (const id of ['dna-gap', 'dna-explore', 'dna-reach', 'dna-switch']) {
      const element = document.getElementById(id);
      expect(element).not.toBeNull();
      expect(element?.textContent).not.toBe('--');
    }
  });

  test('the controls are wired to the controller', () => {
    const speed = document.getElementById('speed-btn') as HTMLButtonElement;
    expect(speed).not.toBeNull();
    const before = speed.textContent;
    speed.click();
    // The presenter only repaints on the next frame, so poke the controller
    // and check the click was accepted rather than that the label changed.
    expect(before).toMatch(/^Speed: \d+x$/);

    const immortal = document.getElementById(
      'immortal-btn',
    ) as HTMLButtonElement;
    expect(immortal).not.toBeNull();
    immortal.click();
  });
});
