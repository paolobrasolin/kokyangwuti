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
 * - a spring is filed under every cell its bounding box touches, and a query
 *   visits every cell its own (padded) box touches, so the candidate set is a
 *   superset of the true answer;
 * - every spring is filed with its box grown by `MARGIN`, and the grid is
 *   rebuilt as soon as the solver reports that nodes may have drifted that far
 *   in total since the build (`world.motion`) or the world changed shape
 *   (`geometryVersion`: cleanup, or hand-moved nodes). A spring added while the
 *   grid is current is filed straight away.
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
 * Slack, px, that a filed spring's box is grown by. Nodes may drift up to this
 * far in total before the grid has to be rebuilt; a settled web drifts almost
 * nothing per tick, so rebuilds become rare instead of once per tick.
 */
export const MARGIN = 16;

export interface SpringGrid {
  /** `world.geometryVersion` the grid was built for. */
  version: number;
  /** `world.motion` when the grid was built. */
  motionAtBuild: number;
  cellSize: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  cells: Spring[][];
  /** Per spring id: the query stamp that last emitted it. Dedupes across cells. */
  marks: Uint32Array;
  stamp: number;
}

/** Note that node positions changed and every spatial answer must be recomputed. */
export function markGeometryChanged(world: PhysicsWorld): void {
  world.geometryVersion++;
}

function emptyGrid(): SpringGrid {
  return {
    version: -1,
    motionAtBuild: 0,
    cellSize: GRID_CELL,
    minX: 0,
    minY: 0,
    cols: 0,
    rows: 0,
    cells: [],
    marks: new Uint32Array(0),
    stamp: 0,
  };
}

function ensureMarks(grid: SpringGrid, world: PhysicsWorld): void {
  if (grid.marks.length < world.nextSpringId) {
    const next = new Uint32Array(Math.max(64, world.nextSpringId * 2));
    next.set(grid.marks);
    grid.marks = next;
  }
}

function file(
  grid: SpringGrid,
  spring: Spring,
  a: PhysicsNode,
  b: PhysicsNode,
) {
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
}

function clampIndex(index: number, last: number): number {
  if (!(index > 0)) return 0; // also catches NaN
  return index > last ? last : index;
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
      file(grid, spring, spring.a, spring.b);
    }
  }

  ensureMarks(grid, world);
  grid.version = world.geometryVersion;
  grid.motionAtBuild = world.motion;
}

function isCurrent(grid: SpringGrid, world: PhysicsWorld): boolean {
  return (
    grid.version === world.geometryVersion &&
    world.motion - grid.motionAtBuild <= MARGIN
  );
}

/** The grid, built or refreshed as needed. */
function currentGrid(world: PhysicsWorld): SpringGrid {
  let grid = world.grid;
  if (!grid) {
    grid = emptyGrid();
    world.grid = grid;
  }
  if (!isCurrent(grid, world)) rebuild(world, grid);
  return grid;
}

/**
 * File a spring that was just added. Only when the grid is current — a stale
 * grid will pick the spring up when it is next rebuilt anyway.
 */
export function gridAddSpring(world: PhysicsWorld, spring: Spring): void {
  const grid = world.grid;
  if (!grid || !isCurrent(grid, world)) return;
  if (grid.cols === 0) {
    // Built over an empty world: there are no cells to file into yet.
    grid.version = -1;
    return;
  }
  ensureMarks(grid, world);
  file(grid, spring, spring.a, spring.b);
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
