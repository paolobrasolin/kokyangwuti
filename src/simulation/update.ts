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

interface Fly {
  start: { x: number; y: number };
  end: { x: number; y: number };
  heading: { x: number; y: number };
  mass: number;
  speed: number;
  energy: number;
}

let cleanupCounter = 0;

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

  // Run physics solver (skip at very high speeds)
  if (controls.simSpeed < PHYSICS.skipPhysicsSpeed) {
    const iterations = controls.simSpeed >= PHYSICS.reducedIterationsSpeed
      ? PHYSICS.reducedIterations
      : PHYSICS.constraintIterations;

    // Apply spider weight forces before stepping
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

  // Periodic cleanup
  cleanupCounter++;
  if (cleanupCounter >= PHYSICS.cleanupInterval) {
    cleanupCounter = 0;
    cleanup(state.world);
  }

  return { activeCount, totalEnergy, timerMs: state.genTimer };
}

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
  const sx = fly.start.x + t0 * dx;
  const sy = fly.start.y + t0 * dy;
  const ex = fly.start.x + t1 * dx;
  const ey = fly.start.y + t1 * dy;
  return { start: { x: sx, y: sy }, end: { x: ex, y: ey } };
}

interface ImpactHit {
  springId: number;
  point: { x: number; y: number };
  t: number; // parametric t on the spring
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

  // Calculate impact angle
  const lineVector = { x: nodeB.x - nodeA.x, y: nodeB.y - nodeA.y };
  const pathAngle = Math.atan2(fly.heading.y, fly.heading.x);
  const lineAngle = Math.atan2(lineVector.y, lineVector.x);
  const angleFactor = Math.abs(Math.sin(pathAngle - lineAngle));

  // Apply impulse to the spring (visible vibration!)
  const impulseMag = fly.mass * fly.speed * angleFactor * 0.5;
  const flyDir = Math.hypot(fly.heading.x, fly.heading.y);
  if (flyDir > 0) {
    applyImpulse(
      state.world,
      hit.springId,
      hit.t,
      (fly.heading.x / flyDir) * impulseMag,
      (fly.heading.y / flyDir) * impulseMag,
    );
  }

  // Check if spring breaks from impulse
  const nodeAAfter = state.world.nodeMap.get(spring.nodeA)!;
  const nodeBAfter = state.world.nodeMap.get(spring.nodeB)!;
  const currentLen = Math.hypot(nodeBAfter.x - nodeAAfter.x, nodeBAfter.y - nodeAAfter.y);
  if (currentLen > spring.maxExtension) {
    spring.broken = true;
    return false; // fly escapes
  }

  // Damping loss
  const dampingLoss = fly.energy * (0.1 + spring.damping * 0.55) * angleFactor;
  const residualEnergy = Math.max(0, fly.energy - dampingLoss);

  // Support capacity from nearby springs
  const supportCapacity = computeSupportCapacity(agent, state, hit.point, hit.springId);
  const lineLength = Math.max(10, Math.hypot(lineVector.x, lineVector.y));
  const axialCapacity = spring.stiffness * 1200 * (lineLength / Math.max(80, state.width * 0.4));
  const stretchAllowance = (spring.maxExtension / spring.restLength - 1) * 900 * (0.5 + angleFactor);
  const totalCapacity = axialCapacity + stretchAllowance + supportCapacity;

  const adhesionAssist = spring.adhesion * (0.6 + 0.3 * angleFactor);
  const tensionAssist = 0.25 * (spring.stiffness * 0.3);
  const stickProbability = Math.min(0.98, adhesionAssist + tensionAssist);

  const survives = residualEnergy <= totalCapacity;
  const caught = survives && Math.random() < stickProbability;

  if (caught && spring.type === 'capture') {
    const aerodynamicLoss = fly.energy * (0.05 + spring.damping * 0.2);
    agent.energy = Math.max(0, agent.energy - aerodynamicLoss * 0.01);
  }

  return caught;
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
  if (countAgentSprings(state.world, agent.id) > 220) return true;
  const bottomLimit = state.height * 0.9;
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
    if (d < 6) return true;
  }

  return false;
}

function updateCrawl(
  agent: Agent,
  state: SimulationState,
  config: Config,
  controls: SimulationControls,
  dt: number,
): void {
  const spring = state.world.springMap.get(agent.currentSpringId);
  if (!spring || spring.broken) {
    // Spring broke under us — find nearest spring to stand on
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

  const len = Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);
  const speed = (2 + agent.genome.speed * 2) * (dt / 16);
  const tStep = len > 0 ? speed / len : 0;

  agent.tOnSpring += tStep * agent.direction;

  // Interpolate position from spring nodes
  const clampedT = Math.max(0, Math.min(1, agent.tOnSpring));
  agent.x = nodeA.x + (nodeB.x - nodeA.x) * clampedT;
  agent.y = nodeA.y + (nodeB.y - nodeA.y) * clampedT;
  agent.energy -= config.costCrawl * speed * agent.genome.bodyMass;
  if (controls.immortality) agent.energy = Math.max(1, agent.energy);

  if (agent.tOnSpring <= 0 || agent.tOnSpring >= 1) {
    agent.tOnSpring = agent.tOnSpring <= 0 ? 0 : 1;

    // Determine which node we arrived at
    const arrivedNodeId = agent.tOnSpring === 0 ? currentSpring.nodeA : currentSpring.nodeB;

    // Find all connected springs at this node (topological, not distance-based)
    const connectedSpringIds = getConnectedSprings(state.world, arrivedNodeId);
    const options: Array<{ springId: number; startT: number; isUp?: boolean }> = [];

    for (const sid of connectedSpringIds) {
      if (sid === agent.currentSpringId) continue;
      const s = state.world.springMap.get(sid);
      if (!s || s.broken) continue;
      // Only traverse own springs or frame springs
      if (s.ownerAgentId !== agent.id && s.ownerAgentId !== -1) continue;

      // Determine which end of the connected spring we're at
      const startT = s.nodeA === arrivedNodeId ? 0 : 1;
      const otherNodeId = s.nodeA === arrivedNodeId ? s.nodeB : s.nodeA;
      const otherNode = state.world.nodeMap.get(otherNodeId);
      const isUp = otherNode ? otherNode.y < agent.y : false;

      options.push({ springId: sid, startT, isUp });
    }

    if (options.length > 0) {
      const wantUp = Math.random() > agent.genome.bias;
      const preferred = options.filter((o) => o.isUp === wantUp);
      const candidates = preferred.length > 0 ? preferred : options;
      const next = candidates[Math.floor(Math.random() * candidates.length)];

      agent.currentSpringId = next.springId;
      agent.tOnSpring = next.startT;
      agent.direction = next.startT === 0 ? 1 : -1;
    } else {
      agent.direction *= -1;
    }
  }

  const dropProb = 1 - (1 - agent.genome.dropRate) ** (dt / 16);
  if (Math.random() < dropProb) {
    agent.state = 'falling';
    agent.dropStartPos = { x: agent.x, y: agent.y };

    const center = { x: state.width * 0.5, y: state.height * 0.5 };
    const toHub = { x: center.x - agent.x, y: center.y - agent.y };
    const hubLen = Math.max(1, Math.hypot(toHub.x, toHub.y));
    const radial = { x: toHub.x / hubLen, y: toHub.y / hubLen };
    const tangential = { x: -radial.y, y: radial.x };
    const radialFactor = 0.35 * agent.genome.radialPreference;
    const spiralFactor = 0.6 + agent.genome.spiralDrift * 0.6;
    const glideGain = 1 + agent.genome.glide * 0.5;
    const jumpGain = 1 + agent.genome.jumpPower;

    const vxBase = radial.x * radialFactor + tangential.x * spiralFactor;
    const vyBase = radial.y * radialFactor + tangential.y * spiralFactor;
    const jitter = (Math.random() - 0.5) * 0.3;

    agent.vx = (vxBase + jitter) * glideGain * jumpGain * 3;
    agent.vy = (vyBase + jitter) * glideGain * jumpGain * 2.4;
    agent.energy -= config.costDropStart * agent.genome.bodyMass;
  }
}

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

  // Ray-cast against springs (frame + own agent's springs)
  let hit: { springId: number; x: number; y: number; isFrame: boolean } | null = null;
  let minDist = Infinity;

  // Check all springs (frame + agent's own)
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

  // Check center hub
  if (!hit) {
    const hub = { x: state.width * 0.5, y: state.height * 0.5 };
    const distToHub = distToSegment(hub.x, hub.y, agent.x, agent.y, nextX, nextY);
    if (distToHub < 18) {
      hit = { springId: -1, x: hub.x, y: hub.y, isFrame: false };
    }
  }

  // Check if going out of bounds (attach to frame)
  if (!hit) {
    if (nextY >= state.height) {
      hit = { springId: -2, x: nextX, y: state.height, isFrame: true };
    } else if (nextX <= 0) {
      hit = { springId: -2, x: 0, y: nextY, isFrame: true };
    } else if (nextX >= state.width) {
      hit = { springId: -2, x: state.width, y: nextY, isFrame: true };
    }
  }

  if (hit) {
    const landX = hit.x;
    const landY = hit.y;

    // Determine if start was on frame
    const startSpring = state.world.springMap.get(agent.currentSpringId);
    const startIsFrame = startSpring ? startSpring.ownerAgentId === -1 : true;
    const endIsFrame = hit.isFrame;
    const sameSide = startIsFrame && endIsFrame && hit.springId === agent.currentSpringId;

    // Create thread from drop start to landing point
    if (!sameSide && agent.dropStartPos) {
      const silkType: SilkType = startIsFrame || endIsFrame || hit.springId === -1 ? 'radial' : 'capture';
      const silk = getSilkProfile(silkType);
      const lineColor = silkType === 'capture'
        ? agent.webColor
        : agent.webColor.replace(/0\.4\)$/, '0.7)');

      const crowded = hit.springId !== -1 && isCrowded(
        agent.dropStartPos.x, agent.dropStartPos.y,
        landX, landY,
        agent, state,
      );

      if (!crowded) {
        // Find or create attachment nodes
        let startNodeId: number | undefined;
        let endNodeId: number | undefined;

        // Start attachment: find nearest frame spring and split it to create attachment node
        const startFrameHit = findNearestFrameSpring(state.world, agent.dropStartPos.x, agent.dropStartPos.y);
        if (startFrameHit && startFrameHit.t > 0.01 && startFrameHit.t < 0.99) {
          const dist = Math.hypot(agent.dropStartPos.x - startFrameHit.x, agent.dropStartPos.y - startFrameHit.y);
          if (dist < 5) {
            startNodeId = splitFrameSpring(state.world, startFrameHit.springId, startFrameHit.t);
            if (startNodeId === -1) startNodeId = undefined;
          }
        }
        // If start is on an agent spring, find nearest node
        if (startNodeId == null) {
          const nearStart = findNearestSpring(state.world, agent.dropStartPos.x, agent.dropStartPos.y);
          if (nearStart && nearStart.dist < 3) {
            const ns = state.world.springMap.get(nearStart.springId);
            if (ns) {
              startNodeId = nearStart.t < 0.5 ? ns.nodeA : ns.nodeB;
            }
          }
        }

        // End attachment
        if (hit.springId >= 0) {
          const hitSpring = state.world.springMap.get(hit.springId);
          if (hitSpring && hitSpring.ownerAgentId === -1) {
            // Hit a frame spring — split it
            const dx = landX - state.world.nodeMap.get(hitSpring.nodeA)!.x;
            const dy = landY - state.world.nodeMap.get(hitSpring.nodeA)!.y;
            const bx = state.world.nodeMap.get(hitSpring.nodeB)!.x - state.world.nodeMap.get(hitSpring.nodeA)!.x;
            const by = state.world.nodeMap.get(hitSpring.nodeB)!.y - state.world.nodeMap.get(hitSpring.nodeA)!.y;
            const blenSq = bx * bx + by * by;
            const paramT = blenSq > 0 ? Math.max(0.01, Math.min(0.99, (dx * bx + dy * by) / blenSq)) : 0.5;
            endNodeId = splitFrameSpring(state.world, hit.springId, paramT);
            if (endNodeId === -1) endNodeId = undefined;
          } else if (hitSpring) {
            // Hit an agent spring — use nearest node
            const nearEnd = findNearestSpring(state.world, landX, landY);
            if (nearEnd && nearEnd.dist < 3) {
              const ns = state.world.springMap.get(nearEnd.springId);
              if (ns) {
                endNodeId = nearEnd.t < 0.5 ? ns.nodeA : ns.nodeB;
              }
            }
          }
        } else if (hit.springId === -2) {
          // Out of bounds — find nearest frame spring
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

        // Land on the last spring of the newly created thread
        const lastSpringId = thread.springIds[thread.springIds.length - 1];
        if (lastSpringId != null) {
          agent.currentSpringId = lastSpringId;
          agent.tOnSpring = 1;
          agent.state = 'crawling';
          agent.x = landX;
          agent.y = landY;
          agent.direction = Math.random() < 0.5 ? 1 : -1;
          return;
        }
      }
    }

    // Default: land on the hit spring or nearest spring
    agent.state = 'crawling';
    agent.x = landX;
    agent.y = landY;

    if (hit.springId >= 0) {
      agent.currentSpringId = hit.springId;
      // Compute tOnSpring for the hit spring
      const hs = state.world.springMap.get(hit.springId);
      if (hs) {
        const na = state.world.nodeMap.get(hs.nodeA);
        const nb = state.world.nodeMap.get(hs.nodeB);
        if (na && nb) {
          const sdx = nb.x - na.x;
          const sdy = nb.y - na.y;
          const slenSq = sdx * sdx + sdy * sdy;
          agent.tOnSpring = slenSq > 0 ? Math.max(0, Math.min(1, ((landX - na.x) * sdx + (landY - na.y) * sdy) / slenSq)) : 0;
        }
      }
    } else {
      // Hub hit or fallback: find nearest spring
      const nearest = findNearestSpring(state.world, landX, landY);
      if (nearest) {
        agent.currentSpringId = nearest.springId;
        agent.tOnSpring = nearest.t;
      }
    }

    agent.direction = Math.random() < 0.5 ? 1 : -1;
  } else {
    agent.x = nextX;
    agent.y = nextY;
  }
}
