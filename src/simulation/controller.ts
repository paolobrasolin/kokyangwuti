import type { Config } from '../config';
import { CONFIG } from '../config';
import type {
  LogType,
  SimStats,
  SimulationControls,
  SimulationState,
} from '../types';
import type { GenerationReport } from './lifecycle';
import { buildFrameWorld, endGeneration, startGeneration } from './lifecycle';
import {
  createEvolutionState,
  createSimulationState,
  resizeSimulation,
} from './state';
import type { UpdateMetrics } from './update';
import { updateTick } from './update';

interface ControllerOptions {
  /** Arena size, px. */
  width: number;
  height: number;
  config?: Config;
  logger: (message: string, type?: LogType) => void;
  /** Root RNG seed for the whole run. Defaults to `config.defaultSeed`. */
  seed?: number;
}

/**
 * The headless run: one arena, one persistent population, generation after
 * generation. Knows nothing about the DOM, the wall clock or rendering, so it
 * can live in a Web Worker or a Node script just as well as on the page.
 */
export function createSimulationController({
  width,
  height,
  config = CONFIG,
  logger,
  seed = config.defaultSeed,
}: ControllerOptions) {
  const state: SimulationState = createSimulationState(width, height, seed);
  const controls: SimulationControls = {
    flyRate: config.defaultFlyRate,
    targetPopulation: config.defaultPopulation,
    immortality: false,
  };
  const evolution = createEvolutionState(seed, controls.targetPopulation);

  let lastReport: GenerationReport | null = null;
  let lastMetrics: UpdateMetrics = {
    activeCount: 0,
    totalEnergy: 0,
    timerMs: 0,
  };

  function start(): void {
    const info = startGeneration(state, evolution, controls, config);
    logger(`Gen ${info.generation} Started`);
    lastMetrics = {
      activeCount: state.agents.length,
      totalEnergy: state.agents.reduce((sum, a) => sum + a.energy, 0),
      timerMs: 0,
    };
  }

  function end(): void {
    const report = endGeneration(state, evolution);
    lastReport = report;

    // Fitness is quoted per `REFERENCE_PREY` flies; the raw supply is logged
    // alongside so an unusually lean or fat generation is still visible.
    logger(
      `Gen ${report.generation}: best ${report.bestFitness.toFixed(0)}, mean ${report.meanFitness.toFixed(0)} (${report.preySpawned} prey)`,
    );
    if (report.newBest) logger('New Best Genome!', 'highlight');
    if (report.bestMetrics) {
      const m = report.bestMetrics;
      logger(
        `Web: ${m.threadCount} threads, ${m.silkSpent.toFixed(0)}px silk, ${m.fliesCaught} flies`,
      );
    } else {
      logger('No survivor this round.', 'danger');
    }
  }

  /** Advance the run by `dt` ms of simulated time. */
  function update(dt: number): void {
    lastMetrics = updateTick(state, controls, config, dt);
    if (!state.active || controls.immortality) return;

    const timeUp = state.genTimer >= config.genDurationMs;
    const allDead = lastMetrics.activeCount === 0 && state.genTimer > 1000;
    if (timeUp || allDead) {
      end();
      start();
    }
  }

  function getStats(): SimStats {
    const { activeCount, totalEnergy } = lastMetrics;
    return {
      generation: evolution.generation,
      timerMs: Math.max(0, config.genDurationMs - state.genTimer),
      activeCount,
      avgEnergy: activeCount ? totalEnergy / activeCount : 0,
      bestFitness: evolution.bestFitness,
      genBestFitness: lastReport ? lastReport.bestFitness : 0,
      meanFitness: lastReport ? lastReport.meanFitness : 0,
      bestMetrics: lastReport ? lastReport.bestMetrics : null,
      bestGenome: evolution.bestGenome,
      flyRate: controls.flyRate,
      targetPopulation: controls.targetPopulation,
      maxEnergy: config.startingEnergy,
      genomeHistory: evolution.history,
      immortality: controls.immortality,
    };
  }

  function setPopulation(value: number): void {
    if (Number.isFinite(value) && value >= 1) controls.targetPopulation = value;
  }

  function setFlyRate(value: number): void {
    if (Number.isFinite(value) && value >= 0) controls.flyRate = value;
  }

  function setImmortality(on: boolean): void {
    controls.immortality = on;
  }

  function resize(nextWidth: number, nextHeight: number): void {
    resizeSimulation(state, nextWidth, nextHeight);
    if (state.world.nodes.length > 0) {
      buildFrameWorld(state);
    }
  }

  return {
    start,
    update,
    getStats,
    setPopulation,
    setFlyRate,
    setImmortality,
    resize,
    getControls: () => controls,
    getState: () => state,
    getEvolution: () => evolution,
  };
}

export type SimulationController = ReturnType<
  typeof createSimulationController
>;
