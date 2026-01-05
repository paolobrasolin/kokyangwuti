import { CONFIG, SPEED_STEPS } from '../config';
import type { Config, SpeedStep } from '../config';
import type {
  LogType,
  RenderSnapshot,
  SimulationControls,
  SimulationState,
  UiStats,
} from '../types';
import { createEvolutionState, createSimulationState, resizeSimulation } from './state';
import { buildFrameLines, endGeneration, startGeneration } from './lifecycle';
import { updateTick } from './update';

interface ControllerOptions {
  config?: Config;
  logger: (message: string, type?: LogType) => void;
  onNewBest?: (fitness: number) => void;
}

export function createSimulationController({
  config = CONFIG,
  logger,
  onNewBest,
}: ControllerOptions) {
  const state: SimulationState = createSimulationState(window.innerWidth, window.innerHeight);
  const evolution = createEvolutionState();
  const controls: SimulationControls = {
    simSpeed: SPEED_STEPS[0],
    flyRate: config.defaultFlyRate,
    targetPopulation: config.defaultPopulation,
  };

  let restartHandle: number | null = null;

  function start(): void {
    const info = startGeneration(state, evolution, controls, config);
    logger(`Gen ${info.generation} Started`);
  }

  function scheduleRestart(): void {
    if (restartHandle !== null) return;
    restartHandle = window.setTimeout(() => {
      restartHandle = null;
      start();
    }, 100);
  }

  function end(): void {
    const { newBest, bestFitness, bestAgent } = endGeneration(state, evolution);
    if (newBest) {
      logger('New Best Genome!', 'highlight');
      if (onNewBest) onNewBest(bestFitness);
    } else {
      logger('Colony Failed. Retrying.', 'danger');
    }
    if (!bestAgent) logger('No survivor this round.', 'danger');
    scheduleRestart();
  }

  function update(dt: number): UiStats {
    const metrics = updateTick(state, controls, config, dt);

    if (state.active) {
      const remainingMs = Math.max(0, config.genDurationMs - state.genTimer);
      if (state.genTimer >= config.genDurationMs) end();
      if (metrics.activeCount === 0 && state.genTimer > 1000) end();
      return buildStats(metrics.activeCount, metrics.totalEnergy, remainingMs);
    }

    const remainingMs = Math.max(0, config.genDurationMs - state.genTimer);
    return buildStats(metrics.activeCount, metrics.totalEnergy, remainingMs);
  }

  function buildStats(activeCount: number, totalEnergy: number, timerMs: number): UiStats {
    const avgEnergy = activeCount ? totalEnergy / activeCount : 0;
    return {
      generation: evolution.generation,
      timerMs,
      activeCount,
      avgEnergy,
      bestFitness: evolution.bestFitness,
      bestGenome: evolution.bestGenome,
      simSpeed: controls.simSpeed,
      flyRate: controls.flyRate,
      targetPopulation: controls.targetPopulation,
      maxEnergy: config.startingEnergy,
    };
  }

  function getSnapshot(): RenderSnapshot {
    return {
      frameLines: state.frameLines,
      agents: state.agents,
      width: state.width,
      height: state.height,
      globalTime: state.globalTime,
    };
  }

  function cycleSpeed(): number {
    const idx = SPEED_STEPS.indexOf(controls.simSpeed as SpeedStep);
    const next = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
    controls.simSpeed = next;
    return controls.simSpeed;
  }

  function setPopulation(value: number): void {
    controls.targetPopulation = value;
  }

  function setFlyRate(value: number): void {
    controls.flyRate = value;
  }

  function resize(width: number, height: number): void {
    resizeSimulation(state, width, height);
    if (state.frameLines.length) {
      state.frameLines = buildFrameLines(width, height);
    }
  }

  function getSimSpeed(): number {
    return controls.simSpeed;
  }

  function getControls(): SimulationControls {
    return controls;
  }

  function getState(): SimulationState {
    return state;
  }

  return {
    start,
    update,
    getSnapshot,
    cycleSpeed,
    setPopulation,
    setFlyRate,
    resize,
    getSimSpeed,
    getControls,
    getState,
  };
}
