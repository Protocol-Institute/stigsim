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
import { Facing, Terrain, TerrainLayer, type TerrainSkin } from "./terrain";

export type CellType = 0 | 1;
export type WorldKind = "kitchen" | "forest" | "maze";

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

/** A rounded mass of wall — a boulder, a tree trunk. Nothing natural is square. */
function wallBlob(grid: CellType[][], cx: number, cy: number, radius: number, rng: Rng) {
  const wobble = radius * 0.4;
  for (let y = cy - radius - 1; y <= cy + radius + 1; y++) {
    for (let x = cx - radius - 1; x <= cx + radius + 1; x++) {
      if (grid[y]?.[x] === undefined) continue;
      const dx = x - cx, dy = y - cy;
      const edge = radius + (rng.next() - 0.5) * wobble;
      if (dx * dx + dy * dy <= edge * edge) grid[y][x] = 0;
    }
  }
}

/** Paint a thick line of terrain, following a path. */
function paintPath(
  terrain: TerrainLayer,
  grid: CellType[][],
  path: [number, number][],
  width: number,
  t: Terrain,
) {
  const r = Math.max(0, Math.floor(width / 2));
  for (const [px, py] of path) {
    for (let y = py - r; y <= py + r; y++) {
      for (let x = px - r; x <= px + r; x++) {
        if (grid[y]?.[x] === 1) terrain.set(x, y, t);
      }
    }
  }
}

/** Carve a thick line of open ground, following a path. */
function carvePath(grid: CellType[][], path: [number, number][], width: number) {
  const r = Math.max(0, Math.floor(width / 2));
  for (const [px, py] of path) {
    for (let y = py - r; y <= py + r; y++) {
      for (let x = px - r; x <= px + r; x++) {
        if (grid[y]?.[x] !== undefined) grid[y][x] = 1;
      }
    }
  }
}

/** A wandering line across the world, for streams and logs. */
function meander(
  fromX: number, fromY: number,
  toX: number, toY: number,
  drift: number,
  rng: Rng,
): [number, number][] {
  const path: [number, number][] = [];
  const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY));
  let offset = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    offset += (rng.next() - 0.5) * drift;
    offset = Math.max(-drift * 3, Math.min(drift * 3, offset));
    const x = Math.round(fromX + (toX - fromX) * t);
    const y = Math.round(fromY + (toY - fromY) * t + offset);
    path.push([x, y]);
  }
  return path;
}

/** Roots spreading out from a trunk: a branching line, thinning as it goes. */
function growRoots(
  terrain: TerrainLayer,
  grid: CellType[][],
  x: number, y: number,
  angle: number,
  length: number,
  depth: number,
  rng: Rng,
) {
  let cx = x, cy = y, a = angle;
  for (let i = 0; i < length; i++) {
    a += (rng.next() - 0.5) * 0.35;
    cx += Math.cos(a);
    cy += Math.sin(a);
    const gx = Math.round(cx), gy = Math.round(cy);
    if (grid[gy]?.[gx] === undefined) return;
    if (grid[gy][gx] === 1) terrain.set(gx, gy, Terrain.Hardpan);
    // Roots fork, and each fork is shorter than its parent.
    if (depth > 0 && i > length * 0.35 && rng.chance(0.09)) {
      growRoots(terrain, grid, gx, gy, a + (rng.chance(0.5) ? 0.8 : -0.8),
        Math.floor(length * 0.55), depth - 1, rng);
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


// ─── The forest floor ────────────────────────────────────────────────────────

/**
 * The same six surfaces, dressed for a wood.
 *
 * Hardpan is bark and root rather than swept stone; sand is a sun-baked
 * clearing rather than spilled sugar; mire is a streambed. The mechanics do not
 * move — recognising that they are the same mechanics under a different face is
 * the thing worth practising.
 */
const FOREST_SKIN: TerrainSkin = {
  [Terrain.Plain]: { name: "Bare earth", fill: "#241a10", blurb: "Trodden soil between the drifts." },
  [Terrain.Hardpan]: {
    name: "Root", fill: "#4a3a24", speckle: "#63502f",
    blurb: "Bark and old root. Fast, dry, and it keeps a scent for a long time.",
  },
  [Terrain.Sand]: {
    name: "Sun patch", fill: "#5e5324", speckle: "#7d6f31",
    blurb: "A break in the canopy. Quick to cross, and the sun takes the scent off it.",
  },
  [Terrain.Mire]: {
    name: "Streambed", fill: "#13333c", speckle: "#245a68",
    blurb: "Shallow water. You can wade it, but nothing you lay there stays.",
  },
  [Terrain.Undergrowth]: {
    name: "Leaf litter", fill: "#23331a", speckle: "#3a5228",
    blurb: "Deep drifted leaves. Slow going, but sheltered — a trail here lasts.",
  },
  [Terrain.Loam]: {
    name: "Windfall", fill: "#42280f", speckle: "#5f3a18",
    blurb: "Rotting fruit and fungus. This is where food appears.",
  },
  [Terrain.Scarp]: {
    name: "Bank", fill: "#33302a", speckle: "#4d4840",
    blurb: "A drop to the water. You can go down it and not back up.",
  },
};

function generateForest(cols: number, rows: number, rng: Rng): GeneratedWorld {
  const grid = blankGrid(cols, rows);
  const terrain = new TerrainLayer(cols, rows, FOREST_SKIN);
  const crumbZones: [number, number][] = [];
  const nests: [number, number][] = [];

  // Open ground everywhere inside the border; the forest is not a maze.
  carveRect(grid, { x: 1, y: 1, w: cols - 2, h: rows - 2 });

  // ── Leaf litter drifts. Slow to wade, but sheltered, so a trail through the
  // litter outlasts one across bare earth.
  for (let i = 0; i < 14; i++) {
    paintBlob(terrain, grid,
      2 + rng.int(cols - 4), 2 + rng.int(rows - 4),
      3 + rng.int(6), Terrain.Undergrowth, rng);
  }

  // ── A break in the canopy. Fast to cross and it bakes the scent off, so the
  // short way over is never the way that accumulates.
  const clearX = Math.floor(cols * 0.55) + rng.int(Math.floor(cols * 0.2));
  const clearY = Math.floor(rows * 0.25) + rng.int(Math.floor(rows * 0.3));
  paintBlob(terrain, grid, clearX, clearY, 9 + rng.int(5), Terrain.Sand, rng);

  // ── The stream. It cuts the world in two: wadeable, but it holds no scent, so
  // no trail can span it except where something bridges it.
  const streamY = Math.floor(rows * 0.62) + rng.int(Math.floor(rows * 0.15));
  const stream = meander(0, streamY, cols - 1, streamY, 1.1, rng);
  paintPath(terrain, grid, stream, 4 + rng.int(2), Terrain.Mire);

  // The near bank drops to the water and cannot be climbed back on this side.
  for (const [sx, sy] of stream) {
    const by = sy - 3;
    if (grid[by]?.[sx] === 1 && terrain.at(sx, by) !== Terrain.Mire && rng.chance(0.7)) {
      terrain.set(sx, by, Terrain.Scarp, Facing.South);
    }
  }

  // ── Stepping stones. Dry rock across the water, and the only places a trail
  // can carry over. A colony has to find one and commit to it.
  const crossings = 2 + rng.int(2);
  for (let i = 0; i < crossings; i++) {
    const at = Math.floor(((i + 0.5) / crossings) * stream.length) + rng.int(8) - 4;
    const [sx, sy] = stream[Math.max(0, Math.min(stream.length - 1, at))];
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (grid[sy + dy]?.[sx + dx] === 1) terrain.set(sx + dx, sy + dy, Terrain.Hardpan);
      }
    }
  }

  // ── The fallen log: one long dry highway across the floor. Real colonies run
  // trunk routes along logs, and this is a single strong thing to converge on.
  const logY = Math.floor(rows * 0.2) + rng.int(Math.floor(rows * 0.15));
  const log = meander(2, logY, cols - 3, logY + rng.int(10) - 5, 0.8, rng);
  paintPath(terrain, grid, log, 3, Terrain.Hardpan);

  // ── Trees and boulders. Rounded, scattered, and something to follow the edge
  // of — not corridors.
  const trees: [number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const tx = 4 + rng.int(cols - 8);
    const ty = 4 + rng.int(rows - 8);
    if (Math.abs(ty - streamY) < 5) continue;
    const r = 2 + rng.int(3);
    wallBlob(grid, tx, ty, r, rng);
    trees.push([tx, ty]);
    // Roots spread out from the trunk: hard ground in a branching pattern,
    // doing what grout does in a kitchen but growing rather than tiled.
    const spokes = 3 + rng.int(3);
    for (let k = 0; k < spokes; k++) {
      growRoots(terrain, grid, tx, ty,
        (k / spokes) * Math.PI * 2 + rng.next(), 10 + rng.int(14), 2, rng);
    }
  }

  // ── Windfall: rotting fruit and fungus, where food appears. Some near the
  // nest so a colony can get started, and some over the water so there is a
  // reason to solve the crossing.
  const [homeX, homeY] = [3 + rng.int(6), 3 + rng.int(6)];
  carvePath(grid, [[homeX, homeY]], 3);
  nests.push([homeX, homeY]);

  for (let i = 0; i < 2; i++) {
    const fx = homeX + 4 + rng.int(14), fy = homeY + rng.int(12);
    if (grid[fy]?.[fx] === 1) {
      paintBlob(terrain, grid, fx, fy, 2 + rng.int(2), Terrain.Loam, rng);
      crumbZones.push([fx, fy]);
    }
  }
  for (let i = 0; i < 3; i++) {
    const fx = 6 + rng.int(cols - 12);
    const fy = streamY + 5 + rng.int(Math.max(2, rows - streamY - 8));
    if (grid[fy]?.[fx] === 1) {
      paintBlob(terrain, grid, fx, fy, 2 + rng.int(3), Terrain.Loam, rng);
      crumbZones.push([fx, fy]);
    }
  }

  for (const [tx, ty] of trees) nests.push([Math.max(2, tx - 4), Math.max(2, ty)]);
  nests.push([2, 2], [cols - 3, 2], [2, rows - 3], [cols - 3, rows - 3]);

  grid[homeY][homeX] = 1;
  ensureConnected(grid, homeX, homeY);

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
  if (kind === "forest") return generateForest(cols, rows, rng);

  const grid = generateMazeGrid(cols, rows, rng, loopRate);
  const nests: [number, number][] = [
    [1, 1], [cols - 2, rows - 2], [cols - 2, 1], [1, rows - 2],
  ];
  for (const [nx, ny] of nests) grid[ny][nx] = 1;
  ensureConnected(grid, 1, 1);

  return { grid, terrain: new TerrainLayer(cols, rows), nests, crumbZones: [] };
}
