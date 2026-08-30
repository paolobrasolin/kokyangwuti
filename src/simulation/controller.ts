import type { Config, SpeedStep } from '../config';
import { CONFIG, SPEED_STEPS } from '../config';
import type {
  LogType,
  RenderSnapshot,
  SimulationControls,
  SimulationState,
  UiStats,
} from '../types';
import type { GenerationReport } from './lifecycle';
import { buildFrameWorld, endGeneration, startGeneration } from './lifecycle';
import {
  createEvolutionState,
  createSimulationState,
  resizeSimulation,
} from './state';
import { updateTick } from './update';

interface ControllerOptions {
  config?: Config;
  logger: (message: string, type?: LogType) => void;
  onNewBest?: (fitness: number) => void;
  /** Root RNG seed for the whole run. Defaults to `config.defaultSeed`. */
  seed?: number;
}

export function createSimulationController({
  config = CONFIG,
  logger,
  onNewBest,
  seed = config.defaultSeed,
}: ControllerOptions) {
  const state: SimulationState = createSimulationState(
    window.innerWidth,
    window.innerHeight,
    seed,
  );
  const controls: SimulationControls = {
    simSpeed: SPEED_STEPS[0],
    flyRate: config.defaultFlyRate,
    targetPopulation: config.defaultPopulation,
    immortality: false,
  };
  const evolution = createEvolutionState(seed, controls.targetPopulation);

  let restartHandle: number | null = null;
  let lastReport: GenerationReport | null = null;

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
    const report = endGeneration(state, evolution);
    lastReport = report;

    // Fitness is quoted per `REFERENCE_PREY` flies; the raw supply is logged
    // alongside so an unusually lean or fat generation is still visible.
    logger(
      `Gen ${report.generation}: best ${report.bestFitness.toFixed(0)}, mean ${report.meanFitness.toFixed(0)} (${report.preySpawned} prey)`,
    );
    if (report.newBest) {
      logger('New Best Genome!', 'highlight');
      if (onNewBest) onNewBest(report.allTimeBest);
    }
    if (report.bestMetrics) {
      const m = report.bestMetrics;
      logger(
        `Web: ${m.threadCount} threads, ${m.silkSpent.toFixed(0)}px silk, ${m.fliesCaught} flies`,
      );
    } else {
      logger('No survivor this round.', 'danger');
    }
    scheduleRestart();
  }

  function update(dt: number): UiStats {
    const metrics = updateTick(state, controls, config, dt);

    if (state.active) {
      const remainingMs = Math.max(0, config.genDurationMs - state.genTimer);
      if (!controls.immortality) {
        if (state.genTimer >= config.genDurationMs) end();
        if (metrics.activeCount === 0 && state.genTimer > 1000) end();
      }
      return buildStats(metrics.activeCount, metrics.totalEnergy, remainingMs);
    }

    const remainingMs = Math.max(0, config.genDurationMs - state.genTimer);
    return buildStats(metrics.activeCount, metrics.totalEnergy, remainingMs);
  }

  function buildStats(
    activeCount: number,
    totalEnergy: number,
    timerMs: number,
  ): UiStats {
    const avgEnergy = activeCount ? totalEnergy / activeCount : 0;
    return {
      generation: evolution.generation,
      timerMs,
      activeCount,
      avgEnergy,
      bestFitness: evolution.bestFitness,
      genBestFitness: lastReport ? lastReport.bestFitness : 0,
      meanFitness: lastReport ? lastReport.meanFitness : 0,
      bestMetrics: lastReport ? lastReport.bestMetrics : null,
      bestGenome: evolution.bestGenome,
      simSpeed: controls.simSpeed,
      flyRate: controls.flyRate,
      targetPopulation: controls.targetPopulation,
      maxEnergy: config.startingEnergy,
      genomeHistory: evolution.history,
      immortality: controls.immortality,
    };
  }

  function getSnapshot(): RenderSnapshot {
    return {
      world: state.world,
      agents: state.agents,
      flies: state.flies,
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

  function toggleImmortality(): boolean {
    controls.immortality = !controls.immortality;
    return controls.immortality;
  }

  function resize(width: number, height: number): void {
    resizeSimulation(state, width, height);
    if (state.world.nodes.length > 0) {
      buildFrameWorld(state);
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
    toggleImmortality,
  };
}
