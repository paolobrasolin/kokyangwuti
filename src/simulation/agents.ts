import type { Agent, Genome, SimulationState } from '../types';
import type { Config } from '../config';
import { findNearestSpring } from '../physics/world';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mutate(genome: Genome): Genome {
  const next = { ...genome };
  if (Math.random() < 0.4) next.radialCount = clamp(Math.round(next.radialCount + (Math.random() - 0.5) * 6), 8, 32);
  if (Math.random() < 0.4) next.spiralSpacing = clamp(next.spiralSpacing + (Math.random() - 0.5) * 0.02, 0.02, 0.08);
  if (Math.random() < 0.4) next.hubSize = clamp(next.hubSize + (Math.random() - 0.5) * 0.05, 0.05, 0.2);
  if (Math.random() < 0.4) next.buildPrecision = clamp(next.buildPrecision + (Math.random() - 0.5) * 0.15, 0.3, 1.0);
  if (Math.random() < 0.4) next.anchorCount = clamp(next.anchorCount + (Math.random() - 0.5) * 1.0, 2, 5);
  if (Math.random() < 0.4) next.speed = clamp(next.speed + (Math.random() - 0.5) * 0.2, 0.5, 3);
  if (Math.random() < 0.4) next.bodyMass = clamp(next.bodyMass + (Math.random() - 0.5) * 0.3, 0.6, 1.8);
  if (Math.random() < 0.4) next.gravityScale = clamp(next.gravityScale + (Math.random() - 0.5) * 0.4, 0.4, 1.8);
  return next;
}

export function createAgent(
  id: number,
  genome: Genome,
  state: SimulationState,
  config: Config,
): Agent {
  const startX = Math.random() * state.width;
  const hue = Math.random() * 360;

  // Find the nearest frame spring to the start position (top edge)
  const nearest = findNearestSpring(state.world, startX, 0, -1);
  const springId = nearest ? nearest.springId : 0;
  const tOnSpring = nearest ? nearest.t : (state.width > 0 ? startX / state.width : 0);

  return {
    id,
    genome,
    alive: true,
    energy: config.startingEnergy * genome.bodyMass,
    score: 0,
    x: startX,
    y: 0,
    state: 'crawling',
    currentSpringId: springId,
    tOnSpring,
    direction: Math.random() < 0.5 ? 1 : -1,
    dropStartPos: null,
    vx: 0,
    vy: 0,
    threadIds: [],
    fliesCaught: [],
    color: `hsl(${hue}, 100%, 60%)`,
    webColor: `hsla(${hue}, 100%, 70%, 0.4)`,
    legPhase: Math.random() * 10,
    // Construction state
    buildPhase: 'explore',
    hubX: state.width * 0.5,
    hubY: state.height * 0.5,
    webRadius: 0,
    currentAngle: 0,
    radialsBuilt: 0,
    spiralRadius: 0,
    spiralAngle: 0,
    anchorPoints: [],
    crawlTarget: null,
    crawlTimer: 0,
  };
}
