import type { Agent, Genome, SimulationState } from '../types';
import type { Config } from '../config';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mutate(genome: Genome): Genome {
  const next = { ...genome };
  if (Math.random() < 0.4) next.dropRate = clamp(next.dropRate + (Math.random() - 0.5) * 0.01, 0.001, 0.1);
  if (Math.random() < 0.4) next.glide = clamp(next.glide + (Math.random() - 0.5) * 0.5, 0, 5);
  if (Math.random() < 0.4) next.speed = clamp(next.speed + (Math.random() - 0.5) * 0.2, 0.5, 3);
  if (Math.random() < 0.4) next.bias = clamp(next.bias + (Math.random() - 0.5) * 0.2, 0, 1);
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
  return {
    id,
    genome,
    alive: true,
    energy: config.startingEnergy,
    score: 0,
    x: startX,
    y: 0,
    state: 'crawling',
    currentLineIdx: 0,
    t: state.width > 0 ? startX / state.width : 0,
    direction: Math.random() < 0.5 ? 1 : -1,
    dropStartPos: null,
    vx: 0,
    vy: 0,
    lines: [],
    fliesCaught: [],
    color: `hsl(${hue}, 100%, 60%)`,
    webColor: `hsla(${hue}, 100%, 70%, 0.4)`,
    legPhase: Math.random() * 10,
  };
}
