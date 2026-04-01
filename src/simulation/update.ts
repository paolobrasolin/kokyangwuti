import type { Agent, SilkType, SimulationControls, SimulationState } from '../types';
import type { Config } from '../config';
import { distToSegment, getIntersection } from '../geometry';
import { getSilkProfile } from './lifecycle';
import { PHYSICS } from '../physics/config';
import { stepPhysics, applyForceToSpring } from '../physics/solver';
import {
  createSubdividedThread,
  findNearestSpring,
  findNearestFrameSpring,
  splitFrameSpring,
  getConnectedSprings,
  rayVsSprings,
  applyImpulse,
  cleanup,
  countAgentSprings,
} from '../physics/world';

export interface UpdateMetrics {
  activeCount: number;
  totalEnergy: number;
  timerMs: number;
}

// --- Fly types ---

interface Fly {
  start: { x: number; y: number };
  end: { x: number; y: number };
  heading: { x: number; y: number };
  mass: number;
  speed: number;
  energy: number;
}

interface ImpactHit {
  springId: number;
  point: { x: number; y: number };
  t: number;
}

// --- Constants ---

const EXPLORE_DROP_RATE = 0.015;
const NAVIGATION_TIMEOUT = 300; // ticks before giving up on navigation
const HUB_ARRIVAL_DIST = 30;
const SPIRAL_RADIUS_TOLERANCE = 20;

let cleanupCounter = 0;

// ========== MAIN TICK ==========

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

  // Run physics solver
  if (controls.simSpeed < PHYSICS.skipPhysicsSpeed) {
    const iterations = controls.simSpeed >= PHYSICS.reducedIterationsSpeed
      ? PHYSICS.reducedIterations
      : PHYSICS.constraintIterations;

    for (const agent of state.agents) {
      if (!agent.alive || agent.state !== 'crawling') continue;
      const spring = state.world.springMap.get(agent.currentSpringId);
      if (!spring || spring.broken) continue;
      const weight = agent.genome.bodyMass * PHYSICS.spiderMassMultiplier;
      applyForceToSpring(state.world, agent.currentSpringId, agent.tOnSpring, 0, weight);
    }

    stepPhysics(state.world, dt, iterations);
  }

  let activeCount = 0;
  let totalEnergy = 0;

  state.agents.forEach((agent) => {
    agent.fliesCaught = agent.fliesCaught
      .map((fly) => ({ ...fly, ageMs: fly.ageMs + dt }))
      .filter((fly) => fly.ageMs < 6000);

    if (!agent.alive) return;
    activeCount += 1;
    totalEnergy += agent.energy;

    const drain = config.baselineEnergyDrain * (dt / 16) * agent.genome.bodyMass;
    agent.energy = controls.immortality ? Math.max(1, agent.energy - drain) : agent.energy - drain;
    if (agent.energy <= 0) {
      if (controls.immortality) {
        agent.energy = 1;
      } else {
        agent.alive = false;
        agent.energy = 0;
        return;
      }
    }

    if (agent.state === 'crawling') updateCrawl(agent, state, config, controls, dt);
    else updateFall(agent, state, config, controls, dt);
  });

  cleanupCounter++;
  if (cleanupCounter >= PHYSICS.cleanupInterval) {
    cleanupCounter = 0;
    cleanup(state.world);
  }

  return { activeCount, totalEnergy, timerMs: state.genTimer };
}

// ========== CRAWL (phase-aware) ==========

function updateCrawl(
  agent: Agent,
  state: SimulationState,
  config: Config,
  controls: SimulationControls,
  dt: number,
): void {
  const spring = state.world.springMap.get(agent.currentSpringId);
  if (!spring || spring.broken) {
    const nearest = findNearestSpring(state.world, agent.x, agent.y);
    if (nearest) {
      agent.currentSpringId = nearest.springId;
      agent.tOnSpring = nearest.t;
    } else {
      return;
    }
  }

  const currentSpring = state.world.springMap.get(agent.currentSpringId)!;
  const nodeA = state.world.nodeMap.get(currentSpring.nodeA);
  const nodeB = state.world.nodeMap.get(currentSpring.nodeB);
  if (!nodeA || !nodeB) return;

  // Move along spring
  const len = Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);
  const speed = (2 + agent.genome.speed * 2) * (dt / 16);
  const tStep = len > 0 ? speed / len : 0;

  agent.tOnSpring += tStep * agent.direction;

  const clampedT = Math.max(0, Math.min(1, agent.tOnSpring));
  agent.x = nodeA.x + (nodeB.x - nodeA.x) * clampedT;
  agent.y = nodeA.y + (nodeB.y - nodeA.y) * clampedT;
  agent.energy -= config.costCrawl * speed * agent.genome.bodyMass;
  if (controls.immortality) agent.energy = Math.max(1, agent.energy);

  // Increment navigation timer
  if (agent.crawlTarget) {
    agent.crawlTimer += dt / 16;
  }

  // Junction: reached end of spring
  if (agent.tOnSpring <= 0 || agent.tOnSpring >= 1) {
    agent.tOnSpring = agent.tOnSpring <= 0 ? 0 : 1;
    const arrivedNodeId = agent.tOnSpring === 0 ? currentSpring.nodeA : currentSpring.nodeB;
    navigateJunction(agent, state, arrivedNodeId);
  }

  // Phase-specific triggers
  handleCrawlPhase(agent, state, config, controls, dt);
}

function navigateJunction(agent: Agent, state: SimulationState, arrivedNodeId: number): void {
  const connectedSpringIds = getConnectedSprings(state.world, arrivedNodeId);
  const options: Array<{ springId: number; startT: number; score: number }> = [];

  for (const sid of connectedSpringIds) {
    if (sid === agent.currentSpringId) continue;
    const s = state.world.springMap.get(sid);
    if (!s || s.broken) continue;
    if (s.ownerAgentId !== agent.id && s.ownerAgentId !== -1) continue;

    const startT = s.nodeA === arrivedNodeId ? 0 : 1;
    const otherNodeId = s.nodeA === arrivedNodeId ? s.nodeB : s.nodeA;
    const otherNode = state.world.nodeMap.get(otherNodeId);
    if (!otherNode) continue;

    let score = Math.random() * 0.3; // base randomness

    if (agent.crawlTarget) {
      // Bias toward crawl target
      const dx = agent.crawlTarget.x - agent.x;
      const dy = agent.crawlTarget.y - agent.y;
      const targetDist = Math.hypot(dx, dy);
      if (targetDist > 1) {
        const sdx = otherNode.x - agent.x;
        const sdy = otherNode.y - agent.y;
        const sDist = Math.hypot(sdx, sdy);
        if (sDist > 1) {
          const dot = (dx * sdx + dy * sdy) / (targetDist * sDist);
          score += dot * 2.0; // strong directional bias
        }
      }
    }

    options.push({ springId: sid, startT, score });
  }

  if (options.length > 0) {
    // Pick the highest-scoring option
    options.sort((a, b) => b.score - a.score);
    const next = options[0];
    agent.currentSpringId = next.springId;
    agent.tOnSpring = next.startT;
    agent.direction = next.startT === 0 ? 1 : -1;
  } else {
    agent.direction *= -1;
  }
}

function handleCrawlPhase(
  agent: Agent,
  state: SimulationState,
  config: Config,
  _controls: SimulationControls,
  dt: number,
): void {
  switch (agent.buildPhase) {
    case 'explore':
      handleExplorePhase(agent, state, config, dt);
      break;
    case 'radial':
      handleRadialCrawl(agent, state, config, dt);
      break;
    case 'spiral':
      handleSpiralCrawl(agent, state, config, dt);
      break;
    case 'done':
      // Just crawl around slowly near hub, no drops
      break;
  }
}

// --- EXPLORE phase ---

function handleExplorePhase(
  agent: Agent,
  state: SimulationState,
  config: Config,
  dt: number,
): void {
  // Check if we have enough anchors to establish hub
  if (agent.anchorPoints.length >= Math.round(agent.genome.anchorCount)) {
    transitionToRadial(agent, state);
    return;
  }

  // Random drop during exploration
  const dropProb = 1 - (1 - EXPLORE_DROP_RATE) ** (dt / 16);
  if (Math.random() < dropProb) {
    initExploreDrop(agent, state, config);
  }
}

function initExploreDrop(agent: Agent, state: SimulationState, config: Config): void {
  agent.state = 'falling';
  agent.dropStartPos = { x: agent.x, y: agent.y };

  // Aim roughly toward center with randomness
  const center = { x: state.width * 0.5, y: state.height * 0.5 };
  const toCenter = { x: center.x - agent.x, y: center.y - agent.y };
  const baseAngle = Math.atan2(toCenter.y, toCenter.x);
  const angle = baseAngle + (Math.random() - 0.5) * 1.5;
  const dropSpeed = Math.max(state.width, state.height) * 0.08;

  agent.vx = Math.cos(angle) * dropSpeed;
  agent.vy = Math.sin(angle) * dropSpeed;
  agent.energy -= config.costDropStart * agent.genome.bodyMass;
}

function transitionToRadial(agent: Agent, state: SimulationState): void {
  // Compute hub as centroid of anchor points
  let sumX = 0;
  let sumY = 0;
  for (const p of agent.anchorPoints) {
    sumX += p.x;
    sumY += p.y;
  }
  const n = agent.anchorPoints.length;
  agent.hubX = Math.max(state.width * 0.15, Math.min(state.width * 0.85, sumX / n));
  agent.hubY = Math.max(state.height * 0.15, Math.min(state.height * 0.85, sumY / n));

  // Compute web radius as average distance from hub to anchors
  let totalDist = 0;
  for (const p of agent.anchorPoints) {
    totalDist += Math.hypot(p.x - agent.hubX, p.y - agent.hubY);
  }
  agent.webRadius = Math.max(50, totalDist / n);

  agent.buildPhase = 'radial';
  agent.currentAngle = Math.random() * Math.PI * 2;
  agent.radialsBuilt = 0;

  // Start navigating to hub
  agent.crawlTarget = { x: agent.hubX, y: agent.hubY };
  agent.crawlTimer = 0;
}

// --- RADIAL phase ---

function handleRadialCrawl(
  agent: Agent,
  state: SimulationState,
  config: Config,
  _dt: number,
): void {
  if (agent.radialsBuilt >= agent.genome.radialCount) {
    transitionToSpiral(agent);
    return;
  }

  const distToHub = Math.hypot(agent.x - agent.hubX, agent.y - agent.hubY);

  if (agent.crawlTarget) {
    // Navigating to hub
    if (distToHub < HUB_ARRIVAL_DIST || agent.crawlTimer > NAVIGATION_TIMEOUT) {
      // Arrived at hub (or timed out) — drop outward
      if (agent.crawlTimer > NAVIGATION_TIMEOUT) {
        // Use current position as effective hub
        agent.hubX = agent.x;
        agent.hubY = agent.y;
      }
      agent.crawlTarget = null;
      agent.crawlTimer = 0;
      initRadialDrop(agent, state, config);
    }
  } else {
    // Shouldn't be here without crawlTarget in radial phase — set it
    agent.crawlTarget = { x: agent.hubX, y: agent.hubY };
    agent.crawlTimer = 0;
  }
}

function initRadialDrop(agent: Agent, _state: SimulationState, config: Config): void {
  agent.state = 'falling';
  agent.dropStartPos = { x: agent.x, y: agent.y };

  const noise = (Math.random() - 0.5) * (1 - agent.genome.buildPrecision) * 0.6;
  const angle = agent.currentAngle + noise;

  // Speed enough to cover webRadius
  const dropSpeed = agent.webRadius * 0.12;

  agent.vx = Math.cos(angle) * dropSpeed;
  agent.vy = Math.sin(angle) * dropSpeed;
  agent.energy -= config.costDropStart * agent.genome.bodyMass;
}

// --- SPIRAL phase ---

function transitionToSpiral(agent: Agent): void {
  agent.buildPhase = 'spiral';
  agent.spiralRadius = agent.genome.hubSize * agent.webRadius;
  agent.spiralAngle = 0;

  // Navigate to first spiral position
  setSpiralCrawlTarget(agent);
}

function setSpiralCrawlTarget(agent: Agent): void {
  const targetX = agent.hubX + Math.cos(agent.spiralAngle) * agent.spiralRadius;
  const targetY = agent.hubY + Math.sin(agent.spiralAngle) * agent.spiralRadius;
  agent.crawlTarget = { x: targetX, y: targetY };
  agent.crawlTimer = 0;
}

function handleSpiralCrawl(
  agent: Agent,
  state: SimulationState,
  config: Config,
  _dt: number,
): void {
  if (agent.spiralRadius >= agent.webRadius * 0.85) {
    agent.buildPhase = 'done';
    agent.crawlTarget = null;
    return;
  }

  if (agent.crawlTarget) {
    const distFromHub = Math.hypot(agent.x - agent.hubX, agent.y - agent.hubY);
    const atTargetRadius = distFromHub >= agent.spiralRadius - SPIRAL_RADIUS_TOLERANCE;
    const atTarget = Math.hypot(agent.x - agent.crawlTarget.x, agent.y - agent.crawlTarget.y) < SPIRAL_RADIUS_TOLERANCE;

    if (atTarget || atTargetRadius || agent.crawlTimer > NAVIGATION_TIMEOUT) {
      agent.crawlTarget = null;
      agent.crawlTimer = 0;
      initSpiralDrop(agent, state, config);
    }
  } else {
    // Set target for next spiral position
    setSpiralCrawlTarget(agent);
  }
}

function initSpiralDrop(agent: Agent, _state: SimulationState, config: Config): void {
  agent.state = 'falling';
  agent.dropStartPos = { x: agent.x, y: agent.y };

  // Aim toward next radial at current spiral radius
  const dAngle = (2 * Math.PI) / agent.genome.radialCount;
  const nextAngle = agent.spiralAngle + dAngle;
  const targetX = agent.hubX + Math.cos(nextAngle) * agent.spiralRadius;
  const targetY = agent.hubY + Math.sin(nextAngle) * agent.spiralRadius;

  const dx = targetX - agent.x;
  const dy = targetY - agent.y;
  const dist = Math.max(1, Math.hypot(dx, dy));

  const noise = (Math.random() - 0.5) * (1 - agent.genome.buildPrecision) * 0.4;
  const dropSpeed = dist * 0.12;

  agent.vx = (dx / dist) * dropSpeed + noise;
  agent.vy = (dy / dist) * dropSpeed + noise;
  agent.energy -= config.costDropStart * agent.genome.bodyMass * 0.5; // spiral drops are cheaper
}

// ========== FALL (phase-aware landing) ==========

function updateFall(
  agent: Agent,
  state: SimulationState,
  config: Config,
  controls: SimulationControls,
  dt: number,
): void {
  const gravity = 0.3 * agent.genome.gravityScale;
  agent.vy += gravity * (dt / 16);
  agent.vx *= 0.996;
  agent.vy *= 0.999;

  const nextX = agent.x + agent.vx * (dt / 16);
  const nextY = agent.y + agent.vy * (dt / 16);

  agent.energy -= config.costDropPixel * Math.hypot(agent.vx, agent.vy) * agent.genome.bodyMass;
  if (controls.immortality) agent.energy = Math.max(1, agent.energy);

  // Ray-cast against springs
  let hit: { springId: number; x: number; y: number; isFrame: boolean } | null = null;
  let minDist = Infinity;

  for (const spring of state.world.springs) {
    if (spring.broken) continue;
    if (spring.ownerAgentId !== agent.id && spring.ownerAgentId !== -1) continue;

    const nodeA = state.world.nodeMap.get(spring.nodeA);
    const nodeB = state.world.nodeMap.get(spring.nodeB);
    if (!nodeA || !nodeB) continue;

    const result = getIntersection(
      agent.x, agent.y, nextX, nextY,
      nodeA.x, nodeA.y, nodeB.x, nodeB.y,
    );
    if (result && agent.dropStartPos) {
      const distFromStart = Math.hypot(result.x - agent.dropStartPos.x, result.y - agent.dropStartPos.y);
      if (distFromStart > 2) {
        const distToHit = Math.hypot(result.x - agent.x, result.y - agent.y);
        if (distToHit < minDist) {
          minDist = distToHit;
          hit = { springId: spring.id, x: result.x, y: result.y, isFrame: spring.ownerAgentId === -1 };
        }
      }
    }
  }

  // Hub check
  if (!hit) {
    const hub = { x: agent.hubX, y: agent.hubY };
    const distToHub = distToSegment(hub.x, hub.y, agent.x, agent.y, nextX, nextY);
    if (distToHub < 18 && agent.threadIds.length > 0) {
      hit = { springId: -1, x: hub.x, y: hub.y, isFrame: false };
    }
  }

  // Out of bounds
  if (!hit) {
    if (nextY >= state.height) hit = { springId: -2, x: nextX, y: state.height, isFrame: true };
    else if (nextX <= 0) hit = { springId: -2, x: 0, y: nextY, isFrame: true };
    else if (nextX >= state.width) hit = { springId: -2, x: state.width, y: nextY, isFrame: true };
  }

  if (hit) {
    handleLanding(agent, state, config, hit);
  } else {
    agent.x = nextX;
    agent.y = nextY;
  }
}

function handleLanding(
  agent: Agent,
  state: SimulationState,
  _config: Config,
  hit: { springId: number; x: number; y: number; isFrame: boolean },
): void {
  const landX = hit.x;
  const landY = hit.y;

  // Determine silk type based on build phase
  let silkType: SilkType;
  switch (agent.buildPhase) {
    case 'spiral':
      silkType = 'capture';
      break;
    default:
      silkType = 'radial';
      break;
  }

  const silk = getSilkProfile(silkType);
  const lineColor = silkType === 'capture'
    ? agent.webColor
    : agent.webColor.replace(/0\.4\)$/, '0.7)');

  // Create thread from drop start to landing
  if (agent.dropStartPos) {
    const crowded = hit.springId !== -1 && isCrowded(
      agent.dropStartPos.x, agent.dropStartPos.y,
      landX, landY,
      agent, state,
    );

    if (!crowded) {
      // Find or create attachment nodes
      let startNodeId: number | undefined;
      let endNodeId: number | undefined;

      // Start attachment
      const startFrameHit = findNearestFrameSpring(state.world, agent.dropStartPos.x, agent.dropStartPos.y);
      if (startFrameHit && startFrameHit.t > 0.01 && startFrameHit.t < 0.99) {
        const dist = Math.hypot(agent.dropStartPos.x - startFrameHit.x, agent.dropStartPos.y - startFrameHit.y);
        if (dist < 5) {
          startNodeId = splitFrameSpring(state.world, startFrameHit.springId, startFrameHit.t);
          if (startNodeId === -1) startNodeId = undefined;
        }
      }
      if (startNodeId == null) {
        const nearStart = findNearestSpring(state.world, agent.dropStartPos.x, agent.dropStartPos.y);
        if (nearStart && nearStart.dist < 3) {
          const ns = state.world.springMap.get(nearStart.springId);
          if (ns) startNodeId = nearStart.t < 0.5 ? ns.nodeA : ns.nodeB;
        }
      }

      // End attachment
      if (hit.springId >= 0) {
        const hitSpring = state.world.springMap.get(hit.springId);
        if (hitSpring && hitSpring.ownerAgentId === -1) {
          const na = state.world.nodeMap.get(hitSpring.nodeA)!;
          const nb = state.world.nodeMap.get(hitSpring.nodeB)!;
          const bx = nb.x - na.x;
          const by = nb.y - na.y;
          const blenSq = bx * bx + by * by;
          const paramT = blenSq > 0
            ? Math.max(0.01, Math.min(0.99, ((landX - na.x) * bx + (landY - na.y) * by) / blenSq))
            : 0.5;
          endNodeId = splitFrameSpring(state.world, hit.springId, paramT);
          if (endNodeId === -1) endNodeId = undefined;
        } else if (hitSpring) {
          const nearEnd = findNearestSpring(state.world, landX, landY);
          if (nearEnd && nearEnd.dist < 3) {
            const ns = state.world.springMap.get(nearEnd.springId);
            if (ns) endNodeId = nearEnd.t < 0.5 ? ns.nodeA : ns.nodeB;
          }
        }
      } else if (hit.springId === -2) {
        const frameHit = findNearestFrameSpring(state.world, landX, landY);
        if (frameHit && frameHit.t > 0.01 && frameHit.t < 0.99) {
          endNodeId = splitFrameSpring(state.world, frameHit.springId, frameHit.t);
          if (endNodeId === -1) endNodeId = undefined;
        }
      }

      const thread = createSubdividedThread(
        state.world,
        agent.dropStartPos.x, agent.dropStartPos.y,
        landX, landY,
        silk, silkType,
        agent.id,
        lineColor,
        startNodeId,
        endNodeId,
      );
      agent.threadIds.push(thread.id);

      // Record anchor points (endpoints on frame/branches)
      if (hit.isFrame || hit.springId === -2) {
        agent.anchorPoints.push({ x: landX, y: landY });
      }
      // Also record start if it was on frame
      const startSpring = state.world.springMap.get(agent.currentSpringId);
      if (startSpring && startSpring.ownerAgentId === -1 && agent.dropStartPos) {
        agent.anchorPoints.push({ x: agent.dropStartPos.x, y: agent.dropStartPos.y });
      }

      // Land on the last spring of the new thread
      const lastSpringId = thread.springIds[thread.springIds.length - 1];
      if (lastSpringId != null) {
        agent.currentSpringId = lastSpringId;
        agent.tOnSpring = 1;
        agent.state = 'crawling';
        agent.x = landX;
        agent.y = landY;
        handlePostLanding(agent, state);
        return;
      }
    }
  }

  // Default: land on hit spring or nearest
  agent.state = 'crawling';
  agent.x = landX;
  agent.y = landY;

  if (hit.springId >= 0) {
    agent.currentSpringId = hit.springId;
    const hs = state.world.springMap.get(hit.springId);
    if (hs) {
      const na = state.world.nodeMap.get(hs.nodeA);
      const nb = state.world.nodeMap.get(hs.nodeB);
      if (na && nb) {
        const sdx = nb.x - na.x;
        const sdy = nb.y - na.y;
        const slenSq = sdx * sdx + sdy * sdy;
        agent.tOnSpring = slenSq > 0
          ? Math.max(0, Math.min(1, ((landX - na.x) * sdx + (landY - na.y) * sdy) / slenSq))
          : 0;
      }
    }
  } else {
    const nearest = findNearestSpring(state.world, landX, landY);
    if (nearest) {
      agent.currentSpringId = nearest.springId;
      agent.tOnSpring = nearest.t;
    }
  }

  agent.direction = Math.random() < 0.5 ? 1 : -1;
  handlePostLanding(agent, state);
}

function handlePostLanding(agent: Agent, state: SimulationState): void {
  switch (agent.buildPhase) {
    case 'explore':
      // Check if we have enough anchors
      if (agent.anchorPoints.length >= Math.round(agent.genome.anchorCount)) {
        transitionToRadial(agent, state);
      }
      break;

    case 'radial':
      // Just built a radial — navigate back to hub for the next one
      agent.radialsBuilt++;
      agent.currentAngle += (2 * Math.PI) / agent.genome.radialCount;
      agent.crawlTarget = { x: agent.hubX, y: agent.hubY };
      agent.crawlTimer = 0;
      agent.direction = Math.random() < 0.5 ? 1 : -1;
      break;

    case 'spiral':
      // Just built a spiral segment — advance to next position
      agent.spiralAngle += (2 * Math.PI) / agent.genome.radialCount;
      // Increment radius slightly each segment (true spiral)
      agent.spiralRadius += (agent.genome.spiralSpacing * agent.webRadius) / agent.genome.radialCount;

      if (agent.spiralRadius >= agent.webRadius * 0.85) {
        agent.buildPhase = 'done';
        agent.crawlTarget = null;
      } else {
        setSpiralCrawlTarget(agent);
      }
      agent.direction = Math.random() < 0.5 ? 1 : -1;
      break;

    case 'done':
      break;
  }
}

// ========== FLY SYSTEM ==========

function attemptFlyCross(state: SimulationState, config: Config): void {
  const fly = createFly(state);

  state.agents.forEach((agent) => {
    if (!agent.alive) return;
    const hit = findImpact(fly, agent, state);
    if (!hit) return;

    const captured = resolveImpact(agent, hit, fly, state);
    if (captured) {
      agent.score += 1;
      agent.energy = Math.min(agent.energy + config.gainFly, config.startingEnergy * 3);
      agent.fliesCaught.push({ ...hit.point, ageMs: 0 });
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

function clipToViewport(fly: Fly, state: SimulationState): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  let t0 = 0;
  let t1 = 1;
  const dx = fly.end.x - fly.start.x;
  const dy = fly.end.y - fly.start.y;
  const p = [-dx, dx, -dy, dy];
  const q = [fly.start.x, state.width - fly.start.x, fly.start.y, state.height - fly.start.y];

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }

  if (t0 > t1) return null;
  return {
    start: { x: fly.start.x + t0 * dx, y: fly.start.y + t0 * dy },
    end: { x: fly.start.x + t1 * dx, y: fly.start.y + t1 * dy },
  };
}

function findImpact(fly: Fly, agent: Agent, state: SimulationState): ImpactHit | null {
  const clipped = clipToViewport(fly, state);
  if (!clipped) return null;

  const hit = rayVsSprings(
    state.world,
    clipped.start.x, clipped.start.y,
    clipped.end.x, clipped.end.y,
    agent.id,
  );

  if (!hit) return null;
  return { springId: hit.springId, point: hit.point, t: hit.t };
}

function resolveImpact(
  agent: Agent,
  hit: ImpactHit,
  fly: Fly,
  state: SimulationState,
): boolean {
  const spring = state.world.springMap.get(hit.springId);
  if (!spring || spring.broken) return false;

  const nodeA = state.world.nodeMap.get(spring.nodeA);
  const nodeB = state.world.nodeMap.get(spring.nodeB);
  if (!nodeA || !nodeB) return false;

  const lineVector = { x: nodeB.x - nodeA.x, y: nodeB.y - nodeA.y };
  const pathAngle = Math.atan2(fly.heading.y, fly.heading.x);
  const lineAngle = Math.atan2(lineVector.y, lineVector.x);
  const angleFactor = Math.abs(Math.sin(pathAngle - lineAngle));

  // Apply impulse for visible vibration
  const impulseMag = fly.mass * fly.speed * angleFactor * 0.5;
  const flyDir = Math.hypot(fly.heading.x, fly.heading.y);
  if (flyDir > 0) {
    applyImpulse(
      state.world, hit.springId, hit.t,
      (fly.heading.x / flyDir) * impulseMag,
      (fly.heading.y / flyDir) * impulseMag,
    );
  }

  // Check breaking
  const currentLen = Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);
  if (currentLen > spring.maxExtension) {
    spring.broken = true;
    return false;
  }

  // Capture calculation
  const dampingLoss = fly.energy * (0.1 + spring.damping * 0.55) * angleFactor;
  const residualEnergy = Math.max(0, fly.energy - dampingLoss);

  const supportCapacity = computeSupportCapacity(agent, state, hit.point, hit.springId);
  const lineLength = Math.max(10, Math.hypot(lineVector.x, lineVector.y));
  const axialCapacity = spring.stiffness * 1200 * (lineLength / Math.max(80, state.width * 0.4));
  const stretchAllowance = (spring.maxExtension / spring.restLength - 1) * 900 * (0.5 + angleFactor);
  const totalCapacity = axialCapacity + stretchAllowance + supportCapacity;

  const adhesionAssist = spring.adhesion * (0.6 + 0.3 * angleFactor);
  const tensionAssist = 0.25 * (spring.stiffness * 0.3);
  const stickProbability = Math.min(0.98, adhesionAssist + tensionAssist);

  const survives = residualEnergy <= totalCapacity;
  return survives && Math.random() < stickProbability;
}

function computeSupportCapacity(
  agent: Agent,
  state: SimulationState,
  point: { x: number; y: number },
  skipSpringId: number,
): number {
  let total = 0;

  for (const spring of state.world.springs) {
    if (spring.broken || spring.id === skipSpringId) continue;
    if (spring.ownerAgentId !== agent.id && spring.ownerAgentId !== -1) continue;
    if (spring.type === 'capture') continue;

    const nodeA = state.world.nodeMap.get(spring.nodeA);
    const nodeB = state.world.nodeMap.get(spring.nodeB);
    if (!nodeA || !nodeB) continue;

    const d = distToSegment(point.x, point.y, nodeA.x, nodeA.y, nodeB.x, nodeB.y);
    if (d > 35) continue;

    const lengthFactor = Math.max(
      0.5,
      Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y) / Math.max(state.width, state.height),
    );
    total += (spring.stiffness * 1200 + spring.stiffness * 450 + (spring.maxExtension / spring.restLength - 1) * 400) * lengthFactor;
  }

  return total;
}

function isCrowded(
  startX: number, startY: number, endX: number, endY: number,
  agent: Agent, state: SimulationState,
): boolean {
  if (countAgentSprings(state.world, agent.id) > 400) return true;
  const bottomLimit = state.height * 0.95;
  if (startY > bottomLimit && endY > bottomLimit) return true;

  const midX = (startX + endX) * 0.5;
  const midY = (startY + endY) * 0.5;

  for (const spring of state.world.springs) {
    if (spring.broken) continue;
    if (spring.ownerAgentId !== agent.id && spring.ownerAgentId !== -1) continue;

    const nodeA = state.world.nodeMap.get(spring.nodeA);
    const nodeB = state.world.nodeMap.get(spring.nodeB);
    if (!nodeA || !nodeB) continue;

    const d = distToSegment(midX, midY, nodeA.x, nodeA.y, nodeB.x, nodeB.y);
    if (d < 4) return true;
  }

  return false;
}
