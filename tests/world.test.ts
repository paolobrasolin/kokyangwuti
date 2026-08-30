import { describe, expect, test } from '@rstest/core';
import { PHYSICS } from '../src/physics/config';
import type { PhysicsWorld } from '../src/physics/types';
import {
  addNode,
  addSpring,
  addThread,
  buildBranches,
  buildFrame,
  cleanup,
  countAgentSprings,
  countAgentThreads,
  createSubdividedThread,
  createWorld,
  findNearestFrameNode,
  findNearestFrameSpring,
  findNearestSpring,
  getConnectedSprings,
  getSpringPosition,
  rayVsSprings,
  splitFrameSpring,
} from '../src/physics/world';
import { createRng } from '../src/rng';
import type { SilkProfile } from '../src/types';

const SILK: SilkProfile = {
  strength: 1,
  extensibility: 0.5,
  damping: 0.4,
  adhesion: 0.2,
  tension: 0.3,
};

function springOf(world: PhysicsWorld, id: number) {
  const spring = world.springMap.get(id);
  if (!spring) throw new Error(`no spring ${id}`);
  return spring;
}

function nodeOf(world: PhysicsWorld, id: number) {
  const node = world.nodeMap.get(id);
  if (!node) throw new Error(`no node ${id}`);
  return node;
}

function link(
  world: PhysicsWorld,
  aId: number,
  bId: number,
  owner = 0,
  restLength = 10,
): number {
  return addSpring(
    world,
    aId,
    bId,
    restLength,
    1,
    0.1,
    100,
    0,
    'radial',
    owner,
    '#fff',
  ).id;
}

describe('addNode / addSpring bookkeeping', () => {
  test('nodes get sequential ids and are registered in the maps', () => {
    const world = createWorld();
    const a = addNode(world, 1, 2, false, 7);
    const b = addNode(world, 3, 4, true, -1, 5);

    expect(a.id).toBe(0);
    expect(b.id).toBe(1);
    expect(world.nextNodeId).toBe(2);
    expect(world.nodes).toEqual([a, b]);
    expect(world.nodeMap.get(a.id)).toBe(a);
    expect(world.nodeAdjacency.get(a.id)).toEqual([]);
    expect(a.mass).toBe(PHYSICS.defaultNodeMass);
    expect(b.mass).toBe(5);
    expect(a.prevX).toBe(a.x);
    expect(a.prevY).toBe(a.y);
  });

  test('springs update the adjacency of both endpoints', () => {
    const world = createWorld();
    const a = addNode(world, 0, 0, false, 0);
    const b = addNode(world, 10, 0, false, 0);
    const c = addNode(world, 20, 0, false, 0);

    const ab = link(world, a.id, b.id);
    const bc = link(world, b.id, c.id);

    expect(world.nodeAdjacency.get(a.id)).toEqual([ab]);
    expect(world.nodeAdjacency.get(b.id)).toEqual([ab, bc]);
    expect(world.nodeAdjacency.get(c.id)).toEqual([bc]);
    expect(world.springMap.get(ab)?.nodeA).toBe(a.id);
    expect(world.springs).toHaveLength(2);
  });

  test('threads are registered and counted per agent', () => {
    const world = createWorld();
    const a = addNode(world, 0, 0, false, 3);
    const b = addNode(world, 10, 0, false, 3);
    const spring = link(world, a.id, b.id, 3);
    const thread = addThread(world, [spring], a.id, b.id, 'radial', 3);

    expect(world.threadMap.get(thread.id)).toBe(thread);
    expect(countAgentThreads(world, 3)).toBe(1);
    expect(countAgentThreads(world, 4)).toBe(0);
    expect(countAgentSprings(world, 3)).toBe(1);

    springOf(world, spring).broken = true;
    expect(countAgentSprings(world, 3)).toBe(0);
  });
});

describe('getConnectedSprings', () => {
  test('returns live springs and skips broken ones', () => {
    const world = createWorld();
    const hub = addNode(world, 0, 0, false, 0);
    const a = addNode(world, 10, 0, false, 0);
    const b = addNode(world, 0, 10, false, 0);
    const s1 = link(world, hub.id, a.id);
    const s2 = link(world, hub.id, b.id);

    expect(getConnectedSprings(world, hub.id)).toEqual([s1, s2]);

    springOf(world, s1).broken = true;
    expect(getConnectedSprings(world, hub.id)).toEqual([s2]);
  });

  test('returns an empty array for an unknown node', () => {
    expect(getConnectedSprings(createWorld(), 123)).toEqual([]);
  });
});

describe('createSubdividedThread', () => {
  test('produces a chain of segments of the target length', () => {
    const world = createWorld();
    const length = PHYSICS.segmentLength * 4;
    const thread = createSubdividedThread(
      world,
      0,
      0,
      length,
      0,
      SILK,
      'radial',
      2,
      '#abc',
    );

    expect(thread.springIds).toHaveLength(4);
    expect(world.nodes).toHaveLength(5);
    expect(thread.type).toBe('radial');
    expect(thread.ownerAgentId).toBe(2);

    // Endpoints are pinned, interior nodes are free.
    const start = nodeOf(world, thread.startNodeId);
    const end = nodeOf(world, thread.endNodeId);
    expect(start.pinned).toBe(true);
    expect(end.pinned).toBe(true);
    expect(world.nodes.filter((n) => !n.pinned)).toHaveLength(3);

    // The chain is contiguous and evenly spaced along the segment.
    let cursor = thread.startNodeId;
    for (const [index, springId] of thread.springIds.entries()) {
      const spring = springOf(world, springId);
      expect(spring.nodeA).toBe(cursor);
      expect(spring.restLength).toBeCloseTo(PHYSICS.segmentLength);
      expect(spring.type).toBe('radial');
      expect(spring.ownerAgentId).toBe(2);
      expect(spring.color).toBe('#abc');
      const node = nodeOf(world, spring.nodeB);
      expect(node.x).toBeCloseTo(PHYSICS.segmentLength * (index + 1));
      expect(node.y).toBeCloseTo(0);
      cursor = spring.nodeB;
    }
    expect(cursor).toBe(thread.endNodeId);
  });

  test('derives spring parameters from the silk profile', () => {
    const world = createWorld();
    const thread = createSubdividedThread(
      world,
      0,
      0,
      PHYSICS.segmentLength * 2,
      0,
      SILK,
      'capture',
      1,
      '#fff',
    );
    const spring = springOf(world, thread.springIds[0]);

    expect(spring.stiffness).toBeCloseTo(0.3 + SILK.strength * 0.7);
    expect(spring.damping).toBeCloseTo(SILK.damping * 0.5);
    expect(spring.maxExtension).toBeCloseTo(
      PHYSICS.segmentLength * (1 + SILK.extensibility * 2),
    );
    expect(spring.adhesion).toBe(SILK.adhesion);
  });

  test('reuses supplied endpoint nodes instead of creating new ones', () => {
    const world = createWorld();
    const anchorA = addNode(world, 0, 0, true, -1);
    const anchorB = addNode(world, 100, 0, true, -1);
    const before = world.nodes.length;

    const thread = createSubdividedThread(
      world,
      0,
      0,
      100,
      0,
      SILK,
      'radial',
      1,
      '#fff',
      anchorA.id,
      anchorB.id,
    );

    expect(thread.startNodeId).toBe(anchorA.id);
    expect(thread.endNodeId).toBe(anchorB.id);
    // Only the interior nodes were added.
    expect(world.nodes.length).toBe(before + thread.springIds.length - 1);
  });

  test('a very short thread is a single spring between two nodes', () => {
    const world = createWorld();
    const thread = createSubdividedThread(
      world,
      0,
      0,
      1,
      0,
      SILK,
      'radial',
      1,
      '#fff',
    );

    expect(thread.springIds).toHaveLength(1);
    expect(world.nodes).toHaveLength(2);
  });
});

describe('splitFrameSpring', () => {
  function frameWorld() {
    const world = createWorld();
    const a = addNode(world, 0, 0, true, -1);
    const b = addNode(world, 100, 0, true, -1);
    const springId = addSpring(
      world,
      a.id,
      b.id,
      100,
      1,
      0.15,
      300,
      0,
      'frame',
      -1,
      '#123',
    ).id;
    const thread = addThread(world, [springId], a.id, b.id, 'frame', -1);
    return { world, a, b, springId, thread };
  }

  test('inserts a pinned node and replaces the spring with two halves', () => {
    const { world, a, b, springId, thread } = frameWorld();

    const newId = splitFrameSpring(world, springId, 0.25);
    const node = nodeOf(world, newId);

    expect(node.x).toBeCloseTo(25);
    expect(node.y).toBeCloseTo(0);
    expect(node.pinned).toBe(true);
    expect(node.ownerAgentId).toBe(-1);

    expect(world.springMap.get(springId)?.broken).toBe(true);
    expect(thread.springIds).toHaveLength(2);
    expect(thread.springIds).not.toContain(springId);

    const [first, second] = thread.springIds.map((id) => springOf(world, id));
    expect(first.nodeA).toBe(a.id);
    expect(first.nodeB).toBe(newId);
    expect(second.nodeA).toBe(newId);
    expect(second.nodeB).toBe(b.id);
    expect(first.restLength).toBeCloseTo(25);
    expect(second.restLength).toBeCloseTo(75);
    expect(first.type).toBe('frame');
    expect(first.color).toBe('#123');
  });

  test('keeps adjacency consistent: the old spring is dropped, halves are linked', () => {
    const { world, a, b, springId } = frameWorld();

    const newId = splitFrameSpring(world, springId, 0.5);

    for (const nodeId of [a.id, b.id, newId]) {
      expect(world.nodeAdjacency.get(nodeId)).not.toContain(springId);
    }
    expect(world.nodeAdjacency.get(newId)).toHaveLength(2);
    expect(getConnectedSprings(world, a.id)).toHaveLength(1);
    expect(getConnectedSprings(world, b.id)).toHaveLength(1);
    expect(getConnectedSprings(world, newId)).toHaveLength(2);
  });

  test('the halves inherit the extension ratio, not the absolute limit', () => {
    const { world, springId } = frameWorld(); // restLength 100, maxExtension 300
    const newId = splitFrameSpring(world, springId, 0.25);
    const halves = world.springs.filter((s) => !s.broken);

    expect(newId).not.toBe(-1);
    for (const half of halves) {
      // Extensibility is a material property: a short half must not become
      // effectively unbreakable by keeping its parent's absolute maxExtension.
      expect(half.maxExtension / half.restLength).toBeCloseTo(3);
    }
  });

  test('never produces a zero rest length at the extremes', () => {
    const { world, springId } = frameWorld();
    const newId = splitFrameSpring(world, springId, 0);
    const halves = world.springs.filter((s) => !s.broken);

    expect(newId).not.toBe(-1);
    for (const half of halves)
      expect(half.restLength).toBeGreaterThanOrEqual(1);
  });

  test('returns -1 for an unknown spring', () => {
    const { world } = frameWorld();
    expect(splitFrameSpring(world, 999, 0.5)).toBe(-1);
  });
});

describe('cleanup', () => {
  test('removes broken springs from the list, map, adjacency and threads', () => {
    const world = createWorld();
    const a = addNode(world, 0, 0, true, -1);
    const b = addNode(world, 10, 0, false, 1);
    const c = addNode(world, 20, 0, false, 1);
    const ab = link(world, a.id, b.id, 1);
    const bc = link(world, b.id, c.id, 1);
    const thread = addThread(world, [ab, bc], a.id, c.id, 'radial', 1);

    springOf(world, bc).broken = true;
    cleanup(world);

    expect(world.springs.map((s) => s.id)).toEqual([ab]);
    expect(world.springMap.has(bc)).toBe(false);
    expect(world.nodeAdjacency.get(b.id)).toEqual([ab]);
    expect(thread.springIds).toEqual([ab]);
  });

  test('drops orphaned agent nodes but keeps pinned frame nodes', () => {
    const world = createWorld();
    const frameNode = addNode(world, 0, 0, true, -1);
    const agentNode = addNode(world, 10, 0, false, 1);
    const lonely = addNode(world, 50, 50, false, 1);
    const spring = link(world, frameNode.id, agentNode.id, 1);

    cleanup(world);
    expect(world.nodes.map((n) => n.id)).toEqual([frameNode.id, agentNode.id]);
    expect(world.nodeMap.has(lonely.id)).toBe(false);
    expect(world.nodeAdjacency.has(lonely.id)).toBe(false);

    springOf(world, spring).broken = true;
    cleanup(world);
    expect(world.nodes.map((n) => n.id)).toEqual([frameNode.id]);
    expect(world.nodeMap.has(agentNode.id)).toBe(false);
  });

  test('removes threads that lost all their springs', () => {
    const world = createWorld();
    const a = addNode(world, 0, 0, true, -1);
    const b = addNode(world, 10, 0, true, -1);
    const spring = link(world, a.id, b.id, 1);
    const thread = addThread(world, [spring], a.id, b.id, 'radial', 1);

    springOf(world, spring).broken = true;
    cleanup(world);

    expect(world.threads).toHaveLength(0);
    expect(world.threadMap.has(thread.id)).toBe(false);
  });

  test('is a no-op on a healthy world and stays idempotent', () => {
    const world = createWorld();
    createSubdividedThread(world, 0, 0, 100, 0, SILK, 'radial', 1, '#fff');
    const nodes = world.nodes.length;
    const springs = world.springs.length;

    cleanup(world);
    cleanup(world);

    expect(world.nodes).toHaveLength(nodes);
    expect(world.springs).toHaveLength(springs);
    expect(world.nodeMap.size).toBe(nodes);
    expect(world.springMap.size).toBe(springs);
    for (const spring of world.springs) {
      expect(world.nodeAdjacency.get(spring.nodeA)).toContain(spring.id);
      expect(world.nodeAdjacency.get(spring.nodeB)).toContain(spring.id);
    }
  });
});

describe('spatial queries', () => {
  test('findNearestSpring returns the closest spring with its parametric t', () => {
    const world = createWorld();
    const a = addNode(world, 0, 0, true, -1);
    const b = addNode(world, 100, 0, true, -1);
    const c = addNode(world, 0, 50, false, 4);
    const frame = link(world, a.id, b.id, -1, 100);
    const owned = link(world, a.id, c.id, 4, 50);

    const near = findNearestSpring(world, 40, 5);
    expect(near?.springId).toBe(frame);
    expect(near?.t).toBeCloseTo(0.4);
    expect(near?.dist).toBeCloseTo(5);
    expect(near?.x).toBeCloseTo(40);
    expect(near?.y).toBeCloseTo(0);

    // Owner -1 restricts to frame springs; owner 4 allows frame + agent 4.
    expect(findNearestSpring(world, 2, 40, -1)?.springId).toBe(frame);
    expect(findNearestSpring(world, 2, 40, 4)?.springId).toBe(owned);
  });

  test('findNearestSpring honours maxDist and skips broken springs', () => {
    const world = createWorld();
    const a = addNode(world, 0, 0, true, -1);
    const b = addNode(world, 100, 0, true, -1);
    const spring = link(world, a.id, b.id, -1, 100);

    expect(findNearestSpring(world, 50, 200)).not.toBeNull();
    expect(findNearestSpring(world, 50, 200, undefined, 10)).toBeNull();

    springOf(world, spring).broken = true;
    expect(findNearestSpring(world, 50, 1)).toBeNull();
  });

  test('findNearestSpring clamps t to the segment', () => {
    const world = createWorld();
    const a = addNode(world, 0, 0, true, -1);
    const b = addNode(world, 100, 0, true, -1);
    link(world, a.id, b.id, -1, 100);

    expect(findNearestSpring(world, -50, 0)?.t).toBe(0);
    expect(findNearestSpring(world, 500, 0)?.t).toBe(1);
  });

  test('findNearestFrameNode and findNearestFrameSpring ignore agent geometry', () => {
    const world = createWorld();
    const a = addNode(world, 0, 0, true, -1);
    const b = addNode(world, 100, 0, true, -1);
    const agentNode = addNode(world, 50, 1, false, 2);
    link(world, a.id, b.id, -1, 100);
    const agentSpring = link(world, a.id, agentNode.id, 2, 50);

    expect(findNearestFrameNode(world, 90, 0)?.id).toBe(b.id);
    const frameHit = findNearestFrameSpring(world, 50, 20);
    expect(frameHit?.t).toBeCloseTo(0.5);
    expect(frameHit?.springId).not.toBe(agentSpring);
  });

  test('getSpringPosition interpolates along the spring', () => {
    const world = createWorld();
    const a = addNode(world, 0, 0, true, -1);
    const b = addNode(world, 100, 200, true, -1);
    const spring = link(world, a.id, b.id, -1, 100);

    expect(getSpringPosition(world, spring, 0.25)).toEqual({ x: 25, y: 50 });
    expect(getSpringPosition(world, 999, 0.5)).toBeNull();
  });

  test('rayVsSprings finds the first agent spring crossed and skips frame silk', () => {
    const world = createWorld();
    const top = addNode(world, 50, 0, false, 1);
    const bottom = addNode(world, 50, 100, false, 1);
    const far = addNode(world, 80, 0, false, 1);
    const farBottom = addNode(world, 80, 100, false, 1);
    const frameA = addNode(world, 20, 0, true, -1);
    const frameB = addNode(world, 20, 100, true, -1);

    link(world, frameA.id, frameB.id, -1, 100);
    const nearSpring = link(world, top.id, bottom.id, 1, 100);
    link(world, far.id, farBottom.id, 1, 100);

    const hit = rayVsSprings(world, 0, 50, 200, 50);
    expect(hit?.springId).toBe(nearSpring);
    expect(hit?.point.x).toBeCloseTo(50);
    expect(hit?.dist).toBeCloseTo(50);
    expect(hit?.t).toBeCloseTo(0.5);

    // Owner filter excludes other agents' silk.
    expect(rayVsSprings(world, 0, 50, 200, 50, 9)).toBeNull();
    // A ray that misses everything.
    expect(rayVsSprings(world, 0, 200, 200, 200)).toBeNull();
  });
});

describe('buildFrame / buildBranches', () => {
  test('buildFrame makes four closed edges of pinned nodes', () => {
    const world = createWorld();
    const threadIds = buildFrame(world, 300, 200);

    expect(threadIds).toHaveLength(4);
    expect(world.nodes.every((n) => n.pinned && n.ownerAgentId === -1)).toBe(
      true,
    );

    // Corners are shared, so the four edges form a loop.
    const corners = [
      [0, 0],
      [300, 0],
      [300, 200],
      [0, 200],
    ];
    for (const [x, y] of corners) {
      const matches = world.nodes.filter((n) => n.x === x && n.y === y);
      expect(matches).toHaveLength(1);
      expect(getConnectedSprings(world, matches[0].id)).toHaveLength(2);
    }
  });

  test('buildBranches is a pure function of its rng stream', () => {
    const build = (seed: number) => {
      const world = createWorld();
      const ids = buildBranches(world, 400, 300, createRng(seed));
      return {
        ids,
        points: world.nodes.map((n) => [n.x, n.y]),
      };
    };

    expect(build(1234)).toEqual(build(1234));
    expect(build(1234)).not.toEqual(build(5678));

    const built = build(1234);
    expect(built.ids.length).toBeGreaterThan(0);
    for (const [x, y] of built.points) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
});
