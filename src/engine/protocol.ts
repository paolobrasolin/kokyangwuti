/**
 * Messages between the page (UI + rendering) and the simulation host, which
 * normally lives in a Web Worker. The same vocabulary is used when the host
 * runs on the page thread (no `Worker` available), so there is one code path.
 */

import type { RenderFrame } from '../render/frame';
import type { LogType, UiStats } from '../types';

/** Anything the UI can change while a run is going. */
export interface ControlsPatch {
  /** Target speed multiplier; `Infinity` for Max. */
  speed?: number;
  flyRate?: number;
  population?: number;
  immortality?: boolean;
}

export type MainToWorker =
  | {
      type: 'init';
      width: number;
      height: number;
      seed?: number;
      controls?: ControlsPatch;
    }
  | { type: 'controls'; patch: ControlsPatch }
  | { type: 'resize'; width: number; height: number }
  | {
      type: 'frame';
      /** Whether to include a render frame, or just the stats. */
      render: boolean;
    };

export type WorkerToMain =
  | { type: 'ready' }
  | { type: 'log'; message: string; level: LogType }
  | { type: 'frame'; stats: UiStats; frame: RenderFrame | null };
