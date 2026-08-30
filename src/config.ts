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
  /** Root RNG seed. Fixed so a run is reproducible across reloads. */
  defaultSeed: 20260829,
};

/**
 * Prey physics and adhesion tuning.
 *
 * A fly is a ballistic particle that becomes a *massive node* in the web on
 * impact: from there the mass-spring solver does the work. Nothing here is a
 * capture formula — these are the physical properties of the prey and of the
 * silk/prey contact, and capture is whatever falls out of them.
 *
 * Velocities are in px per 16 ms, to match the agent conventions.
 */
export const FLY = {
  /** Distance outside the arena a fly is spawned / despawned at. */
  spawnMargin: 30,
  /** Live flies tracked at once. Excess spawns are drawn and discarded so the
   *  prey stream stays independent of what the webs are doing. */
  maxLive: 24,
  /** Node mass of a fly, in physics mass units (default node mass is 0.1). */
  minMass: 0.12,
  maxMass: 0.55,
  /** Mass that yields exactly `config.gainFly` when eaten. */
  referenceMass: 0.3,
  /** Cruising speed, px per 16 ms. */
  minSpeed: 1.8,
  maxSpeed: 6.5,
  /** Parametric margin kept away from a spring's ends when splitting on impact. */
  splitMargin: 0.15,
  /**
   * Fraction of the fly node's velocity the silk absorbs per 16 ms, per unit of
   * spring damping. The solver ignores `spring.damping`, so this is where the
   * damping difference between sticky capture silk (0.375) and radial silk
   * (0.11) turns into real energy dissipation.
   */
  dampingCoupling: 0.6,
  /** Kinetic energy below which a coupled fly counts as subdued. */
  captureEnergy: 0.06,
  /** Hard cap on coupled simulation time; still stuck at the cap = caught. */
  holdMs: 1400,
  /** Base per-16 ms escape probability on adhesion-free silk. */
  escapeBase: 0.34,
  /** Escape chance floor, as a multiple of `escapeBase * (1 - adhesion)`. */
  escapeFloor: 0.12,
  /** Kinetic energy that counts as "one unit" of struggling. */
  escapeEnergyScale: 0.5,
  /** Cap on the struggle multiplier, so a wild fly cannot exceed this. */
  maxEnergyFactor: 3,
  /** Grace period after tearing/struggling free, so a fly can leave the web. */
  graceMs: 250,
  /** Safety despawn for a fly that never leaves the arena. */
  maxAgeMs: 30000,
  /**
   * Fast-forward fallback (simSpeed >= PHYSICS.skipPhysicsSpeed, solver off).
   * `fastCapacityScale` converts a spring's elastic reserve
   * `0.5 * stiffness * (maxExtension - restLength)^2` into the kinetic energy
   * it can absorb; `fastHoldScale` scales adhesion into a hold probability.
   */
  fastCapacityScale: 0.035,
  fastHoldScale: 0.95,
};

/** Documented mutation range of every genome field. */
export const GENOME_RANGES: Record<keyof Genome, readonly [number, number]> = {
  /**
   * Kept as-is: measured head-to-head the rule does *not* saturate at the top
   * of the range (0.3 → +9% prey, 1.0 → -9%, 1.5 → par against `BASE_GENOME`),
   * so there is nothing to widen. The pinning at 1.5 seen in Phase 4 was the
   * body-mass fitness loophole talking, not this rule.
   */
  angleGapThreshold: [0.2, 1.5],
  buildNoise: [0, 0.8],
  exploreDropRate: [0.001, 0.08],
  gravityBias: [0, 2],
  structureAttraction: [0, 2],
  captureSwitchThreshold: [0.05, 1.2],
  attachReach: [8, 90],
  tensionPreference: [-1, 1],
  ownSilkPreference: [-1, 1],
  headingInertia: [0, 2],
  hubAttraction: [0, 2],
  stopDensity: [1, 40],
  /**
   * Measured head-to-head against `BASE_GENOME` (same arena, mirrored slots):
   * 0.5 → -12% prey, 1.0 → par, 2.0 → par, 3.0 → -26%. Everything above ~2 is
   * strictly worse now that crawling costs more per pixel at a faster gait, so
   * the ceiling comes down to the edge of the useful band; drift used to park
   * the population on a stretch of range that could never pay.
   */
  speed: [0.5, 2],
  bodyMass: [0.6, 1.8],
  gravityScale: [0.4, 1.8],
};

export const BASE_GENOME: Genome = {
  angleGapThreshold: 0.62,
  buildNoise: 0.14,
  exploreDropRate: 0.02,
  gravityBias: 0.9,
  structureAttraction: 0.6,
  captureSwitchThreshold: 0.5,
  attachReach: 34,
  tensionPreference: 0.2,
  ownSilkPreference: 0.45,
  headingInertia: 0.7,
  hubAttraction: 0.5,
  stopDensity: 16,
  speed: 1.0,
  bodyMass: 1.0,
  gravityScale: 1.0,
};

export type Config = typeof CONFIG;
export type SpeedStep = (typeof SPEED_STEPS)[number];
