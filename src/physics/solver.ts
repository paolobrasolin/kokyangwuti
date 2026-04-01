import type { PhysicsWorld } from './types';
import { PHYSICS } from './config';

export function stepPhysics(world: PhysicsWorld, dt: number, iterations: number): void {
  const cappedDt = Math.min(dt, PHYSICS.maxDt);
  const dtSec = cappedDt / 1000;
  const dtSq = dtSec * dtSec;
  const damping = 1 - world.globalDamping;

  // 1. Accumulate forces (gravity on unpinned nodes)
  for (let i = 0; i < world.nodes.length; i++) {
    const node = world.nodes[i];
    if (node.pinned) continue;
    node.accY += world.gravity * 1000; // gravity in px/s^2
  }

  // 2. Verlet integration
  for (let i = 0; i < world.nodes.length; i++) {
    const node = world.nodes[i];
    if (node.pinned) continue;

    const dx = (node.x - node.prevX) * damping;
    const dy = (node.y - node.prevY) * damping;

    const newX = node.x + dx + node.accX * dtSq;
    const newY = node.y + dy + node.accY * dtSq;

    node.prevX = node.x;
    node.prevY = node.y;
    node.x = newX;
    node.y = newY;
  }

  // 3. Constraint solving (iterative relaxation)
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < world.springs.length; i++) {
      const spring = world.springs[i];
      if (spring.broken) continue;

      const nodeA = world.nodeMap.get(spring.nodeA);
      const nodeB = world.nodeMap.get(spring.nodeB);
      if (!nodeA || !nodeB) continue;

      const dx = nodeB.x - nodeA.x;
      const dy = nodeB.y - nodeA.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 0.001) continue;

      // Check breaking
      if (dist > spring.maxExtension) {
        spring.broken = true;
        continue;
      }

      const diff = (dist - spring.restLength) / dist;
      const stiffnessFactor = spring.stiffness * 0.5;
      const offsetX = dx * diff * stiffnessFactor;
      const offsetY = dy * diff * stiffnessFactor;

      if (!nodeA.pinned && !nodeB.pinned) {
        const totalMass = nodeA.mass + nodeB.mass;
        const ratioA = nodeB.mass / totalMass;
        const ratioB = nodeA.mass / totalMass;
        nodeA.x += offsetX * ratioA;
        nodeA.y += offsetY * ratioA;
        nodeB.x -= offsetX * ratioB;
        nodeB.y -= offsetY * ratioB;
      } else if (!nodeA.pinned) {
        nodeA.x += offsetX;
        nodeA.y += offsetY;
      } else if (!nodeB.pinned) {
        nodeB.x -= offsetX;
        nodeB.y -= offsetY;
      }
    }
  }

  // 4. Clear accumulators
  for (let i = 0; i < world.nodes.length; i++) {
    const node = world.nodes[i];
    node.accX = 0;
    node.accY = 0;
  }
}

export function applyForceToSpring(
  world: PhysicsWorld,
  springId: number,
  t: number,
  forceX: number,
  forceY: number,
): void {
  const spring = world.springMap.get(springId);
  if (!spring || spring.broken) return;

  const nodeA = world.nodeMap.get(spring.nodeA);
  const nodeB = world.nodeMap.get(spring.nodeB);
  if (!nodeA || !nodeB) return;

  // Distribute force by parametric t
  const forceA = 1 - t;
  const forceB = t;

  if (!nodeA.pinned) {
    nodeA.accX += forceX * forceA / nodeA.mass;
    nodeA.accY += forceY * forceA / nodeA.mass;
  }
  if (!nodeB.pinned) {
    nodeB.accX += forceX * forceB / nodeB.mass;
    nodeB.accY += forceY * forceB / nodeB.mass;
  }
}
