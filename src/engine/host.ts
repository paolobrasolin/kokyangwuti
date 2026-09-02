/**
 * The simulation host: receives `MainToWorker` messages, owns a `Session`, and
 * keeps it ticking on the event loop. This is the whole of what runs inside the
 * Web Worker; `worker.ts` only binds it to `self`. It has no dependency on the
 * worker global scope so it can be driven in tests — and it is also exactly
 * what the page runs, in-thread, when no `Worker` is available.
 */

import { frameBuffers } from '../render/frame';
import type { MainToWorker, WorkerToMain } from './protocol';
import { createSession, type Session } from './session';

export interface HostTimers {
  now(): number;
  /** Run `fn` as soon as the event loop is free. Returns a cancel function. */
  defer(fn: () => void): () => void;
  /** Run `fn` after `ms` of wall time. Returns a cancel function. */
  later(fn: () => void, ms: number): () => void;
}

/**
 * Real timers. A zero delay goes through a `MessageChannel` where there is
 * one: `setTimeout(fn, 0)` is clamped to several ms once timers nest, which
 * would put a floor under how fast the host can pump.
 */
export function realTimers(): HostTimers {
  let channel: MessageChannel | null = null;
  const queue: Array<(() => void) | null> = [];
  if (typeof MessageChannel !== 'undefined') {
    channel = new MessageChannel();
    channel.port1.onmessage = () => {
      const fn = queue.shift();
      if (fn) fn();
    };
  }
  return {
    now: () => performance.now(),
    defer(fn) {
      if (!channel) return this.later(fn, 0);
      const entry: { fn: (() => void) | null } = { fn };
      const wrapped = () => entry.fn?.();
      queue.push(wrapped);
      channel.port2.postMessage(0);
      return () => {
        entry.fn = null;
      };
    },
    later(fn, ms) {
      const handle = setTimeout(fn, ms);
      return () => clearTimeout(handle);
    },
  };
}

export interface HostOptions {
  timers?: HostTimers;
  /**
   * Longest stretch of ticking before the host yields to its event loop, wall
   * ms. Bounds how long a control change or a frame request can wait.
   */
  chunkMs?: number;
}

export type Post = (message: WorkerToMain, transfer?: ArrayBuffer[]) => void;

export interface Host {
  onMessage(message: MainToWorker): void;
  /** The session, once `init` has arrived. */
  session(): Session | null;
  dispose(): void;
}

export function createWorkerHost(post: Post, options: HostOptions = {}): Host {
  const timers = options.timers ?? realTimers();
  const chunkMs = options.chunkMs ?? 24;

  let session: Session | null = null;
  let cancel: (() => void) | null = null;
  let disposed = false;

  function schedule(delayMs: number): void {
    if (cancel) cancel();
    cancel = delayMs <= 0 ? timers.defer(loop) : timers.later(loop, delayMs);
  }

  function loop(): void {
    cancel = null;
    if (!session || disposed) return;
    const next = session.pump(chunkMs);
    schedule(next);
  }

  function onMessage(message: MainToWorker): void {
    if (disposed) return;
    switch (message.type) {
      case 'init': {
        if (session) return;
        session = createSession({
          width: message.width,
          height: message.height,
          seed: message.seed,
          now: () => timers.now(),
          log: (text, level = '') =>
            post({ type: 'log', message: text, level }),
        });
        if (message.controls) session.setControls(message.controls);
        post({ type: 'ready' });
        schedule(0);
        return;
      }
      case 'controls': {
        if (!session) return;
        session.setControls(message.patch);
        // A new pace applies right away, not after the current wait.
        if (message.patch.speed !== undefined) schedule(0);
        return;
      }
      case 'resize': {
        session?.resize(message.width, message.height);
        return;
      }
      case 'frame': {
        if (!session) return;
        const frame = message.render ? session.frame() : null;
        post(
          { type: 'frame', stats: session.stats(), frame },
          frame ? frameBuffers(frame) : [],
        );
        return;
      }
    }
  }

  return {
    onMessage,
    session: () => session,
    dispose() {
      disposed = true;
      if (cancel) cancel();
      cancel = null;
    },
  };
}
