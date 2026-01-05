import type { Agent, SimulationControls, SimulationState } from '../types';
import type { Config } from '../config';
import { distToSegment, getIntersection } from '../geometry';

export interface UpdateMetrics {
  activeCount: number;
  totalEnergy: number;
  timerMs: number;
}

export function updateTick(
  state: SimulationState,
  controls: SimulationControls,
  config: Config,
  dt: number,
): UpdateMetrics {
  if (!state.active) return { activeCount: 0, totalEnergy: 0, timerMs: state.genTimer };

  state.genTimer += dt;
  state.globalTime += dt * 0.01;

  const chance = 1 - (1 - controls.flyRate) ** (dt / 16);
  if (Math.random() < chance) attemptFlyCross(state, config);

  let activeCount = 0;
  let totalEnergy = 0;

  state.agents.forEach((agent) => {
    if (!agent.alive) return;
    activeCount += 1;
    totalEnergy += agent.energy;

    agent.energy -= config.baselineEnergyDrain * (dt / 16);
    if (agent.energy <= 0) {
      agent.alive = false;
      agent.energy = 0;
      return;
    }

    if (agent.state === 'crawling') updateCrawl(agent, state, config, dt);
    else updateFall(agent, state, config, dt);
  });

  return { activeCount, totalEnergy, timerMs: state.genTimer };
}

function attemptFlyCross(state: SimulationState, config: Config): void {
  const fx = Math.random() * state.width;
  const fy = Math.random() * state.height;

  state.agents.forEach((agent) => {
    if (!agent.alive) return;
    let caught = false;

    for (const line of agent.lines) {
      const d = distToSegment(fx, fy, line.x1, line.y1, line.x2, line.y2);
      if (d < 5) {
        caught = true;
        break;
      }
    }

    if (caught) {
      agent.score += 1;
      agent.energy += config.gainFly;
      agent.fliesCaught.push({ x: fx, y: fy });
      if (agent.fliesCaught.length > config.maxFliesPerAgent) agent.fliesCaught.shift();
    }
  });
}

function updateCrawl(
  agent: Agent,
  state: SimulationState,
  config: Config,
  dt: number,
): void {
  const line =
    agent.currentLineIdx < 4
      ? state.frameLines[agent.currentLineIdx]
      : agent.lines[agent.currentLineIdx - 4];

  if (!line) return;

  const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
  const speed = (2 + agent.genome.speed * 2) * (dt / 16);
  const tStep = len > 0 ? speed / len : 0;

  agent.t += tStep * agent.direction;
  agent.x = line.x1 + (line.x2 - line.x1) * agent.t;
  agent.y = line.y1 + (line.y2 - line.y1) * agent.t;
  agent.energy -= config.costCrawl * speed;

  if (agent.t <= 0 || agent.t >= 1) {
    agent.t = agent.t <= 0 ? 0 : 1;
    const px = agent.t === 0 ? line.x1 : line.x2;
    const py = agent.t === 0 ? line.y1 : line.y2;

    const connected: Array<{ idx: number; startT: number; isUp?: boolean }> = [];
    state.frameLines.forEach((frameLine, idx) => {
      if (idx === agent.currentLineIdx) return;
      const d1 = Math.hypot(frameLine.x1 - px, frameLine.y1 - py);
      const d2 = Math.hypot(frameLine.x2 - px, frameLine.y2 - py);
      if (d1 < 1) connected.push({ idx, startT: 0 });
      else if (d2 < 1) connected.push({ idx, startT: 1 });
    });
    agent.lines.forEach((privateLine, i) => {
      const realIdx = i + 4;
      if (realIdx === agent.currentLineIdx) return;
      const d1 = Math.hypot(privateLine.x1 - px, privateLine.y1 - py);
      const d2 = Math.hypot(privateLine.x2 - px, privateLine.y2 - py);
      if (d1 < 1) connected.push({ idx: realIdx, startT: 0 });
      else if (d2 < 1) connected.push({ idx: realIdx, startT: 1 });
    });

    if (connected.length > 0) {
      const options = connected.map((c) => {
        const nextLine = c.idx < 4 ? state.frameLines[c.idx] : agent.lines[c.idx - 4];
        const otherY = c.startT === 0 ? nextLine.y2 : nextLine.y1;
        const isUp = otherY < agent.y;
        return { ...c, isUp };
      });

      const wantUp = Math.random() > agent.genome.bias;
      const preferred = options.filter((o) => o.isUp === wantUp);
      const candidates = preferred.length > 0 ? preferred : options;
      const next = candidates[Math.floor(Math.random() * candidates.length)];

      agent.currentLineIdx = next.idx;
      agent.t = next.startT;
      agent.direction = next.startT === 0 ? 1 : -1;
    } else {
      agent.direction *= -1;
    }
  }

  const dropProb = 1 - (1 - agent.genome.dropRate) ** (dt / 16);
  if (Math.random() < dropProb) {
    agent.state = 'falling';
    agent.dropStartPos = { x: agent.x, y: agent.y };
    agent.vy = 2.0;
    agent.vx = agent.direction * (Math.random() * agent.genome.glide);
    if (Math.random() < 0.2) agent.vx *= -1;
    agent.energy -= config.costDropStart;
  }
}

function updateFall(
  agent: Agent,
  state: SimulationState,
  config: Config,
  dt: number,
): void {
  const nextX = agent.x + agent.vx * (dt / 16);
  const nextY = agent.y + agent.vy * (dt / 16);

  agent.energy -= config.costDropPixel * Math.hypot(agent.vx, agent.vy);

  let hit: { idx: number; x: number; y: number } | null = null;
  let minT = Infinity;

  const checkList = (list: typeof state.frameLines, offsetIdx: number) => {
    for (let i = 0; i < list.length; i++) {
      const line = list[i];
      const result = getIntersection(
        agent.x,
        agent.y,
        nextX,
        nextY,
        line.x1,
        line.y1,
        line.x2,
        line.y2,
      );
      if (result && agent.dropStartPos) {
        const distFromStart = Math.hypot(result.x - agent.dropStartPos.x, result.y - agent.dropStartPos.y);
        if (distFromStart > 2) {
          const distToHit = Math.hypot(result.x - agent.x, result.y - agent.y);
          if (distToHit < minT) {
            minT = distToHit;
            hit = { idx: i + offsetIdx, x: result.x, y: result.y };
          }
        }
      }
    }
  };

  checkList(state.frameLines, 0);
  checkList(agent.lines, 4);

  if (!hit) {
    if (nextY >= state.height) hit = { idx: 2, x: nextX, y: state.height };
    else if (nextX <= 0) hit = { idx: 3, x: 0, y: nextY };
    else if (nextX >= state.width) hit = { idx: 1, x: state.width, y: nextY };
  }

  if (hit) {
    const startIsFrame = agent.currentLineIdx < 4;
    const endIsFrame = hit.idx < 4;
    const sameSide = startIsFrame && endIsFrame && agent.currentLineIdx === hit.idx;

    if (!sameSide && agent.dropStartPos) {
      agent.lines.push({
        x1: agent.dropStartPos.x,
        y1: agent.dropStartPos.y,
        x2: hit.x,
        y2: hit.y,
        id: agent.lines.length,
        color: agent.webColor,
      });
    }

    agent.state = 'crawling';
    agent.x = hit.x;
    agent.y = hit.y;
    agent.currentLineIdx = hit.idx;

    const line = hit.idx < 4 ? state.frameLines[hit.idx] : agent.lines[hit.idx - 4];
    const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
    const dist = Math.hypot(agent.x - line.x1, agent.y - line.y1);
    agent.t = len > 0 ? dist / len : 0;
    agent.direction = Math.random() < 0.5 ? 1 : -1;
  } else {
    agent.x = nextX;
    agent.y = nextY;
  }
}
