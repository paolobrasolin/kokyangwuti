/**
 * The page's frame loop. It never advances the simulation — the engine does
 * that on its own clock — it only asks for a picture (or just the numbers)
 * once per animation frame, and only after the previous answer has arrived.
 *
 * `requestAnimationFrame` stops while the tab is hidden, so a hidden page asks
 * for nothing and the simulation runs on undisturbed.
 */

import type { Engine } from './engine/client';
import type { RenderFrame } from './render/frame';
import type { UiStats } from './types';

export interface RenderLoopOptions {
  engine: Engine;
  /** Whether a render frame is wanted now; false asks for stats only. */
  wantsRender: () => boolean;
  onFrame: (stats: UiStats, frame: RenderFrame | null) => void;
  /** Stats refresh period while not rendering, ms. */
  statsIntervalMs?: number;
  /** Give up waiting for an answer after this long and ask again, ms. */
  timeoutMs?: number;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
}

export function startRenderLoop(options: RenderLoopOptions): void {
  const raf =
    options.requestAnimationFrame ??
    ((callback: FrameRequestCallback) => requestAnimationFrame(callback));
  const statsInterval = options.statsIntervalMs ?? 250;
  const timeout = options.timeoutMs ?? 2000;

  let pending = false;
  let requestedAt = 0;
  let lastStatsAt = Number.NEGATIVE_INFINITY;

  const frame = (now: number) => {
    if (pending && now - requestedAt > timeout) pending = false;
    if (!pending) {
      const render = options.wantsRender();
      if (render || now - lastStatsAt >= statsInterval) {
        pending = true;
        requestedAt = now;
        options.engine.requestFrame(render, (stats, picture) => {
          pending = false;
          lastStatsAt = now;
          options.onFrame(stats, picture);
        });
      }
    }
    raf(frame);
  };

  raf(frame);
}
