import type { Config } from '../config';
import { GENOME_RANGES } from '../config';
import { findNearestSpring } from '../physics/world';
import type { Rng } from '../rng';
import type { Agent, Genome, SimulationState } from '../types';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Per-field jitter width. Each field mutates by at most ±half of this. */
const MUTATION_STEP: Record<keyof Genome, number> = {
  angleGapThreshold: 0.24,
  buildNoise: 0.16,
  exploreDropRate: 0.016,
  gravityBias: 0.4,
  structureAttraction: 0.4,
  captureSwitchThreshold: 0.24,
  attachReach: 16,
  tensionPreference: 0.4,
  ownSilkPreference: 0.4,
  headingInertia: 0.4,
  hubAttraction: 0.4,
  stopDensity: 8,
  speed: 0.2,
  bodyMass: 0.3,
  gravityScale: 0.4,
};

const MUTATION_CHANCE = 0.4;

export function mutate(genome: Genome, rng: Rng): Genome {
  const next = { ...genome };
  for (const key of Object.keys(MUTATION_STEP) as Array<keyof Genome>) {
    if (!rng.chance(MUTATION_CHANCE)) continue;
    const [min, max] = GENOME_RANGES[key];
    next[key] = clamp(
      next[key] + (rng.next() - 0.5) * MUTATION_STEP[key],
      min,
      max,
    );
  }
  return next;
}

export function createAgent(
  id: number,
  genome: Genome,
  state: SimulationState,
  config: Config,
): Agent {
  // Private stream per agent: hash(generationSeed, id).
  const rng = state.rng.fork(id);

  const startX = rng.next() * state.width;
  const hue = rng.next() * 360;

  // Find the nearest frame spring to the start position (top edge)
  const nearest = findNearestSpring(state.world, startX, 0, -1);
  const springId = nearest ? nearest.springId : 0;
  const tOnSpring = nearest
    ? nearest.t
    : state.width > 0
      ? startX / state.width
      : 0;

  // A bigger body starts with more in the tank *and* burns it faster; fitness
  // scores the difference, so the head start is not worth anything by itself.
  const startEnergy = config.startingEnergy * genome.bodyMass;

  return {
    id,
    genome,
    rng,
    alive: true,
    energy: startEnergy,
    startEnergy,
    score: 0,
    x: startX,
    y: 0,
    state: 'crawling',
    currentSpringId: springId,
    tOnSpring,
    direction: rng.sign(),
    dropStartPos: null,
    dropStartNodeId: null,
    vx: 0,
    vy: 0,
    threadIds: [],
    fliesCaught: [],
    color: `hsl(${hue}, 100%, 60%)`,
    webColor: `hsla(${hue}, 100%, 70%, 0.4)`,
    legPhase: rng.next() * 10,
    // Sensorimotor memory: nothing about the web is known yet.
    silkMode: 'structural',
    building: true,
    heading: 0,
    distanceSinceAttach: 0,
    homeNodeId: -1,
    homeDegree: 0,
    silkSpent: 0,
  };
}
