/**
 * A uniform grid over the springs, so that "which threads could this short
 * segment cross?" and "which threads are within a leg's reach?" look at a few
 * dozen springs instead of every spring in the arena.
 *
 * This is purely an accelerator: every query returns exactly the candidates a
 * scan of `world.springs` would have considered, in the same order (ascending
 * id, which is array order), so the callers' first-hit and nearest logic — and
 * therefore the simulation — is bit-for-bit what it was without the grid. Two
 * things make that hold:
 *
 * - a spring is filed under every cell its bounding box, grown by `MARGIN`,
 *   touches, and a query visits every cell its own (padded) box touches, so the
 *   candidate set is a superset of the true answer;
 * - a node's position at the time its springs were filed is remembered, and as
 *   soon as a node has drifted more than `MARGIN` from it, all its springs are
 *   taken out of the cells they were in and filed again where they now are. A
 *   full rebuild happens only when the world changes shape (`geometryVersion`:
 *   cleanup, or hand-moved nodes).
 *
 * Callers still filter by owner, type, `broken` and exact geometry, as before.
 */

import type { PhysicsNode, PhysicsWorld, Spring } from './types';

/**
 * Cell edge, px. Silk segments are ~25 px and substrate segments ~50 px, so a
 * spring rarely touches more than a 2×2 block of cells.
 */
export const GRID_CELL = 64;
/** Query boxes grow by this much so rounding at a cell edge cannot lose a hit. */
const PAD = 1;
/**
 * Slack, px, that a filed spring's box is grown by: how far either endpoint may
 * drift before the spring has to be filed again. A settled web drifts almost
 * nothing per tick, so refiling stays confined to whatever is actually moving.
 */
export const MARGIN = 16;

export interface SpringGrid {
  /** `world.geometryVersion` the grid was built for. */
  version: number;
  /** `world.motion` at the last drift check. */
  motionAtCheck: number;
  cellSize: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  cells: Spring[][];
  /** Per spring id, 4 wide: the cell range (c0, c1, r0, r1) it is filed in, or c0 = -1. */
  ranges: Int32Array;
  /** Diagnostics: full rebuilds and node refilings so far. */
  rebuilds: number;
  refiles: number;
  /** Per spring id: the query stamp that last emitted it. Dedupes across cells. */
  marks: Uint32Array;
  stamp: number;
  /** Per node id: where the node was when its springs were last filed. */
  filedX: Float64Array;
  filedY: Float64Array;
}

/** Note that node positions changed and every spatial answer must be recomputed. */
export function markGeometryChanged(world: PhysicsWorld): void {
  world.geometryVersion++;
}

function emptyGrid(): SpringGrid {
  return {
    version: -1,
    motionAtCheck: 0,
    cellSize: GRID_CELL,
    minX: 0,
    minY: 0,
    cols: 0,
    rows: 0,
    cells: [],
    ranges: new Int32Array(0),
    rebuilds: 0,
    refiles: 0,
    marks: new Uint32Array(0),
    stamp: 0,
    filedX: new Float64Array(0),
    filedY: new Float64Array(0),
  };
}

function ensureCapacity(grid: SpringGrid, world: PhysicsWorld): void {
  if (grid.marks.length < world.nextSpringId) {
    const size = Math.max(64, world.nextSpringId * 2);
    const marks = new Uint32Array(size);
    marks.set(grid.marks);
    grid.marks = marks;
    const ranges = new Int32Array(size * 4).fill(-1);
    ranges.set(grid.ranges);
    grid.ranges = ranges;
  }
  if (grid.filedX.length < world.nextNodeId) {
    const size = Math.max(64, world.nextNodeId * 2);
    const nextX = new Float64Array(size);
    const nextY = new Float64Array(size);
    nextX.set(grid.filedX);
    nextY.set(grid.filedY);
    grid.filedX = nextX;
    grid.filedY = nextY;
  }
}

function clampIndex(index: number, last: number): number {
  if (!(index > 0)) return 0; // also catches NaN
  return index > last ? last : index;
}

/** Take a spring out of every cell it is filed in. Order within a cell is free. */
function unfile(grid: SpringGrid, spring: Spring): void {
  const at = spring.id * 4;
  const ranges = grid.ranges;
  const c0 = ranges[at];
  if (c0 < 0) return;
  const c1 = ranges[at + 1];
  const r0 = ranges[at + 2];
  const r1 = ranges[at + 3];
  for (let r = r0; r <= r1; r++) {
    const row = r * grid.cols;
    for (let c = c0; c <= c1; c++) {
      const cell = grid.cells[row + c];
      const i = cell.indexOf(spring);
      if (i < 0) continue;
      cell[i] = cell[cell.length - 1];
      cell.pop();
    }
  }
  ranges[at] = -1;
}

/** File one spring under every cell its margin-grown box touches. */
function file(grid: SpringGrid, spring: Spring): void {
  const a = spring.a;
  const b = spring.b;
  const size = grid.cellSize;
  const lastCol = grid.cols - 1;
  const lastRow = grid.rows - 1;
  const c0 = clampIndex(
    Math.floor((Math.min(a.x, b.x) - MARGIN - grid.minX) / size),
    lastCol,
  );
  const c1 = clampIndex(
    Math.floor((Math.max(a.x, b.x) + MARGIN - grid.minX) / size),
    lastCol,
  );
  const r0 = clampIndex(
    Math.floor((Math.min(a.y, b.y) - MARGIN - grid.minY) / size),
    lastRow,
  );
  const r1 = clampIndex(
    Math.floor((Math.max(a.y, b.y) + MARGIN - grid.minY) / size),
    lastRow,
  );
  for (let r = r0; r <= r1; r++) {
    const row = r * grid.cols;
    for (let c = c0; c <= c1; c++) grid.cells[row + c].push(spring);
  }
  const at = spring.id * 4;
  grid.ranges[at] = c0;
  grid.ranges[at + 1] = c1;
  grid.ranges[at + 2] = r0;
  grid.ranges[at + 3] = r1;
}

function remember(grid: SpringGrid, node: PhysicsNode): void {
  grid.filedX[node.id] = node.x;
  grid.filedY[node.id] = node.y;
}

/** Move every live spring at `node` to where it is now, and remember the spot. */
function refileNode(
  grid: SpringGrid,
  world: PhysicsWorld,
  node: PhysicsNode,
): void {
  const incident = world.nodeAdjacency.get(node.id);
  if (incident) {
    for (const springId of incident) {
      const spring = world.springMap.get(springId);
      if (!spring || spring.broken) continue;
      unfile(grid, spring);
      file(grid, spring);
    }
  }
  remember(grid, node);
  grid.refiles++;
}

function rebuild(world: PhysicsWorld, grid: SpringGrid): void {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of world.nodes) {
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
  }

  ensureCapacity(grid, world);
  grid.ranges.fill(-1);
  grid.rebuilds++;

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    grid.cols = 0;
    grid.rows = 0;
    grid.cells.length = 0;
  } else {
    const size = grid.cellSize;
    const cols = Math.floor((maxX - minX) / size) + 1;
    const rows = Math.floor((maxY - minY) / size) + 1;
    grid.minX = minX;
    grid.minY = minY;
    if (grid.cols !== cols || grid.rows !== rows) {
      grid.cols = cols;
      grid.rows = rows;
      grid.cells = Array.from({ length: cols * rows }, () => []);
    } else {
      for (const cell of grid.cells) cell.length = 0;
    }
    for (const spring of world.springs) {
      if (spring.broken) continue;
      file(grid, spring);
    }
    for (const node of world.nodes) remember(grid, node);
  }

  grid.version = world.geometryVersion;
  grid.motionAtCheck = world.motion;
}

/**
 * Catch up with whatever the solver moved since the last query: every node
 * that has drifted past `MARGIN` gets its springs filed again. One cheap pass
 * over the nodes, instead of a rebuild every few ticks for the sake of the few
 * that are actually moving.
 */
function refileDrifted(world: PhysicsWorld, grid: SpringGrid): void {
  const filedX = grid.filedX;
  const filedY = grid.filedY;
  for (const node of world.nodes) {
    if (node.pinned) continue;
    const id = node.id;
    if (
      Math.abs(node.x - filedX[id]) > MARGIN ||
      Math.abs(node.y - filedY[id]) > MARGIN
    ) {
      refileNode(grid, world, node);
    }
  }
  grid.motionAtCheck = world.motion;
}

/** The grid, built, refiled or refreshed as needed. */
function currentGrid(world: PhysicsWorld): SpringGrid {
  let grid = world.grid;
  if (!grid) {
    grid = emptyGrid();
    world.grid = grid;
  }
  if (
    grid.version !== world.geometryVersion ||
    (grid.cols === 0 && world.springs.length > 0)
  ) {
    rebuild(world, grid);
  } else if (grid.motionAtCheck !== world.motion) {
    refileDrifted(world, grid);
  }
  return grid;
}

/**
 * File a spring that was just added. Only when the grid is current — a stale
 * grid will pick the spring up when it is next rebuilt anyway. Endpoints that
 * have drifted since their springs were filed are refiled wholesale, so the
 * remembered position stays a valid reference for every spring at the node.
 */
export function gridAddSpring(world: PhysicsWorld, spring: Spring): void {
  const grid = world.grid;
  if (!grid || grid.version !== world.geometryVersion || grid.cols === 0)
    return;
  if (grid.motionAtCheck !== world.motion) refileDrifted(world, grid);
  ensureCapacity(grid, world);
  file(grid, spring);
  for (const node of [spring.a, spring.b]) {
    if (node.x !== grid.filedX[node.id] || node.y !== grid.filedY[node.id]) {
      refileNode(grid, world, node);
    }
  }
}

/**
 * Every spring whose bounding box may overlap the given box, ascending by id
 * (which is `world.springs` order). Includes broken springs the caller must
 * skip, exactly as a full scan would meet them.
 */
export function springsInBox(
  world: PhysicsWorld,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Spring[] {
  const grid = currentGrid(world);
  const out: Spring[] = [];
  if (grid.cols === 0) return out;

  const size = grid.cellSize;
  const lastCol = grid.cols - 1;
  const lastRow = grid.rows - 1;
  const c0 = clampIndex(Math.floor((minX - PAD - grid.minX) / size), lastCol);
  const c1 = clampIndex(Math.floor((maxX + PAD - grid.minX) / size), lastCol);
  const r0 = clampIndex(Math.floor((minY - PAD - grid.minY) / size), lastRow);
  const r1 = clampIndex(Math.floor((maxY + PAD - grid.minY) / size), lastRow);

  if (grid.stamp >= 0xfffffffe) {
    grid.marks.fill(0);
    grid.stamp = 0;
  }
  const stamp = ++grid.stamp;
  const marks = grid.marks;

  for (let r = r0; r <= r1; r++) {
    const row = r * grid.cols;
    for (let c = c0; c <= c1; c++) {
      for (const spring of grid.cells[row + c]) {
        if (marks[spring.id] === stamp) continue;
        marks[spring.id] = stamp;
        out.push(spring);
      }
    }
  }
  if (out.length > 1) out.sort((a, b) => a.id - b.id);
  return out;
}

/** Springs within `radius` of a point — as candidates; callers measure exactly. */
export function springsNear(
  world: PhysicsWorld,
  x: number,
  y: number,
  radius: number,
): Spring[] {
  return springsInBox(world, x - radius, y - radius, x + radius, y + radius);
}
