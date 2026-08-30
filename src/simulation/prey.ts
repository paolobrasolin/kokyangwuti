/**
 * Prey: ballistic flies that become part of the web on impact.
 *
 * There is no capture formula here. A fly is a particle with mass and velocity;
 * when its path crosses a thread the thread is split at the point of contact and
 * the new node *is* the fly — same mass, same velocity. From then on the
 * mass-spring solver does the work: the fly's momentum stretches the silk, the
 * load propagates along the thread, and springs that go past `maxExtension`
 * break exactly as they do for any other load.
 *
 * Only two things are decided outside the solver, and both are physical:
 *
 * - **Energy absorption.** `stepPhysics` ignores `spring.damping`, so the fly
 *   node bleeds velocity in proportion to the damping of the silk it hangs on.
 *   Capture silk (damping 0.375) subdues a fly far faster than radial silk
 *   (0.11) — the "energy absorption" half of Harmer et al. 2010.
 * - **Adhesion.** Per tick the fly may struggle free; the probability scales
 *   with `1 - adhesion` of the silk at its node and with the kinetic energy it
 *   has left. A fly whose energy the silk has already eaten cannot get off.
 *
 * Capture is then simply: still stuck when the energy is gone (or when the
 * coupling window closes). Escape is: the adhesion roll failed first, or the
 * silk tore and the fly flew on.
 */

import type { Config } from '../config';
import { FLY } from '../config';
import { PHYSICS } from '../physics/config';
import type { PhysicsWorld } from '../physics/types';
import {
  getConnectedSprings,
  rayVsSprings,
  splitSpring,
} from '../physics/world';
import type { Agent, Fly, SimulationControls, SimulationState } from '../types';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** True when the tick runs without the solver (fast-forward). */
export function physicsSkipped(controls: SimulationControls): boolean {
  return controls.simSpeed >= PHYSICS.skipPhysicsSpeed;
}

// ========== ENTRY POINT ==========

/**
 * Advance the whole prey system by `dt` ms: spawn, fly, couple, resolve.
 * Call before `stepPhysics` so a fresh impact is integrated the same tick.
 */
export function stepPrey(
  state: SimulationState,
  controls: SimulationControls,
  config: Config,
  dt: number,
): void {
  const spawned = rollSpawn(state, controls, dt);
  const skip = physicsSkipped(controls);

  if (spawned && !skip && state.flies.length < FLY.maxLive) {
    state.flies.push(spawned);
  }

  if (skip) {
    // Degraded fast-forward path: the solver is off, so nothing would ever
    // stretch, break or dissipate, and a coupled fly would hang forever.
    // Anything still in the arena from a slower phase is simply released, and
    // each new fly is resolved in one shot from the spring properties the
    // solver would have integrated — see `resolveWithoutSolver`.
    for (const fly of state.flies) detachFromWeb(state, fly);
    state.flies.length = 0;
    if (spawned) resolveWithoutSolver(state, config, spawned);
    return;
  }

  for (let i = state.flies.length - 1; i >= 0; i--) {
    const fly = state.flies[i];
    fly.ageMs += dt;
    if (fly.graceMs > 0) fly.graceMs = Math.max(0, fly.graceMs - dt);

    const gone =
      fly.nodeId >= 0
        ? updateCoupled(state, config, fly, dt)
        : updateAirborne(state, fly, dt);

    if (gone || fly.ageMs > FLY.maxAgeMs) {
      detachFromWeb(state, fly);
      state.flies.splice(i, 1);
    }
  }
}

// ========== SPAWNING ==========

/**
 * One draw from the prey stream per tick, plus a fixed number of draws for the
 * fly's parameters. Everything is drawn unconditionally so the prey sequence
 * stays identical whatever the population is doing — a spawn over the live cap
 * is discarded *after* its numbers are drawn.
 */
function rollSpawn(
  state: SimulationState,
  controls: SimulationControls,
  dt: number,
): Fly | null {
  const probability = 1 - (1 - controls.flyRate) ** (dt / 16);
  if (!state.flyRng.chance(probability)) return null;
  const fly = createFly(state);
  // Counted here, before any live-cap rejection: `fliesSpawned` measures the
  // prey the *stream* offered, which must not depend on what the webs are doing.
  state.fliesSpawned += 1;
  return fly;
}

/** A fly entering the arena from one of its edges. Six draws, always. */
export function createFly(state: SimulationState): Fly {
  const rng = state.flyRng;
  const margin = FLY.spawnMargin;

  const horizontal = rng.next() < 0.5;
  const fromStart = rng.next() < 0.5;
  const along = rng.next();
  const drift = rng.next() - 0.5;
  const mass = FLY.minMass + rng.next() * (FLY.maxMass - FLY.minMass);
  const speed = FLY.minSpeed + rng.next() * (FLY.maxSpeed - FLY.minSpeed);

  let x: number;
  let y: number;
  let targetX: number;
  let targetY: number;

  if (horizontal) {
    x = fromStart ? -margin : state.width + margin;
    y = along * state.height;
    targetX = fromStart ? state.width + margin : -margin;
    targetY = y + drift * state.height;
  } else {
    x = along * state.width;
    y = fromStart ? -margin : state.height + margin;
    targetX = x + drift * state.width;
    targetY = fromStart ? state.height + margin : -margin;
  }

  const dx = targetX - x;
  const dy = targetY - y;
  const len = Math.hypot(dx, dy);
  const hx = len > 1e-6 ? dx / len : 1;
  const hy = len > 1e-6 ? dy / len : 0;

  return {
    id: state.nextFlyId++,
    x,
    y,
    vx: hx * speed,
    vy: hy * speed,
    hx,
    hy,
    mass,
    ageMs: 0,
    nodeId: -1,
    ownerAgentId: -1,
    stuckMs: 0,
    graceMs: 0,
  };
}

// ========== BALLISTIC FLIGHT ==========

/** Move a free fly and sweep its path against the silk. Returns true to despawn. */
function updateAirborne(state: SimulationState, fly: Fly, dt: number): boolean {
  const step = dt / 16;
  const nextX = fly.x + fly.vx * step;
  const nextY = fly.y + fly.vy * step;

  if (fly.graceMs <= 0) {
    // Frame and branch springs are owner -1 and are skipped by `rayVsSprings`:
    // a fly passes straight through the substrate and can never be caught by it.
    const hit = rayVsSprings(state.world, fly.x, fly.y, nextX, nextY);
    if (hit && coupleToWeb(state, fly, hit.springId, hit.t, dt)) return false;
  }

  fly.x = nextX;
  fly.y = nextY;
  return outsideArena(state, fly);
}

function outsideArena(state: SimulationState, fly: Fly): boolean {
  const margin = FLY.spawnMargin * 2;
  return (
    fly.x < -margin ||
    fly.y < -margin ||
    fly.x > state.width + margin ||
    fly.y > state.height + margin
  );
}

// ========== COUPLING ==========

/**
 * Split the thread at the point of contact and hand the new node the fly's mass
 * and velocity (Verlet encodes velocity as the previous position).
 */
function coupleToWeb(
  state: SimulationState,
  fly: Fly,
  springId: number,
  t: number,
  dt: number,
): boolean {
  const world = state.world;
  const spring = world.springMap.get(springId);
  if (!spring || spring.broken) return false;
  if (spring.ownerAgentId < 0) return false;

  const nodeId = splitSpring(
    world,
    springId,
    clamp(t, FLY.splitMargin, 1 - FLY.splitMargin),
  );
  if (nodeId === -1) return false;
  const node = world.nodeMap.get(nodeId);
  if (!node || node.pinned) return false;

  node.mass = fly.mass;
  const scale = solverStep(dt);
  node.prevX = node.x - fly.vx * scale;
  node.prevY = node.y - fly.vy * scale;

  fly.nodeId = nodeId;
  fly.ownerAgentId = spring.ownerAgentId;
  fly.stuckMs = 0;
  fly.x = node.x;
  fly.y = node.y;
  return true;
}

/** Displacement-per-step scale the solver will actually integrate with. */
function solverStep(dt: number): number {
  return Math.min(dt, PHYSICS.maxDt) / 16;
}

// ========== COUPLED DYNAMICS ==========

interface SilkContact {
  adhesion: number;
  damping: number;
  count: number;
}

/** Silk properties at a node: the strongest adhesion and the mean damping. */
function contactAt(world: PhysicsWorld, nodeId: number): SilkContact {
  let adhesion = 0;
  let damping = 0;
  let count = 0;
  for (const springId of getConnectedSprings(world, nodeId)) {
    const spring = world.springMap.get(springId);
    if (!spring) continue;
    adhesion = Math.max(adhesion, spring.adhesion);
    damping += spring.damping;
    count++;
  }
  return { adhesion, damping: count > 0 ? damping / count : 0, count };
}

/** Advance a fly that is part of the web. Returns true when it leaves the sim. */
function updateCoupled(
  state: SimulationState,
  config: Config,
  fly: Fly,
  dt: number,
): boolean {
  const world = state.world;
  const node = world.nodeMap.get(fly.nodeId);
  if (!node) {
    // The node was cleaned away: whatever held the fly is gone.
    tearFree(state, fly, dt);
    return false;
  }

  fly.x = node.x;
  fly.y = node.y;
  fly.stuckMs += dt;

  const contact = contactAt(world, fly.nodeId);
  if (contact.count === 0) {
    // Every thread at the node broke: the fly punched through and flies on.
    tearFree(state, fly, dt);
    return false;
  }

  const step = dt / 16;

  // Energy absorption by the silk. The solver has no per-spring damping, so
  // this is where sticky, lossy capture silk subdues a fly and springy radial
  // silk lets it keep thrashing.
  const bleed = clamp(contact.damping * FLY.dampingCoupling * step, 0, 0.95);
  const vx = (node.x - node.prevX) * (1 - bleed);
  const vy = (node.y - node.prevY) * (1 - bleed);
  node.prevX = node.x - vx;
  node.prevY = node.y - vy;

  const scale = solverStep(dt);
  const speed = scale > 0 ? Math.hypot(vx, vy) / scale : 0;
  const kinetic = 0.5 * fly.mass * speed * speed;

  const owner = findAgent(state, fly.ownerAgentId);
  if (!owner || !owner.alive) {
    tearFree(state, fly, dt);
    return false;
  }

  if (kinetic <= FLY.captureEnergy || fly.stuckMs >= FLY.holdMs) {
    capture(state, config, fly, owner);
    return true;
  }

  const struggle = Math.min(
    FLY.maxEnergyFactor,
    kinetic / FLY.escapeEnergyScale,
  );
  const perTick = clamp(
    FLY.escapeBase * (1 - contact.adhesion) * (FLY.escapeFloor + struggle),
    0,
    1,
  );
  if (owner.rng.chance(1 - (1 - perTick) ** step)) {
    tearFree(state, fly, dt);
  }
  return false;
}

function findAgent(state: SimulationState, agentId: number): Agent | undefined {
  if (agentId < 0) return undefined;
  return state.agents.find((agent) => agent.id === agentId);
}

// ========== OUTCOMES ==========

/** Give the fly's node back to the web, at its normal mass. */
function detachFromWeb(state: SimulationState, fly: Fly): void {
  if (fly.nodeId < 0) return;
  const node = state.world.nodeMap.get(fly.nodeId);
  if (node) node.mass = PHYSICS.defaultNodeMass;
  fly.nodeId = -1;
  fly.ownerAgentId = -1;
  fly.stuckMs = 0;
}

/** The fly wins: it resumes flight with whatever velocity the node had. */
function tearFree(state: SimulationState, fly: Fly, dt: number): void {
  const node = state.world.nodeMap.get(fly.nodeId);
  const scale = solverStep(dt);
  if (node && scale > 0) {
    fly.vx = (node.x - node.prevX) / scale;
    fly.vy = (node.y - node.prevY) / scale;
    fly.x = node.x;
    fly.y = node.y;
  }

  const speed = Math.hypot(fly.vx, fly.vy);
  if (speed > 1e-6) {
    fly.hx = fly.vx / speed;
    fly.hy = fly.vy / speed;
  }
  // A fly that shook loose flies away under its own power, never at a speed
  // the solver could not have produced.
  const escapeSpeed = clamp(speed, FLY.minSpeed, FLY.maxSpeed * 2);
  fly.vx = fly.hx * escapeSpeed;
  fly.vy = fly.hy * escapeSpeed;

  detachFromWeb(state, fly);
  fly.graceMs = FLY.graceMs;
}

/** The web wins: the owner eats the fly. */
function capture(
  state: SimulationState,
  config: Config,
  fly: Fly,
  agent: Agent,
): void {
  const node = state.world.nodeMap.get(fly.nodeId);
  if (node) {
    // The web keeps the (now empty) attachment point, at rest.
    node.prevX = node.x;
    node.prevY = node.y;
  }
  detachFromWeb(state, fly);

  agent.score += 1;
  // Gut ceiling: a flat surplus above whatever the spider was born with, so the
  // headroom to bank energy is the same for a heavy body and a light one.
  agent.energy = Math.min(
    agent.energy + config.gainFly * (fly.mass / FLY.referenceMass),
    agent.startEnergy + config.startingEnergy * 2,
  );
  agent.fliesCaught.push({ x: fly.x, y: fly.y, ageMs: 0 });
  if (agent.fliesCaught.length > config.maxFliesPerAgent)
    agent.fliesCaught.shift();
}

// ========== FAST-FORWARD FALLBACK ==========

/**
 * Degraded resolution for `simSpeed >= PHYSICS.skipPhysicsSpeed`, where the
 * solver never runs and no node ever moves.
 *
 * The fly's whole remaining path is swept in one go; the first thread it meets
 * either absorbs it or breaks. "Absorbs" compares the fly's kinetic energy with
 * the elastic reserve of the spring it hit, `0.5 * k * (maxExtension -
 * restLength)^2`, i.e. the same properties the solver would have integrated;
 * the hold roll is the spring's adhesion. It is an approximation of the coupled
 * dynamics, not a re-implementation of them: web damage from a break is real,
 * but propagation, dissipation and multi-thread support are not modelled.
 */
export function resolveWithoutSolver(
  state: SimulationState,
  config: Config,
  fly: Fly,
): void {
  const reach = Math.hypot(state.width, state.height) + FLY.spawnMargin * 4;
  const hit = rayVsSprings(
    state.world,
    fly.x,
    fly.y,
    fly.x + fly.hx * reach,
    fly.y + fly.hy * reach,
  );
  if (!hit) return;

  const spring = state.world.springMap.get(hit.springId);
  if (!spring || spring.broken || spring.ownerAgentId < 0) return;

  const owner = findAgent(state, spring.ownerAgentId);
  if (!owner || !owner.alive) return;

  const speed = Math.hypot(fly.vx, fly.vy);
  const kinetic = 0.5 * fly.mass * speed * speed;
  const reserve = Math.max(0, spring.maxExtension - spring.restLength);
  const capacity =
    0.5 * spring.stiffness * reserve * reserve * FLY.fastCapacityScale;

  if (kinetic > capacity) {
    spring.broken = true;
    return;
  }

  // Stand-in for "the silk absorbed the impact and the adhesion held": the
  // slower the fly relative to what this thread can absorb, the more even
  // low-adhesion silk keeps it.
  const spent = capacity > 0 ? clamp(kinetic / capacity, 0, 1) : 1;
  const hold =
    FLY.fastHoldScale * (spring.adhesion + (1 - spring.adhesion) * (1 - spent));

  if (owner.rng.chance(clamp(hold, 0, 1))) {
    fly.x = hit.point.x;
    fly.y = hit.point.y;
    capture(state, config, fly, owner);
  }
}
