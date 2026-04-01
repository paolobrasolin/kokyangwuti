import type { SilkProfile, SilkType } from '../types';
import type { PhysicsNode, PhysicsWorld, Spring, Thread } from './types';
import { PHYSICS } from './config';
import { getIntersection } from '../geometry';

export function createWorld(): PhysicsWorld {
  return {
    nodes: [],
    springs: [],
    threads: [],
    gravity: PHYSICS.gravity,
    globalDamping: PHYSICS.globalDamping,
    nextNodeId: 0,
    nextSpringId: 0,
    nextThreadId: 0,
    nodeMap: new Map(),
    springMap: new Map(),
    threadMap: new Map(),
    nodeAdjacency: new Map(),
  };
}

export function addNode(
  world: PhysicsWorld,
  x: number,
  y: number,
  pinned: boolean,
  ownerAgentId: number,
  mass = PHYSICS.defaultNodeMass,
): PhysicsNode {
  const node: PhysicsNode = {
    id: world.nextNodeId++,
    x,
    y,
    prevX: x,
    prevY: y,
    accX: 0,
    accY: 0,
    mass,
    pinned,
    ownerAgentId,
  };
  world.nodes.push(node);
  world.nodeMap.set(node.id, node);
  world.nodeAdjacency.set(node.id, []);
  return node;
}

export function addSpring(
  world: PhysicsWorld,
  nodeAId: number,
  nodeBId: number,
  restLength: number,
  stiffness: number,
  damping: number,
  maxExtension: number,
  adhesion: number,
  type: SilkType,
  ownerAgentId: number,
  color: string,
): Spring {
  const spring: Spring = {
    id: world.nextSpringId++,
    nodeA: nodeAId,
    nodeB: nodeBId,
    restLength,
    stiffness,
    damping,
    maxExtension,
    adhesion,
    type,
    ownerAgentId,
    broken: false,
    color,
  };
  world.springs.push(spring);
  world.springMap.set(spring.id, spring);

  // Update adjacency
  const adjA = world.nodeAdjacency.get(nodeAId);
  if (adjA) adjA.push(spring.id);
  const adjB = world.nodeAdjacency.get(nodeBId);
  if (adjB) adjB.push(spring.id);

  return spring;
}

export function addThread(
  world: PhysicsWorld,
  springIds: number[],
  startNodeId: number,
  endNodeId: number,
  type: SilkType,
  ownerAgentId: number,
): Thread {
  const thread: Thread = {
    id: world.nextThreadId++,
    springIds,
    startNodeId,
    endNodeId,
    type,
    ownerAgentId,
  };
  world.threads.push(thread);
  world.threadMap.set(thread.id, thread);
  return thread;
}

function silkToSpringParams(silk: SilkProfile, segmentLength: number) {
  return {
    stiffness: 0.3 + silk.strength * 0.7,
    damping: silk.damping * 0.5,
    maxExtension: segmentLength * (1 + silk.extensibility * 2),
    adhesion: silk.adhesion,
  };
}

/**
 * Build frame as chains of pinned nodes along each canvas edge.
 * Returns the 4 thread IDs for the frame edges (top, right, bottom, left).
 */
export function buildFrame(world: PhysicsWorld, width: number, height: number): number[] {
  const spacing = PHYSICS.frameSpacing;
  const frameColor = 'rgba(50,50,80,0.3)';
  const threadIds: number[] = [];

  // Define the 4 edges: [startX, startY, endX, endY]
  const edges: Array<[number, number, number, number]> = [
    [0, 0, width, 0],        // top
    [width, 0, width, height], // right
    [width, height, 0, height], // bottom
    [0, height, 0, 0],        // left
  ];

  // We need to share corner nodes between edges
  const cornerNodes: PhysicsNode[] = [];

  // Create 4 corner nodes first
  const corners: Array<[number, number]> = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  for (const [cx, cy] of corners) {
    cornerNodes.push(addNode(world, cx, cy, true, -1));
  }

  for (let edgeIdx = 0; edgeIdx < 4; edgeIdx++) {
    const [sx, sy, ex, ey] = edges[edgeIdx];
    const edgeLen = Math.hypot(ex - sx, ey - sy);
    const segments = Math.max(1, Math.round(edgeLen / spacing));

    const startCornerNode = cornerNodes[edgeIdx];
    const endCornerNode = cornerNodes[(edgeIdx + 1) % 4];

    // Create intermediate pinned nodes
    const chainNodes: PhysicsNode[] = [startCornerNode];
    for (let i = 1; i < segments; i++) {
      const frac = i / segments;
      const nx = sx + (ex - sx) * frac;
      const ny = sy + (ey - sy) * frac;
      chainNodes.push(addNode(world, nx, ny, true, -1));
    }
    chainNodes.push(endCornerNode);

    // Create springs between consecutive nodes
    const springIds: number[] = [];
    const segLen = edgeLen / segments;
    for (let i = 0; i < chainNodes.length - 1; i++) {
      const s = addSpring(
        world,
        chainNodes[i].id,
        chainNodes[i + 1].id,
        segLen,
        1.0, // stiffness
        0.15, // damping
        segLen * 3, // maxExtension (frame never breaks)
        0,
        'frame',
        -1,
        frameColor,
      );
      springIds.push(s.id);
    }

    const thread = addThread(
      world,
      springIds,
      startCornerNode.id,
      endCornerNode.id,
      'frame',
      -1,
    );
    threadIds.push(thread.id);
  }

  return threadIds;
}

/**
 * Build procedural tree branches as pinned node chains.
 * Generates 2-3 trees growing from the bottom, with forking branches.
 * Returns thread IDs for all branch segments.
 */
export function buildBranches(world: PhysicsWorld, width: number, height: number): number[] {
  const branchColor = 'rgba(80,50,30,0.5)';
  const twigColor = 'rgba(70,55,35,0.35)';
  const threadIds: number[] = [];
  const spacing = PHYSICS.frameSpacing * 0.8;

  // Seeded-ish random for variety but deterministic per dimensions
  let seed = (width * 7 + height * 13) | 0;
  function rand() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed & 0xffff) / 0xffff;
  }

  const treeCount = 2 + Math.floor(rand() * 2); // 2-3 trees

  for (let t = 0; t < treeCount; t++) {
    // Tree base position along bottom portion of screen
    const baseX = width * (0.15 + rand() * 0.7);
    const baseY = height; // grows from bottom

    // Trunk grows upward with slight lean
    const trunkHeight = height * (0.3 + rand() * 0.35);
    const lean = (rand() - 0.5) * width * 0.08;

    const tipX = baseX + lean;
    const tipY = baseY - trunkHeight;

    // Build trunk as pinned chain
    buildBranchSegment(
      world, baseX, baseY, tipX, tipY, spacing, branchColor, threadIds,
    );

    // Fork into 2-4 main branches from the trunk
    const branchCount = 2 + Math.floor(rand() * 3);
    for (let b = 0; b < branchCount; b++) {
      // Branch starts somewhere along upper 70% of trunk
      const forkFrac = 0.3 + rand() * 0.7;
      const forkX = baseX + lean * forkFrac;
      const forkY = baseY - trunkHeight * forkFrac;

      // Branch direction: spread outward and slightly up/down
      const side = rand() < 0.5 ? -1 : 1;
      const branchLen = trunkHeight * (0.2 + rand() * 0.4);
      const angle = -Math.PI * 0.5 + side * (0.3 + rand() * 0.8);
      const endX = forkX + Math.cos(angle) * branchLen;
      const endY = forkY + Math.sin(angle) * branchLen;

      // Clamp to viewport with margin
      const clampedX = Math.max(20, Math.min(width - 20, endX));
      const clampedY = Math.max(20, Math.min(height - 20, endY));

      // Find nearest existing node at fork point to connect
      const forkNode = findNearestNodeAt(world, forkX, forkY, 5);

      buildBranchSegment(
        world, forkX, forkY, clampedX, clampedY, spacing, branchColor, threadIds,
        forkNode?.id,
      );

      // Optional sub-branches (twigs)
      if (rand() < 0.6) {
        const twigFrac = 0.4 + rand() * 0.4;
        const twigX = forkX + (clampedX - forkX) * twigFrac;
        const twigY = forkY + (clampedY - forkY) * twigFrac;
        const twigLen = branchLen * (0.3 + rand() * 0.3);
        const twigAngle = angle + (rand() - 0.5) * 1.2;
        const twigEndX = Math.max(20, Math.min(width - 20, twigX + Math.cos(twigAngle) * twigLen));
        const twigEndY = Math.max(20, Math.min(height - 20, twigY + Math.sin(twigAngle) * twigLen));

        const twigForkNode = findNearestNodeAt(world, twigX, twigY, 5);
        buildBranchSegment(
          world, twigX, twigY, twigEndX, twigEndY, spacing * 1.2, twigColor, threadIds,
          twigForkNode?.id,
        );
      }
    }
  }

  return threadIds;
}

function findNearestNodeAt(
  world: PhysicsWorld,
  x: number,
  y: number,
  maxDist: number,
): PhysicsNode | null {
  let best: PhysicsNode | null = null;
  let bestDist = maxDist;
  for (const node of world.nodes) {
    if (node.ownerAgentId !== -1) continue;
    const d = Math.hypot(node.x - x, node.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }
  return best;
}

function buildBranchSegment(
  world: PhysicsWorld,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  spacing: number,
  color: string,
  threadIds: number[],
  startNodeId?: number,
): Thread {
  const totalLen = Math.hypot(endX - startX, endY - startY);
  const segments = Math.max(1, Math.round(totalLen / spacing));
  const segLen = totalLen / segments;

  const startNode = startNodeId != null
    ? world.nodeMap.get(startNodeId)!
    : addNode(world, startX, startY, true, -1);

  const chainNodes: PhysicsNode[] = [startNode];
  for (let i = 1; i < segments; i++) {
    const frac = i / segments;
    chainNodes.push(addNode(
      world,
      startX + (endX - startX) * frac,
      startY + (endY - startY) * frac,
      true, -1,
    ));
  }
  const endNode = addNode(world, endX, endY, true, -1);
  chainNodes.push(endNode);

  const springIds: number[] = [];
  for (let i = 0; i < chainNodes.length - 1; i++) {
    const s = addSpring(
      world,
      chainNodes[i].id,
      chainNodes[i + 1].id,
      segLen,
      1.0,
      0.15,
      segLen * 3,
      0,
      'frame',
      -1,
      color,
    );
    springIds.push(s.id);
  }

  const thread = addThread(world, springIds, startNode.id, endNode.id, 'frame', -1);
  threadIds.push(thread.id);
  return thread;
}

/**
 * Create a subdivided thread between two points, with physics nodes.
 * Endpoints are attached at existing nodes (or new pinned nodes are created).
 */
export function createSubdividedThread(
  world: PhysicsWorld,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  silk: SilkProfile,
  silkType: SilkType,
  ownerAgentId: number,
  color: string,
  startNodeId?: number,
  endNodeId?: number,
): Thread {
  const totalLen = Math.hypot(endX - startX, endY - startY);
  const segCount = Math.max(1, Math.round(totalLen / PHYSICS.segmentLength));
  const segLen = totalLen / segCount;
  const params = silkToSpringParams(silk, segLen);

  // Start node: use existing or create pinned
  const startNode = startNodeId != null
    ? world.nodeMap.get(startNodeId)!
    : addNode(world, startX, startY, true, ownerAgentId);

  // End node: use existing or create pinned
  const endNode = endNodeId != null
    ? world.nodeMap.get(endNodeId)!
    : addNode(world, endX, endY, true, ownerAgentId);

  // Create intermediate unpinned nodes
  const chainNodes: PhysicsNode[] = [startNode];
  for (let i = 1; i < segCount; i++) {
    const frac = i / segCount;
    const nx = startX + (endX - startX) * frac;
    const ny = startY + (endY - startY) * frac;
    chainNodes.push(addNode(world, nx, ny, false, ownerAgentId));
  }
  chainNodes.push(endNode);

  // Create springs
  const springIds: number[] = [];
  for (let i = 0; i < chainNodes.length - 1; i++) {
    const s = addSpring(
      world,
      chainNodes[i].id,
      chainNodes[i + 1].id,
      segLen,
      params.stiffness,
      params.damping,
      params.maxExtension,
      params.adhesion,
      silkType,
      ownerAgentId,
      color,
    );
    springIds.push(s.id);
  }

  return addThread(world, springIds, startNode.id, endNode.id, silkType, ownerAgentId);
}

/**
 * Find the nearest spring to a point, optionally filtered by owner.
 * Returns springId, parametric t on that spring, and distance.
 */
export function findNearestSpring(
  world: PhysicsWorld,
  x: number,
  y: number,
  ownerAgentId?: number,
  maxDist = Infinity,
): { springId: number; t: number; dist: number; x: number; y: number } | null {
  let best: { springId: number; t: number; dist: number; x: number; y: number } | null = null;

  for (let i = 0; i < world.springs.length; i++) {
    const spring = world.springs[i];
    if (spring.broken) continue;
    if (ownerAgentId != null && spring.ownerAgentId !== ownerAgentId && spring.ownerAgentId !== -1) continue;

    const nodeA = world.nodeMap.get(spring.nodeA);
    const nodeB = world.nodeMap.get(spring.nodeB);
    if (!nodeA || !nodeB) continue;

    const dx = nodeB.x - nodeA.x;
    const dy = nodeB.y - nodeA.y;
    const lenSq = dx * dx + dy * dy;

    let t: number;
    if (lenSq < 0.001) {
      t = 0;
    } else {
      t = Math.max(0, Math.min(1, ((x - nodeA.x) * dx + (y - nodeA.y) * dy) / lenSq));
    }

    const px = nodeA.x + dx * t;
    const py = nodeA.y + dy * t;
    const dist = Math.hypot(x - px, y - py);

    if (dist < maxDist && (!best || dist < best.dist)) {
      best = { springId: spring.id, t, dist, x: px, y: py };
    }
  }

  return best;
}

/**
 * Find the node closest to a point among nodes connected to a given spring.
 * Used for junction navigation.
 */
export function getConnectedSprings(world: PhysicsWorld, nodeId: number): number[] {
  return world.nodeAdjacency.get(nodeId)?.filter(sid => {
    const s = world.springMap.get(sid);
    return s && !s.broken;
  }) ?? [];
}

/**
 * Ray-cast a line segment against all springs in the world.
 * Returns the first hit (closest to start of ray).
 */
export function rayVsSprings(
  world: PhysicsWorld,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  filterOwner?: number,
): { springId: number; point: { x: number; y: number }; dist: number; t: number } | null {
  let best: { springId: number; point: { x: number; y: number }; dist: number; t: number } | null = null;

  for (let i = 0; i < world.springs.length; i++) {
    const spring = world.springs[i];
    if (spring.broken) continue;
    if (spring.ownerAgentId === -1) continue; // skip frame springs for fly detection
    if (filterOwner != null && spring.ownerAgentId !== filterOwner) continue;

    const nodeA = world.nodeMap.get(spring.nodeA);
    const nodeB = world.nodeMap.get(spring.nodeB);
    if (!nodeA || !nodeB) continue;

    const hit = getIntersection(x1, y1, x2, y2, nodeA.x, nodeA.y, nodeB.x, nodeB.y);
    if (!hit) continue;

    const dist = Math.hypot(hit.x - x1, hit.y - y1);
    if (!best || dist < best.dist) {
      // Compute parametric t on the spring
      const sdx = nodeB.x - nodeA.x;
      const sdy = nodeB.y - nodeA.y;
      const slenSq = sdx * sdx + sdy * sdy;
      const t = slenSq > 0.001
        ? ((hit.x - nodeA.x) * sdx + (hit.y - nodeA.y) * sdy) / slenSq
        : 0;
      best = { springId: spring.id, point: hit, dist, t: Math.max(0, Math.min(1, t)) };
    }
  }

  return best;
}

/**
 * Find the closest frame node to a point. Used for attaching threads to frame.
 */
export function findNearestFrameNode(
  world: PhysicsWorld,
  x: number,
  y: number,
): PhysicsNode | null {
  let best: PhysicsNode | null = null;
  let bestDist = Infinity;

  for (let i = 0; i < world.nodes.length; i++) {
    const node = world.nodes[i];
    if (node.ownerAgentId !== -1) continue;
    const d = Math.hypot(node.x - x, node.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }

  return best;
}

/**
 * Find the nearest spring on the frame to a point, for attaching thread endpoints.
 */
export function findNearestFrameSpring(
  world: PhysicsWorld,
  x: number,
  y: number,
): { springId: number; t: number; x: number; y: number } | null {
  let best: { springId: number; t: number; dist: number; x: number; y: number } | null = null;

  for (let i = 0; i < world.springs.length; i++) {
    const spring = world.springs[i];
    if (spring.broken || spring.ownerAgentId !== -1) continue;

    const nodeA = world.nodeMap.get(spring.nodeA);
    const nodeB = world.nodeMap.get(spring.nodeB);
    if (!nodeA || !nodeB) continue;

    const dx = nodeB.x - nodeA.x;
    const dy = nodeB.y - nodeA.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0.001
      ? Math.max(0, Math.min(1, ((x - nodeA.x) * dx + (y - nodeA.y) * dy) / lenSq))
      : 0;

    const px = nodeA.x + dx * t;
    const py = nodeA.y + dy * t;
    const dist = Math.hypot(x - px, y - py);

    if (!best || dist < best.dist) {
      best = { springId: spring.id, t, dist, x: px, y: py };
    }
  }

  return best ? { springId: best.springId, t: best.t, x: best.x, y: best.y } : null;
}

/**
 * Split a frame spring at parametric t, inserting a new pinned node.
 * Returns the new node's id.
 */
export function splitFrameSpring(
  world: PhysicsWorld,
  springId: number,
  t: number,
): number {
  const spring = world.springMap.get(springId);
  if (!spring) return -1;

  const nodeA = world.nodeMap.get(spring.nodeA);
  const nodeB = world.nodeMap.get(spring.nodeB);
  if (!nodeA || !nodeB) return -1;

  const nx = nodeA.x + (nodeB.x - nodeA.x) * t;
  const ny = nodeA.y + (nodeB.y - nodeA.y) * t;

  const newNode = addNode(world, nx, ny, true, -1);

  // Create two new springs replacing the old one
  const len1 = spring.restLength * t;
  const len2 = spring.restLength * (1 - t);

  const s1 = addSpring(
    world, spring.nodeA, newNode.id, Math.max(1, len1),
    spring.stiffness, spring.damping, spring.maxExtension,
    spring.adhesion, spring.type, spring.ownerAgentId, spring.color,
  );
  const s2 = addSpring(
    world, newNode.id, spring.nodeB, Math.max(1, len2),
    spring.stiffness, spring.damping, spring.maxExtension,
    spring.adhesion, spring.type, spring.ownerAgentId, spring.color,
  );

  // Update the thread that contains this spring
  for (const thread of world.threads) {
    const idx = thread.springIds.indexOf(springId);
    if (idx !== -1) {
      thread.springIds.splice(idx, 1, s1.id, s2.id);
      break;
    }
  }

  // Mark old spring as broken and remove from adjacency
  spring.broken = true;
  const adjA = world.nodeAdjacency.get(spring.nodeA);
  if (adjA) {
    const i = adjA.indexOf(springId);
    if (i !== -1) adjA.splice(i, 1);
  }
  const adjB = world.nodeAdjacency.get(spring.nodeB);
  if (adjB) {
    const i = adjB.indexOf(springId);
    if (i !== -1) adjB.splice(i, 1);
  }

  return newNode.id;
}

/**
 * Apply an impulse to a spring (from fly impact).
 */
export function applyImpulse(
  world: PhysicsWorld,
  springId: number,
  t: number,
  impulseX: number,
  impulseY: number,
): void {
  const spring = world.springMap.get(springId);
  if (!spring || spring.broken) return;

  const nodeA = world.nodeMap.get(spring.nodeA);
  const nodeB = world.nodeMap.get(spring.nodeB);
  if (!nodeA || !nodeB) return;

  // Apply as velocity change (shift prevPos)
  const forceA = 1 - t;
  const forceB = t;

  if (!nodeA.pinned) {
    nodeA.prevX -= impulseX * forceA / nodeA.mass;
    nodeA.prevY -= impulseY * forceA / nodeA.mass;
  }
  if (!nodeB.pinned) {
    nodeB.prevX -= impulseX * forceB / nodeB.mass;
    nodeB.prevY -= impulseY * forceB / nodeB.mass;
  }
}

/**
 * Get the interpolated position along a spring.
 */
export function getSpringPosition(
  world: PhysicsWorld,
  springId: number,
  t: number,
): { x: number; y: number } | null {
  const spring = world.springMap.get(springId);
  if (!spring) return null;

  const nodeA = world.nodeMap.get(spring.nodeA);
  const nodeB = world.nodeMap.get(spring.nodeB);
  if (!nodeA || !nodeB) return null;

  return {
    x: nodeA.x + (nodeB.x - nodeA.x) * t,
    y: nodeA.y + (nodeB.y - nodeA.y) * t,
  };
}

/**
 * Clean up broken springs, orphaned nodes. Call periodically.
 */
export function cleanup(world: PhysicsWorld): void {
  // Remove broken springs from threads and adjacency
  const brokenIds = new Set<number>();
  for (let i = world.springs.length - 1; i >= 0; i--) {
    if (world.springs[i].broken) {
      const spring = world.springs[i];
      brokenIds.add(spring.id);

      // Remove from adjacency
      const adjA = world.nodeAdjacency.get(spring.nodeA);
      if (adjA) {
        const idx = adjA.indexOf(spring.id);
        if (idx !== -1) adjA.splice(idx, 1);
      }
      const adjB = world.nodeAdjacency.get(spring.nodeB);
      if (adjB) {
        const idx = adjB.indexOf(spring.id);
        if (idx !== -1) adjB.splice(idx, 1);
      }

      world.springMap.delete(spring.id);
      world.springs.splice(i, 1);
    }
  }

  // Remove broken spring ids from threads
  for (const thread of world.threads) {
    thread.springIds = thread.springIds.filter(id => !brokenIds.has(id));
  }

  // Remove empty threads
  for (let i = world.threads.length - 1; i >= 0; i--) {
    if (world.threads[i].springIds.length === 0) {
      world.threadMap.delete(world.threads[i].id);
      world.threads.splice(i, 1);
    }
  }

  // Find orphaned nodes (no springs, not pinned frame nodes)
  const connectedNodeIds = new Set<number>();
  for (const spring of world.springs) {
    connectedNodeIds.add(spring.nodeA);
    connectedNodeIds.add(spring.nodeB);
  }

  for (let i = world.nodes.length - 1; i >= 0; i--) {
    const node = world.nodes[i];
    if (!connectedNodeIds.has(node.id) && !(node.pinned && node.ownerAgentId === -1)) {
      world.nodeMap.delete(node.id);
      world.nodeAdjacency.delete(node.id);
      world.nodes.splice(i, 1);
    }
  }
}

/**
 * Count non-broken springs for an agent.
 */
export function countAgentSprings(world: PhysicsWorld, agentId: number): number {
  let count = 0;
  for (const spring of world.springs) {
    if (!spring.broken && spring.ownerAgentId === agentId) count++;
  }
  return count;
}

/**
 * Count threads for an agent.
 */
export function countAgentThreads(world: PhysicsWorld, agentId: number): number {
  let count = 0;
  for (const thread of world.threads) {
    if (thread.ownerAgentId === agentId) count++;
  }
  return count;
}
