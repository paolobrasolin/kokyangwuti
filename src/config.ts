import type { Genome } from './types';

export const SPEED_STEPS = [1, 5, 20, 100, 1000, 10000] as const;

export const CONFIG = {
  startingEnergy: 2000,
  costCrawl: 0.05,
  costDropStart: 20,
  costDropPixel: 0.2,
  gainFly: 1000,
  genDurationMs: 60000,
  baselineEnergyDrain: 0.05,
  defaultFlyRate: 0.1,
  defaultPopulation: 8,
  logMaxEntries: 6,
  maxFliesPerAgent: 50,
};

export const BASE_GENOME: Genome = {
  radialCount: 16,
  spiralSpacing: 0.05,
  hubSize: 0.1,
  buildPrecision: 0.7,
  anchorCount: 3,
  speed: 1.0,
  bodyMass: 1.0,
  gravityScale: 1.0,
};

export type Config = typeof CONFIG;
export type SpeedStep = (typeof SPEED_STEPS)[number];
