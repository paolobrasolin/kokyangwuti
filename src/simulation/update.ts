import type { Agent, Line, SimulationControls, SimulationState } from '../types';
import type { Config } from '../config';
import { distToSegment, getIntersection } from '../geometry';
import { getSilkProfile } from './lifecycle';

export interface UpdateMetrics {
  activeCount: number;
  totalEnergy: number;
  timerMs: number;
}

interface Fly {
  start: { x: number; y: number };
  end: { x: number; y: number };
  heading: { x: number; y: number };
  mass: number;
  speed: number;
  energy: number;
}

interface ImpactHit {
  line: Line;
  point: { x: number; y: number };
  source: 'frame' | 'agent';
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
  const fly = createFly(state);

  state.agents.forEach((agent) => {
    if (!agent.alive) return;
    const hit = findImpact(fly, agent, state.frameLines);
    if (!hit) return;

    const captured = resolveImpact(agent, hit, fly, state);
    if (captured) {
      agent.score += 1;
      agent.energy = Math.min(agent.energy + config.gainFly, config.startingEnergy * 3);
      agent.fliesCaught.push(hit.point);
      if (agent.fliesCaught.length > config.maxFliesPerAgent) agent.fliesCaught.shift();
    }
  });
}

function createFly(state: SimulationState): Fly {
  const horizontal = Math.random() < 0.5;
  const margin = 30;
  let start: Fly['start'];
  let end: Fly['end'];

  if (horizontal) {
    const fromLeft = Math.random() < 0.5;
    const y = Math.random() * state.height;
    start = { x: fromLeft ? -margin : state.width + margin, y };
    end = { x: fromLeft ? state.width + margin : -margin, y: y + (Math.random() - 0.5) * 80 };
  } else {
    const x = Math.random() * state.width;
    start = { x, y: -margin };
    end = { x: x + (Math.random() - 0.5) * 100, y: state.height + margin };
  }

  const mass = 0.01 + Math.random() * 0.06;
  const speed = 1.5 + Math.random() * 4.5;
  const heading = { x: end.x - start.x, y: end.y - start.y };
  const energy = mass * speed * speed * 1200;

  return { start, end, heading, mass, speed, energy };
}

function findImpact(fly: Fly, agent: Agent, frameLines: Line[]): ImpactHit | null {
  let closest: ImpactHit | null = null;
  let minDist = Infinity;

  const checkLine = (line: Line, source: 'frame' | 'agent') => {
    const intersection = getIntersection(
      fly.start.x,
      fly.start.y,
      fly.end.x,
      fly.end.y,
      line.x1,
      line.y1,
      line.x2,
      line.y2,
    );
    if (!intersection) return;
    const dist = Math.hypot(intersection.x - fly.start.x, intersection.y - fly.start.y);
    if (dist < minDist) {
      minDist = dist;
      closest = { line, point: intersection, source };
    }
  };

  frameLines.forEach((line) => checkLine(line, 'frame'));
  agent.lines.forEach((line) => checkLine(line, 'agent'));
  return closest;
}

function computeSupportCapacity(agent: Agent, state: SimulationState, point: { x: number; y: number }, skip: Line): number {
  const candidates = [...state.frameLines, ...agent.lines].filter(
    (line) => line.id !== skip.id && line.type !== 'capture',
  );

  return candidates.reduce((total, line) => {
    const d = distToSegment(point.x, point.y, line.x1, line.y1, line.x2, line.y2);
    if (d > 35) return total;
    const lengthFactor = Math.max(
      0.5,
      Math.hypot(line.x2 - line.x1, line.y2 - line.y1) / Math.max(state.width, state.height),
    );
    return total + (line.strength * 1200 + line.tension * 450 + line.extensibility * 400) * lengthFactor;
  }, 0);
}

function resolveImpact(
  agent: Agent,
  hit: ImpactHit,
  fly: Fly,
  state: SimulationState,
): boolean {
  const lineVector = { x: hit.line.x2 - hit.line.x1, y: hit.line.y2 - hit.line.y1 };
  const pathAngle = Math.atan2(fly.heading.y, fly.heading.x);
  const lineAngle = Math.atan2(lineVector.y, lineVector.x);
  const angleFactor = Math.abs(Math.sin(pathAngle - lineAngle));
  const lineLength = Math.max(10, Math.hypot(lineVector.x, lineVector.y));

  const axialCapacity = hit.line.strength * 1200 * (lineLength / Math.max(80, state.width * 0.4));
  const stretchAllowance = hit.line.extensibility * 900 * (0.5 + angleFactor);
  const dampingLoss = fly.energy * (0.1 + hit.line.damping * 0.55) * angleFactor;
  const supportCapacity = computeSupportCapacity(agent, state, hit.point, hit.line);
  const residualEnergy = Math.max(0, fly.energy - dampingLoss);
  const totalCapacity = axialCapacity + stretchAllowance + supportCapacity;

  const adhesionAssist = hit.line.adhesion * (0.6 + 0.3 * angleFactor);
  const tensionAssist = hit.line.tension * 0.25;
  const stickProbability = Math.min(0.98, adhesionAssist + tensionAssist);

  const survives = residualEnergy <= totalCapacity;
  const caught = survives && Math.random() < stickProbability;

  if (!survives && hit.source === 'agent') {
    agent.lines = agent.lines.filter((line) => line.id !== hit.line.id);
  }

  if (!caught && survives && hit.line.type === 'capture') {
    hit.line.tension = Math.max(0, hit.line.tension - 0.05);
  }

  if (caught && hit.line.type === 'capture') {
    const aerodynamicLoss = fly.energy * (0.05 + hit.line.damping * 0.2);
    agent.energy = Math.max(0, agent.energy - aerodynamicLoss * 0.01);
  }

  return caught;
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
      const silkType = startIsFrame || endIsFrame ? 'radial' : 'capture';
      const silkProfile = getSilkProfile(silkType);
      const lineColor =
        silkType === 'capture' ? agent.webColor : agent.webColor.replace(/0\.4\)$/, '0.7)');
      agent.lines.push({
        ...silkProfile,
        x1: agent.dropStartPos.x,
        y1: agent.dropStartPos.y,
        x2: hit.x,
        y2: hit.y,
        id: agent.lines.length,
        color: lineColor,
        type: silkType,
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
