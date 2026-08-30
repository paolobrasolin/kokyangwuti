/**
 * Local senses for the construction sensorimotor loop.
 *
 * Everything in here is deliberately *local*: it answers questions a spider
 * standing on a thread could answer by touch — what directions do the threads
 * at this junction run in, how much silk is within a leg's reach, how taut is
 * the thread underfoot. Nothing here may look at the canvas as a whole, and
 * nothing here may hold state between calls.
 */

import { distToSegment } from '../geometry';
import type { PhysicsWorld } from '../physics/types';
import { getConnectedSprings } from '../physics/world';
import type { SilkType } from '../types';

export const TWO_PI = Math.PI * 2;

/**
 * A gap wider than this is not "between two threads" any more — it is the open
 * edge of the structure. Gap-filling only ever fires inside a bounded gap, which
 * is what keeps an agent standing on the frame from launching straight out of
 * the world.
 */
export const MAX_FILL_GAP = Math.PI - 0.05;

/** Radius, in pixels, of the agent's local silk-density sense. */
export const SENSE_RADIUS = 70;

export interface AngularGap {
  /** Direction, in radians, halfway through the gap. */
  bisector: number;
  /** Angular width of the gap, in radians. */
  size: number;
}

export interface NodeSenses {
  x: number;
  y: number;
  /** Incident threads spun by this agent. */
  ownDegree: number;
  /** All incident threads, own silk and substrate alike. */
  totalDegree: number;
  /** Angular gaps between incident threads, widest first. */
  gaps: AngularGap[];
  /** Widest gap that is still bounded by threads on both sides. */
  fillableGap: AngularGap | null;
  /** Own silk length within `SENSE_RADIUS`, normalised by that radius. */
  density: number;
}

export function normalizeAngle(angle: number): number {
  const wrapped = angle % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

/**
 * Angular gaps between a set of incident thread directions, widest first.
 *
 * With no threads at all the whole circle is one gap; with a single thread the
 * gap is the full turn on the other side of it.
 */
export function angularGaps(directions: readonly number[]): AngularGap[] {
  if (directions.length === 0) return [{ bisector: 0, size: TWO_PI }];

  const sorted = directions.map(normalizeAngle).sort((a, b) => a - b);
  if (sorted.length === 1) {
    return [{ bisector: normalizeAngle(sorted[0] + Math.PI), size: TWO_PI }];
  }

  const gaps: AngularGap[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i];
    const to = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + TWO_PI;
    const size = to - from;
    if (size <= 1e-9) continue;
    gaps.push({ bisector: normalizeAngle(from + size * 0.5), size });
  }

  if (gaps.length === 0) {
    // Every thread points the same way: the rest of the circle is free.
    return [{ bisector: normalizeAngle(sorted[0] + Math.PI), size: TWO_PI }];
  }

  gaps.sort((a, b) => b.size - a.size);
  return gaps;
}

/** The widest gap that is bounded on both sides, or null if none is. */
export function fillableGap(gaps: readonly AngularGap[]): AngularGap | null {
  for (const gap of gaps) {
    if (gap.size < MAX_FILL_GAP) return gap;
  }
  return null;
}

/** Directions, in radians, of every thread incident to `nodeId`. */
export function incidentDirections(
  world: PhysicsWorld,
  nodeId: number,
  agentId: number,
): { directions: number[]; ownDegree: number } {
  const node = world.nodeMap.get(nodeId);
  const directions: number[] = [];
  let ownDegree = 0;
  if (!node) return { directions, ownDegree };

  for (const springId of getConnectedSprings(world, nodeId)) {
    const spring = world.springMap.get(springId);
    if (!spring) continue;
    const otherId = spring.nodeA === nodeId ? spring.nodeB : spring.nodeA;
    const other = world.nodeMap.get(otherId);
    if (!other) continue;
    const dx = other.x - node.x;
    const dy = other.y - node.y;
    if (Math.hypot(dx, dy) < 1e-6) continue;
    directions.push(Math.atan2(dy, dx));
    if (spring.ownerAgentId === agentId) ownDegree++;
  }

  return { directions, ownDegree };
}

/**
 * Own silk length within `radius` of a point, divided by `radius`.
 * Roughly "how many thread-crossings a leg-sweep would find".
 */
export function localSilkDensity(
  world: PhysicsWorld,
  x: number,
  y: number,
  agentId: number,
  radius = SENSE_RADIUS,
): number {
  if (radius <= 0) return 0;
  let total = 0;
  for (const spring of world.springs) {
    if (spring.broken || spring.ownerAgentId !== agentId) continue;
    const nodeA = world.nodeMap.get(spring.nodeA);
    const nodeB = world.nodeMap.get(spring.nodeB);
    if (!nodeA || !nodeB) continue;
    if (distToSegment(x, y, nodeA.x, nodeA.y, nodeB.x, nodeB.y) > radius)
      continue;
    total += Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);
  }
  return total / radius;
}

/** Everything the agent can feel while standing on a junction. */
export function senseAtNode(
  world: PhysicsWorld,
  nodeId: number,
  agentId: number,
  radius = SENSE_RADIUS,
): NodeSenses | null {
  const node = world.nodeMap.get(nodeId);
  if (!node) return null;

  const { directions, ownDegree } = incidentDirections(world, nodeId, agentId);
  const gaps = angularGaps(directions);

  return {
    x: node.x,
    y: node.y,
    ownDegree,
    totalDegree: directions.length,
    gaps,
    fillableGap: fillableGap(gaps),
    density: localSilkDensity(world, node.x, node.y, agentId, radius),
  };
}

export interface NearestSilk {
  dist: number;
  /** Unit vector from the query point toward the closest point on that silk. */
  ux: number;
  uy: number;
}

/**
 * Distance from a point to the agent's own silk of a given type, plus the
 * direction toward it. `dist` is Infinity when no such silk is in range.
 */
export function nearestOwnSilk(
  world: PhysicsWorld,
  x: number,
  y: number,
  agentId: number,
  type: SilkType,
  maxDist = Number.POSITIVE_INFINITY,
): NearestSilk {
  let best = maxDist;
  let bx = 0;
  let by = 0;
  let found = false;

  for (const spring of world.springs) {
    if (spring.broken || spring.ownerAgentId !== agentId) continue;
    if (spring.type !== type) continue;
    const nodeA = world.nodeMap.get(spring.nodeA);
    const nodeB = world.nodeMap.get(spring.nodeB);
    if (!nodeA || !nodeB) continue;

    const dist = distToSegment(x, y, nodeA.x, nodeA.y, nodeB.x, nodeB.y);
    if (dist >= best) continue;
    best = dist;
    found = true;
    // Direction toward the midpoint is a good enough "which side is it on".
    bx = (nodeA.x + nodeB.x) * 0.5 - x;
    by = (nodeA.y + nodeB.y) * 0.5 - y;
  }

  if (!found) return { dist: Number.POSITIVE_INFINITY, ux: 0, uy: 0 };
  const len = Math.hypot(bx, by);
  return len > 1e-6
    ? { dist: best, ux: bx / len, uy: by / len }
    : { dist: best, ux: 0, uy: 0 };
}

/**
 * Unit vector pointing toward the local concentration of silk (any owner but
 * the substrate), or (0,0) when nothing is within reach.
 */
export function structureDirection(
  world: PhysicsWorld,
  x: number,
  y: number,
  radius = SENSE_RADIUS,
): { ux: number; uy: number } {
  let sx = 0;
  let sy = 0;
  for (const spring of world.springs) {
    if (spring.broken || spring.ownerAgentId === -1) continue;
    const nodeA = world.nodeMap.get(spring.nodeA);
    const nodeB = world.nodeMap.get(spring.nodeB);
    if (!nodeA || !nodeB) continue;
    const mx = (nodeA.x + nodeB.x) * 0.5;
    const my = (nodeA.y + nodeB.y) * 0.5;
    const dx = mx - x;
    const dy = my - y;
    const dist = Math.hypot(dx, dy);
    if (dist > radius || dist < 1e-6) continue;
    const weight = Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y) / dist;
    sx += (dx / dist) * weight;
    sy += (dy / dist) * weight;
  }
  const len = Math.hypot(sx, sy);
  return len > 1e-6 ? { ux: sx / len, uy: sy / len } : { ux: 0, uy: 0 };
}

/** Strain of a spring: current length over rest length, minus one. */
export function springStrain(
  world: PhysicsWorld,
  springId: number,
): number | null {
  const spring = world.springMap.get(springId);
  if (!spring || spring.broken || spring.restLength <= 0) return null;
  const nodeA = world.nodeMap.get(spring.nodeA);
  const nodeB = world.nodeMap.get(spring.nodeB);
  if (!nodeA || !nodeB) return null;
  return (
    Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y) / spring.restLength - 1
  );
}
