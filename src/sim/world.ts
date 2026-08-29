// ─────────────────────────────────────────────────────────────────────────────
// World generation.
//
// A maze is the wrong shape for ants that steer. In a corridor one cell wide
// an ant's antennae span the whole passage, so there is nothing to steer
// towards and continuous movement collapses back into following a tube. Trails
// only become interesting where there is room to lay them somewhere other than
// the only place you could have walked.
//
// So the default world is a room, not a maze: mostly open floor with a few
// dense edges. The vocabulary is a kitchen, because a kitchen is a space we all
// have a spatial intuition for and it happens to contain exactly the features
// worth simulating —
//
//   open floor        the expanse, where trails braid, drift and compete
//   grout lines       long thin channels of hard surface that hold a trail;
//                     real ants follow them, and here they do too
//   counter run       a plateau reached only at a couple of points
//   table             the same, with legs for access, and crumbs beneath it
//   under the units   the tight dark maze, pushed to the edge where it belongs
//   a spill           passable, but it will not hold a scent
//   the mat           slow to cross, but shelters what is laid there
//   the step          one-way, so the way out is not the way back
//
// Terrain is generated with the space rather than painted onto it: ground is a
// consequence of what a place is for.
// ─────────────────────────────────────────────────────────────────────────────

import type { Rng } from "./rng";
import { Facing, Terrain, TerrainLayer } from "./terrain";

export type CellType = 0 | 1;
export type WorldKind = "kitchen" | "maze";

export interface GeneratedWorld {
  grid: CellType[][];
  terrain: TerrainLayer;
  /** Candidate nest cells, best first. Cracks in the skirting, for a kitchen. */
  nests: [number, number][];
  /** Where crumbs collect. Food prefers these. */
  crumbZones: [number, number][];
}

interface Rect { x: number; y: number; w: number; h: number }

// ─── Small helpers over a grid ───────────────────────────────────────────────

function blankGrid(cols: number, rows: number): CellType[][] {
  return Array.from({ length: rows }, () => Array<CellType>(cols).fill(0));
}

function carveRect(grid: CellType[][], r: Rect) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (grid[y]?.[x] !== undefined) grid[y][x] = 1;
    }
  }
}

function fillRect(grid: CellType[][], r: Rect, value: CellType) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (grid[y]?.[x] !== undefined) grid[y][x] = value;
    }
  }
}

function paintRect(terrain: TerrainLayer, r: Rect, t: Terrain, grid?: CellType[][]) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (grid && grid[y]?.[x] !== 1) continue;
      terrain.set(x, y, t);
    }
  }
}

/** A rough blob, for spills and mats — nothing in a kitchen has square edges. */
function paintBlob(
  terrain: TerrainLayer,
  grid: CellType[][],
  cx: number, cy: number,
  radius: number,
  t: Terrain,
  rng: Rng,
) {
  const wobble = radius * 0.35;
  for (let y = cy - radius - 1; y <= cy + radius + 1; y++) {
    for (let x = cx - radius - 1; x <= cx + radius + 1; x++) {
      if (grid[y]?.[x] !== 1) continue;
      const dx = x - cx, dy = y - cy;
      const edge = radius + (rng.next() - 0.5) * wobble;
      if (dx * dx + dy * dy <= edge * edge) terrain.set(x, y, t);
    }
  }
}

// ─── Connectivity ────────────────────────────────────────────────────────────

/** Cells reachable from a start, four-connected. */
export function reachableFrom(
  grid: CellType[][],
  sx: number, sy: number,
): Set<number> {
  const rows = grid.length, cols = grid[0].length;
  const seen = new Set<number>();
  if (grid[sy]?.[sx] !== 1) return seen;

  const stack = [sy * cols + sx];
  seen.add(stack[0]);
  while (stack.length) {
    const idx = stack.pop()!;
    const x = idx % cols, y = (idx - x) / cols;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      if (grid[ny][nx] !== 1) continue;
      const nIdx = ny * cols + nx;
      if (seen.has(nIdx)) continue;
      seen.add(nIdx);
      stack.push(nIdx);
    }
  }
  return seen;
}

/**
 * Open a straight-ish path between two cells, so a region cut off by an
 * unlucky wall placement is still reachable. Crude on purpose: it runs along
 * one axis then the other, which in a room reads as a gap someone left.
 */
function bore(grid: CellType[][], ax: number, ay: number, bx: number, by: number) {
  let x = ax, y = ay;
  while (x !== bx) { x += Math.sign(bx - x); if (grid[y]?.[x] !== undefined) grid[y][x] = 1; }
  while (y !== by) { y += Math.sign(by - y); if (grid[y]?.[x] !== undefined) grid[y][x] = 1; }
}

/**
 * Connect every open pocket back to the main body of the world.
 *
 * Generation places counters, units and appliances independently, so it can cut
 * a corner off by accident. Rather than forbid that, find what got orphaned and
 * open a way in — which is what a kitchen is like anyway.
 */
function ensureConnected(grid: CellType[][], sx: number, sy: number) {
  const rows = grid.length, cols = grid[0].length;

  for (let guard = 0; guard < 40; guard++) {
    const main = reachableFrom(grid, sx, sy);
    let orphan: [number, number] | null = null;

    outer:
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        if (grid[y][x] === 1 && !main.has(y * cols + x)) { orphan = [x, y]; break outer; }
      }
    }
    if (!orphan) return;

    // Bore from the orphan toward the start until it joins the main body.
    bore(grid, orphan[0], orphan[1], sx, sy);
  }
}

// ─── The maze, kept as an option ─────────────────────────────────────────────

function generateMazeGrid(cols: number, rows: number, rng: Rng, loopRate: number): CellType[][] {
  const grid = blankGrid(cols, rows);
  const visited = Array.from({ length: rows }, () => Array(cols).fill(false));

  const stack: [number, number][] = [[1, 1]];
  visited[1][1] = true;
  grid[1][1] = 1;

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const dirs = rng.shuffle([[0, -2], [0, 2], [-2, 0], [2, 0]]);
    let moved = false;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx <= 0 || nx >= cols - 1 || ny <= 0 || ny >= rows - 1 || visited[ny][nx]) continue;
      grid[cy + dy / 2][cx + dx / 2] = 1;
      grid[ny][nx] = 1;
      visited[ny][nx] = true;
      stack.push([nx, ny]);
      moved = true;
      break;
    }
    if (!moved) stack.pop();
  }

  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (grid[y][x] === 0 && rng.chance(loopRate)) grid[y][x] = 1;
    }
  }
  return grid;
}

// ─── The kitchen ─────────────────────────────────────────────────────────────

function generateKitchen(cols: number, rows: number, rng: Rng): GeneratedWorld {
  const grid = blankGrid(cols, rows);
  const terrain = new TerrainLayer(cols, rows);
  const crumbZones: [number, number][] = [];
  const nests: [number, number][] = [];

  // The room: everything inside the skirting is floor to begin with.
  const room: Rect = { x: 1, y: 1, w: cols - 2, h: rows - 2 };
  carveRect(grid, room);

  // ── Grout. The floor is tiled, and the lines between tiles are harder and
  // hold a trail far longer than the tile faces do. Ants find them and use
  // them, which gives the open floor a structure without walling it off.
  const tile = 7 + rng.int(3);
  for (let x = room.x; x < room.x + room.w; x++) {
    for (let y = room.y; y < room.y + room.h; y++) {
      if ((x - room.x) % tile === 0 || (y - room.y) % tile === 0) {
        terrain.set(x, y, Terrain.Hardpan);
      }
    }
  }

  // ── The run of units along the top. Behind and beneath them is the tight,
  // dark space where the maze belongs — at the edge, not across the whole room.
  const unitDepth = Math.max(5, Math.floor(rows * 0.16));
  const units: Rect = { x: 1, y: 1, w: cols - 2, h: unitDepth };
  const backing = generateMazeGrid(units.w + 2, units.h + 2, rng, 0.16);
  for (let y = 0; y < units.h; y++) {
    for (let x = 0; x < units.w; x++) {
      grid[units.y + y][units.x + x] = backing[y + 1]?.[x + 1] ?? 0;
    }
  }
  paintRect(terrain, units, Terrain.Plain, grid);

  // The worktop above the units: swept, hard, and reached only at the ends.
  const top: Rect = { x: 1, y: 1, w: cols - 2, h: 2 };
  carveRect(grid, top);
  paintRect(terrain, top, Terrain.Hardpan, grid);

  // ── Gaps between appliances: a few narrow ways down from the units into the
  // room. These are the chokepoints the whole floor has to funnel through.
  const gapCount = 3 + rng.int(3);
  const gaps: number[] = [];
  for (let i = 0; i < gapCount; i++) {
    const gx = 3 + rng.int(cols - 6);
    gaps.push(gx);
    fillRect(grid, { x: gx, y: 1, w: 1 + rng.int(2), h: unitDepth + 1 }, 1);
  }

  // ── The counter along the left wall: a plateau, walled off from the floor
  // except at a couple of places.
  const counter: Rect = {
    x: 1, y: unitDepth + 3,
    w: Math.max(6, Math.floor(cols * 0.13)),
    h: Math.floor(rows * 0.42),
  };
  paintRect(terrain, counter, Terrain.Hardpan, grid);
  const cwallX = counter.x + counter.w;
  fillRect(grid, { x: cwallX, y: counter.y, w: 1, h: counter.h }, 0);
  for (let i = 0; i < 2; i++) {
    const gy = counter.y + 1 + rng.int(counter.h - 2);
    fillRect(grid, { x: cwallX, y: gy, w: 1, h: 2 }, 1);
  }

  // ── The table: a plateau in the middle of the floor, standing on legs. The
  // legs are the only way up, so traffic to it concentrates hard.
  const table: Rect = {
    x: Math.floor(cols * 0.45), y: Math.floor(rows * 0.34),
    w: Math.max(10, Math.floor(cols * 0.24)), h: Math.max(8, Math.floor(rows * 0.28)),
  };
  paintRect(terrain, table, Terrain.Hardpan, grid);
  fillRect(grid, { x: table.x - 1, y: table.y - 1, w: table.w + 2, h: 1 }, 0);
  fillRect(grid, { x: table.x - 1, y: table.y + table.h, w: table.w + 2, h: 1 }, 0);
  fillRect(grid, { x: table.x - 1, y: table.y - 1, w: 1, h: table.h + 2 }, 0);
  fillRect(grid, { x: table.x + table.w, y: table.y - 1, w: 1, h: table.h + 2 }, 0);
  for (const [lx, ly] of [
    [table.x - 1, table.y + 1],
    [table.x + table.w, table.y + table.h - 2],
    [table.x + 2, table.y - 1],
    [table.x + table.w - 3, table.y + table.h],
  ] as [number, number][]) {
    grid[ly][lx] = 1;
  }

  // Crumbs collect under the table and get swept into the corners.
  for (let i = 0; i < 3; i++) {
    const bx = table.x + rng.int(table.w);
    const by = table.y + table.h + 2 + rng.int(4);
    if (grid[by]?.[bx] === 1) {
      paintBlob(terrain, grid, bx, by, 2 + rng.int(2), Terrain.Loam, rng);
      crumbZones.push([bx, by]);
    }
  }

  // Crumbs by the toaster, on the floor just below the units. A colony nesting
  // in the skirting needs something within reach to get started on: the far
  // side of a room-sized floor is a very long first foraging trip, and without
  // a near source nothing ever gets off the ground.
  for (let i = 0; i < 2; i++) {
    const tx = 4 + rng.int(cols - 8);
    const ty = unitDepth + 2 + rng.int(3);
    if (grid[ty]?.[tx] === 1) {
      paintBlob(terrain, grid, tx, ty, 2 + rng.int(2), Terrain.Loam, rng);
      crumbZones.push([tx, ty]);
    }
  }

  // ── A spill. Passable, and it will not hold a scent, so the floor has a hole
  // in it as far as coordination is concerned.
  const spillX = Math.floor(cols * 0.2) + rng.int(Math.floor(cols * 0.2));
  const spillY = Math.floor(rows * 0.66) + rng.int(Math.floor(rows * 0.2));
  paintBlob(terrain, grid, spillX, spillY, 4 + rng.int(4), Terrain.Mire, rng);

  // ── The mat by the door: slow going, but it shelters what is laid on it.
  const matX = cols - Math.floor(cols * 0.18);
  const matY = Math.floor(rows * 0.72);
  paintBlob(terrain, grid, matX, matY, 4 + rng.int(3), Terrain.Undergrowth, rng);

  // ── The step down to the pantry, in the far corner. One way.
  const stepY = rows - 4;
  const stepX0 = Math.floor(cols * 0.62);
  for (let x = stepX0; x < stepX0 + Math.floor(cols * 0.2); x++) {
    if (grid[stepY]?.[x] === 1) terrain.set(x, stepY, Terrain.Scarp, Facing.South);
  }

  // A bin corner, where crumbs also gather.
  const binX = cols - 5, binY = rows - 5;
  if (grid[binY]?.[binX] === 1) {
    paintBlob(terrain, grid, binX, binY, 3, Terrain.Loam, rng);
    crumbZones.push([binX, binY]);
  }

  // ── Nests: cracks in the skirting, back among the units where it is dark.
  for (const gx of rng.shuffle([...gaps])) {
    const nx = Math.max(2, Math.min(cols - 3, gx));
    for (let ny = 2; ny < unitDepth; ny++) {
      if (grid[ny][nx] === 1) { nests.push([nx, ny]); break; }
    }
  }
  nests.push([2, 2], [cols - 3, 2], [2, rows - 3], [cols - 3, rows - 3]);

  const [startX, startY] = nests[0];
  grid[startY][startX] = 1;
  ensureConnected(grid, startX, startY);

  return { grid, terrain, nests, crumbZones };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function generateWorld(
  kind: WorldKind,
  cols: number,
  rows: number,
  rng: Rng,
  loopRate = 0.1,
): GeneratedWorld {
  if (kind === "kitchen") return generateKitchen(cols, rows, rng);

  const grid = generateMazeGrid(cols, rows, rng, loopRate);
  const nests: [number, number][] = [
    [1, 1], [cols - 2, rows - 2], [cols - 2, 1], [1, rows - 2],
  ];
  for (const [nx, ny] of nests) grid[ny][nx] = 1;
  ensureConnected(grid, 1, 1);

  return { grid, terrain: new TerrainLayer(cols, rows), nests, crumbZones: [] };
}
