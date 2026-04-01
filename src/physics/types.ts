import type { SilkType } from '../types';

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
}
