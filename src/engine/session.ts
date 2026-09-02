/**
 * A running simulation plus its pacing: the thing a worker (or, failing that,
 * the page) hosts. Owns the controller and the scheduler, answers requests for
 * stats and render frames, and applies control changes. Every tick it runs is
 * exactly `TICK_MS` long, whatever the speed.
 */

import type { Config } from '../config';
import { CONFIG, TICK_MS } from '../config';
import { buildRenderFrame, type RenderFrame } from '../render/frame';
import {
  createSimulationController,
  type SimulationController,
} from '../simulation/controller';
import type { LogType, UiStats } from '../types';
import type { ControlsPatch } from './protocol';
import { TickScheduler } from './scheduler';

export interface SessionOptions {
  width: number;
  height: number;
  seed?: number;
  config?: Config;
  log: (message: string, type?: LogType) => void;
  /** Wall clock for the scheduler. Injectable for tests. */
  now?: () => number;
}

export interface Session {
  readonly scheduler: TickScheduler;
  readonly controller: SimulationController;
  /** Run due ticks for up to `budgetMs`; returns wall ms until the next is due. */
  pump(budgetMs: number): number;
  setControls(patch: ControlsPatch): void;
  resize(width: number, height: number): void;
  stats(): UiStats;
  frame(): RenderFrame;
}

export function createSession(options: SessionOptions): Session {
  const config = options.config ?? CONFIG;
  const controller = createSimulationController({
    width: options.width,
    height: options.height,
    config,
    logger: options.log,
    seed: options.seed,
  });
  const scheduler = new TickScheduler({ tickMs: TICK_MS, now: options.now });
  const tick = () => controller.update(TICK_MS);

  controller.start();

  return {
    scheduler,
    controller,
    pump(budgetMs) {
      return scheduler.pump(tick, budgetMs).nextDelayMs;
    },
    setControls(patch) {
      if (patch.speed !== undefined) scheduler.setSpeed(patch.speed);
      if (patch.flyRate !== undefined) controller.setFlyRate(patch.flyRate);
      if (patch.population !== undefined)
        controller.setPopulation(patch.population);
      if (patch.immortality !== undefined)
        controller.setImmortality(patch.immortality);
    },
    resize(width, height) {
      controller.resize(width, height);
    },
    stats() {
      return {
        ...controller.getStats(),
        targetSpeed: scheduler.getSpeed(),
        measuredSpeed: scheduler.measuredSpeed(),
      };
    },
    frame() {
      return buildRenderFrame(controller.getState());
    },
  };
}
