import type { SilkType } from '../types';
import type { SpringGrid } from './grid';

export interface PhysicsNode {
  id: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  accX: number;
  accY: number;
  mass: number;
  pinned: boolean;
  ownerAgentId: number; // -1 for frame nodes
}

export interface Spring {
  id: number;
  nodeA: number; // node id
  nodeB: number; // node id
  /** The endpoint nodes themselves. A live spring's nodes are never removed. */
  a: PhysicsNode;
  b: PhysicsNode;
  restLength: number;
  stiffness: number;
  damping: number;
  maxExtension: number;
  adhesion: number;
  type: SilkType;
  ownerAgentId: number; // -1 for frame springs
  broken: boolean;
  color: string;
}

export interface Thread {
  id: number;
  springIds: number[];
  startNodeId: number;
  endNodeId: number;
  type: SilkType;
  ownerAgentId: number;
}

export interface PhysicsWorld {
  nodes: PhysicsNode[];
  springs: Spring[];
  threads: Thread[];
  gravity: number;
  globalDamping: number;
  nextNodeId: number;
  nextSpringId: number;
  nextThreadId: number;
  // Index maps for fast lookup
  nodeMap: Map<number, PhysicsNode>;
  springMap: Map<number, Spring>;
  threadMap: Map<number, Thread>;
  // Adjacency: nodeId -> springIds connected to it
  nodeAdjacency: Map<number, number[]>;
  /**
   * Bumped whenever node positions may have moved (solver step, cleanup).
   * Spatial queries rebuild `grid` when it falls behind this. Code that moves
   * nodes by hand must call `markGeometryChanged`.
   */
  geometryVersion: number;
  /**
   * Running sum of the largest single-node displacement of every solver step.
   * A bound on how far any node has drifted since some earlier moment, used
   * to decide when the spatial index must be rebuilt.
   */
  motion: number;
  /** Spatial index over the springs; built on first use. See `grid.ts`. */
  grid: SpringGrid | null;
}
