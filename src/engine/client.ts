/**
 * The page's handle on the simulation. Prefers a Web Worker — the simulation
 * then keeps running at full pace while the tab is hidden (`requestAnimationFrame`
 * pauses, worker timers do not) and never blocks the UI — and falls back to
 * hosting the simulation on the page thread where `Worker` is unavailable.
 * Either way the page talks the same `protocol`.
 */

import type { RenderFrame } from '../render/frame';
import type { LogType, UiStats } from '../types';
import { createWorkerHost, type Host } from './host';
import type { ControlsPatch, MainToWorker, WorkerToMain } from './protocol';

export type EngineKind = 'worker' | 'local';

export type FrameHandler = (stats: UiStats, frame: RenderFrame | null) => void;
export type LogHandler = (message: string, level: LogType) => void;

export interface Engine {
  readonly kind: EngineKind;
  setControls(patch: ControlsPatch): void;
  resize(width: number, height: number): void;
  /**
   * Ask for the current stats, and a render frame if `render` is set. Answers
   * arrive in request order. The caller is expected to wait for the answer
   * before asking again, which is what keeps a slow page from piling requests
   * onto a busy simulation.
   */
  requestFrame(render: boolean, onFrame: FrameHandler): void;
  onLog(handler: LogHandler): void;
  dispose(): void;
}

export interface EngineOptions {
  width: number;
  height: number;
  seed?: number;
  controls?: ControlsPatch;
  /** Force the in-page host even when `Worker` exists. */
  forceLocal?: boolean;
}

/** Turns a stream of `WorkerToMain` messages into engine callbacks. */
function createInbox() {
  const frameQueue: FrameHandler[] = [];
  let logHandler: LogHandler | null = null;
  return {
    frameQueue,
    setLog(handler: LogHandler) {
      logHandler = handler;
    },
    receive(message: WorkerToMain) {
      switch (message.type) {
        case 'ready':
          return;
        case 'log':
          logHandler?.(message.message, message.level);
          return;
        case 'frame': {
          const handler = frameQueue.shift();
          handler?.(message.stats, message.frame);
          return;
        }
      }
    },
  };
}

function initMessage(options: EngineOptions): MainToWorker {
  return {
    type: 'init',
    width: options.width,
    height: options.height,
    seed: options.seed,
    controls: options.controls,
  };
}

/** Host the simulation on this thread. */
export function createLocalEngine(options: EngineOptions): Engine {
  const inbox = createInbox();
  // Leave most of each frame to rendering: this host shares the page thread.
  const host: Host = createWorkerHost((m) => inbox.receive(m), { chunkMs: 8 });
  host.onMessage(initMessage(options));
  return {
    kind: 'local',
    setControls: (patch) => host.onMessage({ type: 'controls', patch }),
    resize: (width, height) =>
      host.onMessage({ type: 'resize', width, height }),
    requestFrame(render, onFrame) {
      inbox.frameQueue.push(onFrame);
      host.onMessage({ type: 'frame', render });
    },
    onLog: (handler) => inbox.setLog(handler),
    dispose: () => host.dispose(),
  };
}

/** Host the simulation in a dedicated Web Worker. Throws if one cannot start. */
export function createWorkerEngine(options: EngineOptions): Engine {
  const inbox = createInbox();
  const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (event: MessageEvent<WorkerToMain>) =>
    inbox.receive(event.data);
  worker.postMessage(initMessage(options));
  return {
    kind: 'worker',
    setControls: (patch) => worker.postMessage({ type: 'controls', patch }),
    resize: (width, height) =>
      worker.postMessage({ type: 'resize', width, height }),
    requestFrame(render, onFrame) {
      inbox.frameQueue.push(onFrame);
      worker.postMessage({ type: 'frame', render });
    },
    onLog: (handler) => inbox.setLog(handler),
    dispose: () => worker.terminate(),
  };
}

/** A worker-backed engine where possible, the in-page one otherwise. */
export function createEngine(options: EngineOptions): Engine {
  if (!options.forceLocal && typeof Worker !== 'undefined') {
    try {
      return createWorkerEngine(options);
    } catch {
      // Fall through: e.g. a file:// page, or a CSP that forbids workers.
    }
  }
  return createLocalEngine(options);
}
