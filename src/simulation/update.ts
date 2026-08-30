import type { Config } from '../config';
import { distToSegment, getIntersection } from '../geometry';
import { PHYSICS } from '../physics/config';
import { applyForceToSpring, stepPhysics } from '../physics/solver';
import type { PhysicsWorld } from '../physics/types';
import {
  cleanup,
  countAgentSprings,
  createSubdividedThread,
  findNearestFrameSpring,
  findNearestSpring,
  getConnectedSprings,
  splitSpring,
} from '../physics/world';
import type {
  Agent,
  SilkType,
  SimulationControls,
  SimulationState,
} from '../types';
import { getSilkProfile } from './lifecycle';
import { physicsSkipped, stepPrey } from './prey';
import {
  nearestOwnSilk,
  SENSE_RADIUS,
  senseAtNode,
  springStrain,
  structureDirection,
} from './senses';

export interface UpdateMetrics {
  activeCount: number;
  totalEnergy: number;
  timerMs: number;
}

interface LandingHit {
  springId: number;
  x: number;
  y: number;
  isFrame: boolean;
}

// --- Constants (physiology, not blueprint) ---

/** Dragline launch speed, px per 16 ms, before the speed trait scales it. */
const LAUNCH_BASE_SPEED = 14;
const LAUNCH_SPEED_PER_SPEED_GENE = 6;
/** Gravity felt by a spider hanging on a fresh dragline. */
const DROP_GRAVITY = 0.3;
/** Pixels the agent must walk between launches, so it cannot fire on the spot. */
const MIN_WALK_BETWEEN_LAUNCHES = 12;
/** Threads shorter than this are not worth the silk. */
const MIN_THREAD_LENGTH = 12;
/** Undirected exploration noise in junction scoring. */
const JUNCTION_NOISE = 0.6;
/** Parametric margin inside which a split degenerates to an existing endpoint. */
const SPLIT_MARGIN = 0.06;
/** Hysteresis on the capture/structural switch. */
const MODE_HYSTERESIS = 2;

/**
 * Longest slice of simulated time a single sensorimotor step may cover.
 *
 * The construction loop is a *discrete* decision process: exploratory drops fire
 * mid-thread, gap filling fires on arrival at a junction, and both are only
 * reachable if a step moves the agent by less than the length of the segment it
 * is standing on. A spider covers `(2 + speed * 2) * dt / 16` px per step, so at
 * `dt = 320` (simSpeed 1000) even the slowest genome clears 80 px — more than
 * three `PHYSICS.segmentLength` segments — and every step lands on the junction
 * branch. `applyMidThreadRules` then never runs, no exploratory drop ever fires,
 * and the whole population builds nothing.
 *
 * 32 ms is the same ceiling the solver already clamps to (`PHYSICS.maxDt`), and
 * bounds the fastest genome to 12 px per step: below a segment, and below
 * `MIN_WALK_BETWEEN_LAUNCHES`, so no rule can be skipped over.
 */
export const MAX_SUBSTEP_DT = 32;

/**
 * Hard cap on substeps per tick. Fidelity costs wall time — the substeps of one
 * tick are as expensive as the same span run in real time — so beyond simSpeed
 * 1000 (`dt` 320, exactly 10 substeps) the cap trades accuracy back for a frame
 * that still returns. Everything at or below 1000x is simulated in full.
 */
export const MAX_SUBSTEPS = 16;

/** Number of sensorimotor steps a tick of `dt` ms is split into. */
export function substepCount(dt: number): number {
  if (!Number.isFinite(dt) || dt <= MAX_SUBSTEP_DT) return 1;
  return Math.min(MAX_SUBSTEPS, Math.ceil(dt / MAX_SUBSTEP_DT));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ========== MAIN TICK ==========

export function updateTick(
  state: SimulationState,
  controls: SimulationControls,
  config: Config,
  dt: number,
): UpdateMetrics {
  if (!state.active)
    return { activeCount: 0, totalEnergy: 0, timerMs: state.genTimer };

  state.genTimer += dt;
  state.globalTime += dt * 0.01;

  // Capture markers are pure decoration: they age once per tick, whole `dt`.
  for (const agent of state.agents) {
    agent.fliesCaught = agent.fliesCaught
      .map((fly) => ({ ...fly, ageMs: fly.ageMs + dt }))
      .filter((fly) => fly.ageMs < 6000);
  }

  // A long tick is a *shorter* tick repeated: prey, solver and sensorimotor
  // loop all advance in slices of at most `MAX_SUBSTEP_DT`, so fast-forward is
  // time compression and not a different simulation.
  const substeps = substepCount(dt);
  const subDt = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    substep(state, controls, config, subDt);
  }

  let activeCount = 0;
  let totalEnergy = 0;
  for (const agent of state.agents) {
    if (!agent.alive) continue;
    activeCount += 1;
    totalEnergy += agent.energy;
  }

  state.cleanupCounter++;
  if (state.cleanupCounter >= PHYSICS.cleanupInterval) {
    state.cleanupCounter = 0;
    cleanup(state.world);
  }

  return { activeCount, totalEnergy, timerMs: state.genTimer };
}

/** One slice of simulated time, short enough that no rule can be stepped over. */
function substep(
  state: SimulationState,
  controls: SimulationControls,
  config: Config,
  dt: number,
): void {
  // Prey first: an impact couples a fly into the web as a massive node, and the
  // solver below integrates it in the same substep.
  stepPrey(state, controls, config, dt);

  if (!physicsSkipped(controls)) {
    const iterations =
      controls.simSpeed >= PHYSICS.reducedIterationsSpeed
        ? PHYSICS.reducedIterations
        : PHYSICS.constraintIterations;

    for (const agent of state.agents) {
      if (!agent.alive || agent.state !== 'crawling') continue;
      const spring = state.world.springMap.get(agent.currentSpringId);
      if (!spring || spring.broken) continue;
      const weight = agent.genome.bodyMass * PHYSICS.spiderMassMultiplier;
      applyForceToSpring(
        state.world,
        agent.currentSpringId,
        agent.tOnSpring,
        0,
        weight,
      );
    }

    stepPhysics(state.world, dt, iterations);
  }

  for (const agent of state.agents) {
    if (!agent.alive) continue;

    const drain =
      config.baselineEnergyDrain * (dt / 16) * agent.genome.bodyMass;
    agent.energy = controls.immortality
      ? Math.max(1, agent.energy - drain)
      : agent.energy - drain;
    if (agent.energy <= 0) {
      if (controls.immortality) {
        agent.energy = 1;
      } else {
        agent.alive = false;
        agent.energy = 0;
        continue;
      }
    }

    if (agent.state === 'crawling')
      updateCrawl(agent, state, config, controls, dt);
    else updateFall(agent, state, config, controls, dt);
  }
}

// ========== CRAWL ==========

function updateCrawl(
  agent: Agent,
  state: SimulationState,
  config: Config,
  controls: SimulationControls,
  dt: number,
): void {
  let spring = state.world.springMap.get(agent.currentSpringId);
  if (!spring || spring.broken) {
    const nearest = findNearestSpring(state.world, agent.x, agent.y, agent.id);
    if (!nearest) return;
    agent.currentSpringId = nearest.springId;
    agent.tOnSpring = nearest.t;
    spring = state.world.springMap.get(nearest.springId);
    if (!spring) return;
  }

  const nodeA = state.world.nodeMap.get(spring.nodeA);
  const nodeB = state.world.nodeMap.get(spring.nodeB);
  if (!nodeA || !nodeB) return;

  // --- Walk along the thread underfoot ---
  const len = Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);
  const step = (2 + agent.genome.speed * 2) * (dt / 16);
  const tStep = len > 0 ? step / len : 0;

  agent.tOnSpring += tStep * agent.direction;

  const clampedT = clamp(agent.tOnSpring, 0, 1);
  agent.x = nodeA.x + (nodeB.x - nodeA.x) * clampedT;
  agent.y = nodeA.y + (nodeB.y - nodeA.y) * clampedT;
  if (len > 1e-6) {
    agent.heading = Math.atan2(
      (nodeB.y - nodeA.y) * agent.direction,
      (nodeB.x - nodeA.x) * agent.direction,
    );
  }
  agent.distanceSinceAttach += step;

  // Locomotion cost. The per-pixel price rises with the gait, so covering
  // ground faster costs energy super-linearly in time: without this the `speed`
  // gene is a free lunch (more web per fixed-length generation at a strictly
  // proportional bill) and selection pins it at the ceiling every run.
  agent.energy -=
    config.costCrawl * step * agent.genome.bodyMass * agent.genome.speed;
  if (controls.immortality) agent.energy = Math.max(1, agent.energy);

  // --- Junction reached: sense, decide, then choose a thread ---
  if (agent.tOnSpring <= 0 || agent.tOnSpring >= 1) {
    agent.tOnSpring = agent.tOnSpring <= 0 ? 0 : 1;
    const arrivedNodeId = agent.tOnSpring === 0 ? spring.nodeA : spring.nodeB;
    applyJunctionRules(agent, state, config, arrivedNodeId);
    if (agent.state !== 'crawling') return;
    chooseNextThread(agent, state, arrivedNodeId);
    return;
  }

  // --- Mid-thread rules ---
  applyMidThreadRules(agent, state, config, dt);
}

/**
 * Rules evaluated while standing on a junction. Purely local: the incident
 * thread directions, the gaps between them, and the silk density within reach.
 */
function applyJunctionRules(
  agent: Agent,
  state: SimulationState,
  config: Config,
  nodeId: number,
): void {
  const senses = senseAtNode(state.world, nodeId, agent.id);
  if (!senses) return;

  // Homing memory: the busiest own-silk junction met so far becomes "home".
  // If that node has since been cleaned away, the memory is simply forgotten.
  if (agent.homeNodeId >= 0 && !state.world.nodeMap.has(agent.homeNodeId)) {
    agent.homeNodeId = -1;
    agent.homeDegree = 0;
  }
  if (senses.ownDegree > agent.homeDegree) {
    agent.homeNodeId = nodeId;
    agent.homeDegree = senses.ownDegree;
  }

  // Termination: too much of my own silk within a leg-sweep, stop spinning here.
  agent.building = senses.density <= agent.genome.stopDensity;
  if (!agent.building) return;

  // Only own silk gives the agent something to build *from*.
  if (senses.ownDegree === 0) return;

  const gap = senses.fillableGap;
  const gapSize = gap ? gap.size : 0;

  // Mode switch: tight local geometry means it is time for capture silk.
  if (gapSize < agent.genome.captureSwitchThreshold) {
    agent.silkMode = 'capture';
  } else if (gapSize > agent.genome.captureSwitchThreshold * MODE_HYSTERESIS) {
    agent.silkMode = 'structural';
  }

  if (agent.silkMode !== 'structural') return;
  if (!gap || gap.size <= agent.genome.angleGapThreshold) return;
  if (agent.distanceSinceAttach < MIN_WALK_BETWEEN_LAUNCHES) return;

  launchDragline(agent, config, gap.bisector, nodeId);
}

/**
 * Rules evaluated between junctions: exploratory drops off the substrate, and
 * capture-silk bridging while walking a structural thread.
 */
function applyMidThreadRules(
  agent: Agent,
  state: SimulationState,
  config: Config,
  dt: number,
): void {
  if (!agent.building) return;
  const spring = state.world.springMap.get(agent.currentSpringId);
  if (!spring || spring.broken) return;

  if (spring.ownerAgentId !== agent.id) {
    tryExploreDrop(agent, state, config, dt);
    return;
  }

  if (agent.silkMode === 'capture' && spring.type === 'radial') {
    tryCaptureBridge(agent, state, config);
  }
}

/** A drop off the substrate, aimed by gravity and by sensed silk. */
function tryExploreDrop(
  agent: Agent,
  state: SimulationState,
  config: Config,
  dt: number,
): void {
  if (agent.distanceSinceAttach < MIN_WALK_BETWEEN_LAUNCHES) return;
  const perTick = clamp(agent.genome.exploreDropRate, 0, 1);
  if (!agent.rng.chance(1 - (1 - perTick) ** (dt / 16))) return;

  const wander = agent.rng.next() * Math.PI * 2;
  let dx = Math.cos(wander);
  let dy = Math.sin(wander);

  dy += agent.genome.gravityBias;

  const structure = structureDirection(state.world, agent.x, agent.y);
  dx += structure.ux * agent.genome.structureAttraction;
  dy += structure.uy * agent.genome.structureAttraction;

  const len = Math.hypot(dx, dy);
  const angle = len > 1e-6 ? Math.atan2(dy, dx) : wander;

  const startNodeId = attachmentNode(
    state.world,
    agent.currentSpringId,
    agent.tOnSpring,
  );
  launchDragline(agent, config, angle, startNodeId);
}

/**
 * Capture-silk bridging. Walking a structural thread with no capture thread
 * within a leg span, the agent throws a bridge sideways, away from whatever
 * capture silk it can feel. Spacing emerges from `attachReach`.
 */
function tryCaptureBridge(
  agent: Agent,
  state: SimulationState,
  config: Config,
): void {
  const reach = agent.genome.attachReach;
  if (agent.distanceSinceAttach < Math.max(MIN_WALK_BETWEEN_LAUNCHES, reach))
    return;

  const nearest = nearestOwnSilk(
    state.world,
    agent.x,
    agent.y,
    agent.id,
    'capture',
    SENSE_RADIUS * 2,
  );
  if (nearest.dist <= reach) return;

  // Sideways, on the side with no capture silk.
  let nx = -Math.sin(agent.heading);
  let ny = Math.cos(agent.heading);
  if (Number.isFinite(nearest.dist)) {
    if (nx * nearest.ux + ny * nearest.uy > 0) {
      nx = -nx;
      ny = -ny;
    }
  } else if (agent.rng.sign() < 0) {
    nx = -nx;
    ny = -ny;
  }

  const startNodeId = attachmentNode(
    state.world,
    agent.currentSpringId,
    agent.tOnSpring,
  );
  launchDragline(agent, config, Math.atan2(ny, nx), startNodeId);
}

/**
 * Resolve the node a dragline should be anchored to at (springId, t),
 * splitting the thread when the agent stands between its endpoints.
 */
function attachmentNode(
  world: PhysicsWorld,
  springId: number,
  t: number,
): number | null {
  const spring = world.springMap.get(springId);
  if (!spring || spring.broken) return null;
  if (t <= SPLIT_MARGIN) return spring.nodeA;
  if (t >= 1 - SPLIT_MARGIN) return spring.nodeB;
  const id = splitSpring(world, springId, t);
  return id === -1 ? null : id;
}

function launchDragline(
  agent: Agent,
  config: Config,
  angle: number,
  startNodeId: number | null,
): void {
  agent.state = 'falling';
  agent.dropStartPos = { x: agent.x, y: agent.y };
  agent.dropStartNodeId = startNodeId;

  const noise = (agent.rng.next() - 0.5) * agent.genome.buildNoise * 2;
  const aimed = angle + noise;
  const speed =
    LAUNCH_BASE_SPEED + agent.genome.speed * LAUNCH_SPEED_PER_SPEED_GENE;

  agent.vx = Math.cos(aimed) * speed;
  agent.vy = Math.sin(aimed) * speed;
  agent.energy -= config.costDropStart * agent.genome.bodyMass;
}

/** Score every thread at a junction with the genome's biases, take the best. */
function chooseNextThread(
  agent: Agent,
  state: SimulationState,
  nodeId: number,
): void {
  const world = state.world;
  const node = world.nodeMap.get(nodeId);
  if (!node) return;

  const home =
    agent.homeNodeId >= 0 && agent.homeNodeId !== nodeId
      ? world.nodeMap.get(agent.homeNodeId)
      : undefined;
  let homeUx = 0;
  let homeUy = 0;
  if (home) {
    const hx = home.x - node.x;
    const hy = home.y - node.y;
    const hd = Math.hypot(hx, hy);
    if (hd > 1e-6) {
      homeUx = hx / hd;
      homeUy = hy / hd;
    }
  }

  const headUx = Math.cos(agent.heading);
  const headUy = Math.sin(agent.heading);

  let bestId = -1;
  let bestStartT = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const springId of getConnectedSprings(world, nodeId)) {
    if (springId === agent.currentSpringId) continue;
    const spring = world.springMap.get(springId);
    if (!spring || spring.broken) continue;
    if (spring.ownerAgentId !== agent.id && spring.ownerAgentId !== -1)
      continue;

    const startT = spring.nodeA === nodeId ? 0 : 1;
    const otherId = startT === 0 ? spring.nodeB : spring.nodeA;
    const other = world.nodeMap.get(otherId);
    if (!other) continue;

    const dx = other.x - node.x;
    const dy = other.y - node.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) continue;
    const ux = dx / d;
    const uy = dy / d;

    let score = (agent.rng.next() - 0.5) * JUNCTION_NOISE;
    score += agent.genome.headingInertia * (headUx * ux + headUy * uy);
    score += agent.genome.hubAttraction * (homeUx * ux + homeUy * uy);
    score +=
      spring.ownerAgentId === agent.id
        ? agent.genome.ownSilkPreference
        : -agent.genome.ownSilkPreference;

    const strain = springStrain(world, springId);
    if (strain !== null) {
      score += agent.genome.tensionPreference * clamp(strain * 8, -1, 1);
    }

    if (score > bestScore) {
      bestScore = score;
      bestId = springId;
      bestStartT = startT;
    }
  }

  if (bestId >= 0) {
    agent.currentSpringId = bestId;
    agent.tOnSpring = bestStartT;
    agent.direction = bestStartT === 0 ? 1 : -1;
  } else {
    agent.direction *= -1;
  }
}

// ========== FALL (dragline ballistics) ==========

function updateFall(
  agent: Agent,
  state: SimulationState,
  config: Config,
  controls: SimulationControls,
  dt: number,
): void {
  const gravity = DROP_GRAVITY * agent.genome.gravityScale;
  agent.vy += gravity * (dt / 16);
  agent.vx *= 0.996;
  agent.vy *= 0.999;

  const nextX = agent.x + agent.vx * (dt / 16);
  const nextY = agent.y + agent.vy * (dt / 16);

  agent.energy -=
    config.costDropPixel *
    Math.hypot(agent.vx, agent.vy) *
    agent.genome.bodyMass;
  if (controls.immortality) agent.energy = Math.max(1, agent.energy);

  // Ray-cast against own silk and the substrate
  let hit: LandingHit | null = null;
  let minDist = Number.POSITIVE_INFINITY;

  for (const spring of state.world.springs) {
    if (spring.broken) continue;
    if (spring.ownerAgentId !== agent.id && spring.ownerAgentId !== -1)
      continue;

    const nodeA = state.world.nodeMap.get(spring.nodeA);
    const nodeB = state.world.nodeMap.get(spring.nodeB);
    if (!nodeA || !nodeB) continue;

    const result = getIntersection(
      agent.x,
      agent.y,
      nextX,
      nextY,
      nodeA.x,
      nodeA.y,
      nodeB.x,
      nodeB.y,
    );
    if (!result || !agent.dropStartPos) continue;

    const distFromStart = Math.hypot(
      result.x - agent.dropStartPos.x,
      result.y - agent.dropStartPos.y,
    );
    if (distFromStart <= 2) continue;

    const distToHit = Math.hypot(result.x - agent.x, result.y - agent.y);
    if (distToHit < minDist) {
      minDist = distToHit;
      hit = {
        springId: spring.id,
        x: result.x,
        y: result.y,
        isFrame: spring.ownerAgentId === -1,
      };
    }
  }

  // Leaving the arena: the dragline catches the boundary substrate.
  if (!hit) {
    if (nextY >= state.height)
      hit = {
        springId: -2,
        x: clamp(nextX, 0, state.width),
        y: state.height,
        isFrame: true,
      };
    else if (nextY <= 0)
      hit = {
        springId: -2,
        x: clamp(nextX, 0, state.width),
        y: 0,
        isFrame: true,
      };
    else if (nextX <= 0)
      hit = {
        springId: -2,
        x: 0,
        y: clamp(nextY, 0, state.height),
        isFrame: true,
      };
    else if (nextX >= state.width)
      hit = {
        springId: -2,
        x: state.width,
        y: clamp(nextY, 0, state.height),
        isFrame: true,
      };
  }

  if (hit) {
    handleLanding(agent, state, hit);
  } else {
    agent.x = nextX;
    agent.y = nextY;
  }
}

function paramOnSpring(
  state: SimulationState,
  springId: number,
  x: number,
  y: number,
): number {
  const spring = state.world.springMap.get(springId);
  if (!spring) return 0.5;
  const nodeA = state.world.nodeMap.get(spring.nodeA);
  const nodeB = state.world.nodeMap.get(spring.nodeB);
  if (!nodeA || !nodeB) return 0.5;
  const dx = nodeB.x - nodeA.x;
  const dy = nodeB.y - nodeA.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-6) return 0.5;
  return clamp(((x - nodeA.x) * dx + (y - nodeA.y) * dy) / lenSq, 0, 1);
}

function handleLanding(
  agent: Agent,
  state: SimulationState,
  hit: LandingHit,
): void {
  const landX = hit.x;
  const landY = hit.y;
  const start = agent.dropStartPos;

  const silkType: SilkType =
    agent.silkMode === 'capture' ? 'capture' : 'radial';
  const silk = getSilkProfile(silkType);
  const lineColor =
    silkType === 'capture'
      ? agent.webColor
      : agent.webColor.replace(/0\.4\)$/, '0.7)');

  if (start) {
    const length = Math.hypot(landX - start.x, landY - start.y);
    const worthSpinning =
      length >= MIN_THREAD_LENGTH &&
      !isCrowded(start.x, start.y, landX, landY, agent, state);

    if (worthSpinning) {
      // Start attachment: resolved when the drop began.
      let startNodeId: number | undefined;
      if (
        agent.dropStartNodeId != null &&
        state.world.nodeMap.has(agent.dropStartNodeId)
      ) {
        startNodeId = agent.dropStartNodeId;
      }

      // End attachment: split whatever was hit at the point of contact.
      let endNodeId: number | undefined;
      if (hit.springId >= 0) {
        const t = paramOnSpring(state, hit.springId, landX, landY);
        const id = attachmentNode(state.world, hit.springId, t);
        if (id != null) endNodeId = id;
      } else if (hit.springId === -2) {
        const frameHit = findNearestFrameSpring(state.world, landX, landY);
        if (frameHit) {
          const id = attachmentNode(state.world, frameHit.springId, frameHit.t);
          if (id != null) endNodeId = id;
        }
      }

      const thread = createSubdividedThread(
        state.world,
        start.x,
        start.y,
        landX,
        landY,
        silk,
        silkType,
        agent.id,
        lineColor,
        startNodeId,
        endNodeId,
      );
      agent.threadIds.push(thread.id);
      agent.silkSpent += length;

      const lastSpringId = thread.springIds[thread.springIds.length - 1];
      if (lastSpringId != null) {
        agent.currentSpringId = lastSpringId;
        agent.tOnSpring = 1;
        // Walk back along the thread just spun.
        agent.direction = -1;
        agent.state = 'crawling';
        agent.x = landX;
        agent.y = landY;
        finishLanding(agent);
        return;
      }
    }
  }

  // Nothing was spun: just settle onto whatever was reached.
  agent.state = 'crawling';
  agent.x = landX;
  agent.y = landY;

  const settled = state.world.springMap.get(hit.springId);
  if (hit.springId >= 0 && settled && !settled.broken) {
    agent.currentSpringId = hit.springId;
    agent.tOnSpring = paramOnSpring(state, hit.springId, landX, landY);
  } else {
    const nearest = findNearestSpring(state.world, landX, landY, agent.id);
    if (nearest) {
      agent.currentSpringId = nearest.springId;
      agent.tOnSpring = nearest.t;
    }
  }

  agent.direction = agent.rng.sign();
  finishLanding(agent);
}

function finishLanding(agent: Agent): void {
  agent.distanceSinceAttach = 0;
  agent.dropStartPos = null;
  agent.dropStartNodeId = null;
  agent.vx = 0;
  agent.vy = 0;
}

function isCrowded(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  agent: Agent,
  state: SimulationState,
): boolean {
  if (countAgentSprings(state.world, agent.id) > 400) return true;

  const midX = (startX + endX) * 0.5;
  const midY = (startY + endY) * 0.5;

  for (const spring of state.world.springs) {
    if (spring.broken) continue;
    if (spring.ownerAgentId !== agent.id && spring.ownerAgentId !== -1)
      continue;

    const nodeA = state.world.nodeMap.get(spring.nodeA);
    const nodeB = state.world.nodeMap.get(spring.nodeB);
    if (!nodeA || !nodeB) continue;

    const d = distToSegment(midX, midY, nodeA.x, nodeA.y, nodeB.x, nodeB.y);
    if (d < 4) return true;
  }

  return false;
}
