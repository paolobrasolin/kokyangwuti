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
  dropRate: 0.015,
  glide: 0.5,
  speed: 1.0,
  bias: 0.35,
  radialPreference: 0.6,
  spiralDrift: 0.25,
  gravityScale: 1.0,
};

export type Config = typeof CONFIG;
export type SpeedStep = (typeof SPEED_STEPS)[number];
