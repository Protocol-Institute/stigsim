import { useRef, useEffect, useCallback, useState } from "react";
import { Rng, randomSeed } from "./sim/rng";

// ─── Maze dimensions ───────────────────────────────────────────────────────
const COLS = 31;
const ROWS = 31;
const CELL = 16;
const W = COLS * CELL;
const H = ROWS * CELL;

// ─── Movement (fixed) ──────────────────────────────────────────────────────
const V = 4;
const ARRIVE_THRESH = V + 1;
const NEST_SEED = 1000;
const DEFAULT_NUM_ANTS = 20;
const DEPOSIT_RATE = 20;

// ─── One-ant view: half-size of the source window in pixels ─────────────────
const VIEW_HALF = CELL * 1;

// ─── Colony nest corner positions (up to 4) ──────────────────────────────────
const COLONY_NESTS: [number, number][] = [
  [1, 1],
  [COLS - 2, ROWS - 2],
  [COLS - 2, 1],
  [1, ROWS - 2],
];

// ─── Colony visual identity ──────────────────────────────────────────────────
const COLONY_COLORS = [
  { primary: "#4b9eff", homeRGB: "80,158,255", foodRGB: "80,220,200" },
  { primary: "#ff6b6b", homeRGB: "255,107,107", foodRGB: "255,200,80"  },
  { primary: "#4bde80", homeRGB: "75,222,128",  foodRGB: "200,255,80"  },
  { primary: "#c084fc", homeRGB: "192,132,252", foodRGB: "252,132,200" },
];

export interface SimParams {
  evapRate: number;
  trailPower: number;
  tankMax: number;
  cautionary: boolean;
}

const DEFAULT_PARAMS: SimParams = {
  evapRate: 0.005,
  trailPower: 5,
  tankMax: 6400,
  cautionary: false,
};

const DEFAULT_NUM_COLONIES = 1;
const DEFAULT_NUM_FOOD_SOURCES = 1;
const DEFAULT_FOOD_PER_SOURCE = 500;

type CellType = 0 | 1;
type AntState = "searching" | "returning";
type ViewMode = "all" | "one";
type EditMode = "none" | "wall" | "food";

interface FoodSource {
  x: number;
  y: number;
  remaining: number;
  total: number;
}

interface Colony {
  id: number;
  nestX: number;
  nestY: number;
  homePhero: Float32Array;
  foodPhero: Float32Array;
  cautPhero: Float32Array;
  ants: Ant[];
  foodCollected: number;
  discoveredSources: Set<number>;
}

interface Ant {
  x: number; y: number;
  cx: number; cy: number;
  tx: number; ty: number;
  prevCx: number; prevCy: number;
  state: AntState;
  hasFood: boolean;
  tank: number;
  colonyId: number;
  manual?: boolean;
}

function generateMaze(rng: Rng, loopRate: number = 0.1): CellType[][] {
  const grid: CellType[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  function carve(cx: number, cy: number) {
    visited[cy][cx] = true;
    grid[cy][cx] = 1;
    const dirs = rng.shuffle([[0, -2], [0, 2], [-2, 0], [2, 0]]);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && !visited[ny][nx]) {
        grid[cy + dy / 2][cx + dx / 2] = 1;
        carve(nx, ny);
      }
    }
  }
  carve(1, 1);
  for (let y = 1; y < ROWS - 1; y++)
    for (let x = 1; x < COLS - 1; x++)
      if (grid[y][x] === 0 && rng.chance(loopRate)) grid[y][x] = 1;
  // Ensure all colony nest corners are open
  for (const [nx, ny] of COLONY_NESTS) grid[ny][nx] = 1;
  return grid;
}

function computeHighwayScore(sim: Simulation): number {
  const open: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (sim.grid[y][x] === 1) {
        const idx = y * COLS + x;
        let total = 0;
        for (const c of sim.colonies) total += c.foodPhero[idx] + c.homePhero[idx];
        open.push(total);
      }
    }
  }
  if (open.length === 0) return 0;
  const total = open.reduce((a, b) => a + b, 0);
  if (total < 1) return 0;
  open.sort((a, b) => b - a);
  const topN = Math.max(1, Math.floor(open.length * 0.1));
  const topSum = open.slice(0, topN).reduce((a, b) => a + b, 0);
  return topSum / total;
}

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function openNeighbours(grid: CellType[][], x: number, y: number, exX?: number, exY?: number): [number, number][] {
  return DIRS4
    .map(([dx, dy]) => [x + dx, y + dy] as [number, number])
    .filter(([nx, ny]) =>
      nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS &&
      grid[ny][nx] === 1 && !(nx === exX && ny === exY)
    );
}

function powerChoice(
  rng: Rng,
  cells: [number, number][],
  phero: Float32Array,
  power: number,
  cautPhero?: Float32Array,
  cautPower?: number,
): [number, number] {
  const scores = cells.map(([cx, cy]) => {
    const idx = cy * COLS + cx;
    const trail = Math.pow(phero[idx] + 1, power);
    const caution = (cautPhero && cautPower) ? Math.pow(cautPhero[idx] + 1, cautPower) : 1;
    return trail / caution;
  });
  const total = scores.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < cells.length; i++) { r -= scores[i]; if (r <= 0) return cells[i]; }
  return cells[cells.length - 1];
}

const cellCenter = (gx: number, gy: number) => ({ px: gx * CELL + CELL / 2, py: gy * CELL + CELL / 2 });

class Simulation {
  numAnts: number;
  numColonies: number;
  numFoodSources: number;
  foodPerSource: number;
  params: SimParams;
  loopRate: number;
  grid: CellType[][];
  colonies: Colony[];
  foodSources: FoodSource[];
  seed: string;
  rng: Rng;

  constructor(
    numAnts: number,
    params: SimParams,
    loopRate: number = 0.1,
    numColonies: number = 1,
    numFoodSources: number = 1,
    foodPerSource: number = 500,
    seed: string = randomSeed(),
  ) {
    this.numAnts = numAnts;
    this.params = { ...params };
    this.loopRate = loopRate;
    this.numColonies = numColonies;
    this.numFoodSources = numFoodSources;
    this.foodPerSource = foodPerSource;
    this.seed = seed;
    this.rng = new Rng(seed);
    this.grid = generateMaze(this.rng, loopRate);
    this.colonies = this._initColonies();
    this.foodSources = this._placeFoodSources();
    for (const colony of this.colonies) this._seedNest(colony);
  }

  private _initColonies(): Colony[] {
    return Array.from({ length: this.numColonies }, (_, id) => {
      const [nestX, nestY] = COLONY_NESTS[id];
      this.grid[nestY][nestX] = 1;
      return {
        id,
        nestX,
        nestY,
        homePhero: new Float32Array(COLS * ROWS),
        foodPhero: new Float32Array(COLS * ROWS),
        cautPhero: new Float32Array(COLS * ROWS),
        ants: this._spawnAnts(id, nestX, nestY),
        foodCollected: 0,
        discoveredSources: new Set<number>(),
      };
    });
  }

  private _placeFoodSources(): FoodSource[] {
    const nestSet = new Set(this.colonies.map(c => c.nestY * COLS + c.nestX));
    // Minimum Manhattan distance from any nest
    const minDist = Math.floor(Math.min(COLS, ROWS) / 4);
    const open: [number, number][] = [];
    for (let y = 2; y < ROWS - 2; y++) {
      for (let x = 2; x < COLS - 2; x++) {
        if (this.grid[y][x] !== 1) continue;
        if (nestSet.has(y * COLS + x)) continue;
        const farEnough = this.colonies.every(
          c => Math.abs(c.nestX - x) + Math.abs(c.nestY - y) >= minDist
        );
        if (farEnough) open.push([x, y]);
      }
    }
    this.rng.shuffle(open);
    const count = Math.min(this.numFoodSources, open.length);
    return open.slice(0, count).map(([x, y]) => ({
      x, y,
      remaining: this.foodPerSource,
      total: this.foodPerSource,
    }));
  }

  private _seedNest(colony: Colony) {
    const { nestX, nestY } = colony;
    colony.homePhero[nestY * COLS + nestX] = NEST_SEED;
    for (const [dx, dy] of DIRS4) {
      const nx = nestX + dx, ny = nestY + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && this.grid[ny][nx]) {
        const idx = ny * COLS + nx;
        colony.homePhero[idx] = Math.max(colony.homePhero[idx], NEST_SEED * 0.85);
      }
    }
  }

  private _spawnAnts(colonyId: number, nestX: number, nestY: number): Ant[] {
    const { px, py } = cellCenter(nestX, nestY);
    return Array.from({ length: this.numAnts }, () => ({
      x: px, y: py,
      cx: nestX, cy: nestY,
      tx: nestX, ty: nestY,
      prevCx: nestX, prevCy: nestY,
      state: "searching" as AntState,
      hasFood: false,
      tank: this.params.tankMax,
      colonyId,
    }));
  }

  get allAnts(): Ant[] {
    return this.colonies.flatMap(c => c.ants);
  }

  setAntCount(n: number) {
    for (const colony of this.colonies) {
      const { nestX, nestY } = colony;
      const { px, py } = cellCenter(nestX, nestY);
      if (n > colony.ants.length) {
        const toAdd = n - colony.ants.length;
        for (let i = 0; i < toAdd; i++) {
          colony.ants.push({
            x: px, y: py,
            cx: nestX, cy: nestY,
            tx: nestX, ty: nestY,
            prevCx: nestX, prevCy: nestY,
            state: "searching",
            hasFood: false,
            tank: this.params.tankMax,
            colonyId: colony.id,
          });
        }
      } else if (n < colony.ants.length) {
        colony.ants.splice(n);
      }
    }
    this.numAnts = n;
  }

  get totalFoodCollected(): number {
    return this.colonies.reduce((s, c) => s + c.foodCollected, 0);
  }

  step() {
    const decay = 1 - this.params.evapRate;
    for (const colony of this.colonies) {
      for (let i = 0; i < colony.homePhero.length; i++) {
        colony.homePhero[i] *= decay;
        colony.foodPhero[i] *= decay;
        colony.cautPhero[i] *= decay;
      }
      this._seedNest(colony);
      // Re-seed discovered food sources that still have food
      for (const srcIdx of colony.discoveredSources) {
        const src = this.foodSources[srcIdx];
        if (src.remaining > 0) {
          colony.foodPhero[src.y * COLS + src.x] = NEST_SEED;
        }
      }
      for (const ant of colony.ants) this._moveAnt(ant, colony);
    }
  }

  private _moveAnt(ant: Ant, colony: Colony) {
    const { tankMax, trailPower } = this.params;
    const { px: tpx, py: tpy } = cellCenter(ant.tx, ant.ty);
    const dx = tpx - ant.x, dy = tpy - ant.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > ARRIVE_THRESH) {
      const idx = ant.cy * COLS + ant.cx;
      if (ant.tank > 0) {
        const deposit = Math.min(ant.tank, DEPOSIT_RATE);
        if (ant.state === "searching") {
          colony.homePhero[idx] += deposit;
        } else {
          colony.foodPhero[idx] += deposit;
        }
        ant.tank -= deposit;
      } else if (this.params.cautionary) {
        colony.cautPhero[idx] += DEPOSIT_RATE;
      }
      const scale = V / dist;
      ant.x += dx * scale;
      ant.y += dy * scale;
      return;
    }

    ant.x = tpx; ant.y = tpy;
    ant.cx = ant.tx; ant.cy = ant.ty;

    // Check food sources
    if (ant.state === "searching") {
      const srcIdx = this.foodSources.findIndex(s => s.x === ant.cx && s.y === ant.cy);
      if (srcIdx >= 0) {
        const src = this.foodSources[srcIdx];
        colony.discoveredSources.add(srcIdx);
        if (src.remaining > 0) {
          src.remaining--;
          colony.foodPhero[src.y * COLS + src.x] = NEST_SEED;
          ant.state = "returning";
          ant.hasFood = true;
          ant.tank = tankMax;
          const [ntx, nty] = [ant.prevCx, ant.prevCy];
          ant.prevCx = ant.cx; ant.prevCy = ant.cy;
          ant.tx = ntx; ant.ty = nty;
          return;
        }
        // depleted — fall through, keep searching
      }
    }

    // Check nest
    if (ant.state === "returning" && ant.cx === colony.nestX && ant.cy === colony.nestY) {
      ant.state = "searching";
      ant.hasFood = false;
      ant.tank = tankMax;
      colony.foodCollected++;
      const [ntx, nty] = [ant.prevCx, ant.prevCy];
      ant.prevCx = ant.cx; ant.prevCy = ant.cy;
      ant.tx = ntx; ant.ty = nty;
      return;
    }

    if (ant.manual) {
      ant.tx = ant.cx; ant.ty = ant.cy;
      return;
    }

    const noBack = openNeighbours(this.grid, ant.cx, ant.cy, ant.prevCx, ant.prevCy);
    const candidates = noBack.length > 0 ? noBack : openNeighbours(this.grid, ant.cx, ant.cy);
    const phero = ant.state === "searching" ? colony.foodPhero : colony.homePhero;
    const next = powerChoice(this.rng, candidates, phero, trailPower, this.params.cautionary ? colony.cautPhero : undefined, trailPower);

    ant.prevCx = ant.cx; ant.prevCy = ant.cy;
    ant.tx = next[0]; ant.ty = next[1];
  }
}

function render(
  ctx: CanvasRenderingContext2D,
  sim: Simulation,
  viewMode: ViewMode = "all",
  watchedAntIdx: number = 0,
  editMode: EditMode = "none",
  hoverCell: { x: number; y: number } | null = null,
) {
  const allAnts = sim.allAnts;
  const safeIdx = allAnts.length > 0 ? Math.min(watchedAntIdx, allAnts.length - 1) : -1;

  // Void background
  ctx.fillStyle = "#0a0602";
  ctx.fillRect(0, 0, W, H);

  if (viewMode === "one" && safeIdx >= 0) {
    const ant = allAnts[safeIdx];
    const zoom = W / (VIEW_HALF * 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    ctx.setTransform(zoom, 0, 0, zoom, W / 2 - ant.x * zoom, H / 2 - ant.y * zoom);
  }

  // Compute per-colony phero maxima for normalization
  const maxH = sim.colonies.map(c => {
    let m = NEST_SEED;
    for (let i = 0; i < c.homePhero.length; i++) if (c.homePhero[i] > m) m = c.homePhero[i];
    return m;
  });
  const maxF = sim.colonies.map(c => {
    let m = NEST_SEED;
    for (let i = 0; i < c.foodPhero.length; i++) if (c.foodPhero[i] > m) m = c.foodPhero[i];
    return m;
  });
  const maxCH = sim.colonies.map(c => {
    let m = 1;
    for (let i = 0; i < c.cautPhero.length; i++) if (c.cautPhero[i] > m) m = c.cautPhero[i];
    return m;
  });

  // Base path fill
  ctx.fillStyle = "#1a1208";
  ctx.fillRect(0, 0, W, H);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const px = x * CELL, py = y * CELL;
      if (sim.grid[y][x] === 0) {
        ctx.fillStyle = "#0d0a06";
        ctx.fillRect(px, py, CELL, CELL);
        continue;
      }
      ctx.fillStyle = "#2a1e0e";
      ctx.fillRect(px, py, CELL, CELL);

      const idx = y * COLS + x;

      // Layer pheromones for each colony
      for (let ci = 0; ci < sim.colonies.length; ci++) {
        const colony = sim.colonies[ci];
        const colors = COLONY_COLORS[ci];

        const hi = colony.homePhero[idx];
        if (hi > 0.5) {
          const alpha = Math.min(0.55, (hi / maxH[ci]) * 0.55);
          ctx.fillStyle = `rgba(${colors.homeRGB},${alpha.toFixed(3)})`;
          ctx.fillRect(px, py, CELL, CELL);
        }
        const fi = colony.foodPhero[idx];
        if (fi > 0.5) {
          const alpha = Math.min(0.6, (fi / maxF[ci]) * 0.6);
          ctx.fillStyle = `rgba(${colors.foodRGB},${alpha.toFixed(3)})`;
          ctx.fillRect(px, py, CELL, CELL);
        }
        if (sim.params.cautionary) {
          const ci2 = colony.cautPhero[idx];
          if (ci2 > 0.5) {
            const alpha = Math.min(0.45, (ci2 / maxCH[ci]) * 0.45);
            ctx.fillStyle = `rgba(220,60,40,${alpha.toFixed(3)})`;
            ctx.fillRect(px, py, CELL, CELL);
          }
        }
      }
    }
  }

  // Draw nests
  ctx.font = `${CELL - 4}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const colony of sim.colonies) {
    const npx = colony.nestX * CELL, npy = colony.nestY * CELL;
    ctx.fillStyle = COLONY_COLORS[colony.id].primary;
    ctx.fillRect(npx, npy, CELL, CELL);
    ctx.fillText("🏠", npx + CELL / 2, npy + CELL / 2);
  }

  // Draw food sources
  for (const src of sim.foodSources) {
    const fpx = src.x * CELL, fpy = src.y * CELL;
    const frac = src.remaining / src.total;
    if (src.remaining <= 0) {
      ctx.fillStyle = "#2a2a2a";
      ctx.fillRect(fpx, fpy, CELL, CELL);
      ctx.globalAlpha = 0.35;
      ctx.fillText("🍎", fpx + CELL / 2, fpy + CELL / 2);
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#16a34a";
      ctx.fillRect(fpx, fpy, CELL, CELL);
      ctx.fillText("🍎", fpx + CELL / 2, fpy + CELL / 2);
      // Depletion bar (bottom edge of cell)
      if (src.total !== src.remaining) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(fpx, fpy + CELL - 3, CELL, 3);
        ctx.fillStyle = "#4ade80";
        ctx.fillRect(fpx, fpy + CELL - 3, Math.round(CELL * frac), 3);
      }
    }
  }

  // Draw ants
  for (const colony of sim.colonies) {
    const colColor = COLONY_COLORS[colony.id].primary;
    for (let i = 0; i < colony.ants.length; i++) {
      const ant = colony.ants[i];
      const flatIdx = sim.colonies.slice(0, colony.id).reduce((s, c) => s + c.ants.length, 0) + i;
      const isWatched = viewMode === "one" && flatIdx === safeIdx;

      const tankFrac = Math.min(1, ant.tank / sim.params.tankMax);
      ctx.globalAlpha = 0.25 + 0.75 * tankFrac;

      const r = ant.hasFood ? 4.5 : 3.5;
      ctx.beginPath();
      ctx.arc(ant.x, ant.y, r, 0, Math.PI * 2);
      ctx.fillStyle = ant.hasFood ? "#facc15" : colColor;
      ctx.fill();

      // Direction dot
      const { px: tpx, py: tpy } = cellCenter(ant.tx, ant.ty);
      const ddx = tpx - ant.x, ddy = tpy - ant.y;
      const dl = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      ctx.beginPath();
      ctx.arc(ant.x + (ddx / dl) * 5, ant.y + (ddy / dl) * 5, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.globalAlpha = 1;

      if (isWatched) {
        const glowColor = ant.hasFood ? "rgba(250,204,21,0.5)" : `${colColor}88`;
        ctx.beginPath();
        ctx.arc(ant.x, ant.y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // Edit mode hover highlight
  if (editMode !== "none" && hoverCell && viewMode === "all") {
    const { x: hx, y: hy } = hoverCell;
    const hpx = hx * CELL, hpy = hy * CELL;
    const isWall = sim.grid[hy][hx] === 0;
    const isNest = sim.colonies.some(c => c.nestX === hx && c.nestY === hy);
    const isFoodHere = sim.foodSources.some(s => s.x === hx && s.y === hy);
    if (editMode === "wall" && !isNest) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = isWall ? "#22c55e" : "#ef4444";
      ctx.fillRect(hpx, hpy, CELL, CELL);
      ctx.globalAlpha = 1;
    } else if (editMode === "food" && !isWall && !isNest) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = isFoodHere ? "#ef4444" : "#22c55e";
      ctx.fillRect(hpx, hpy, CELL, CELL);
      ctx.globalAlpha = 1;
    }
  }

  if (viewMode === "one") {
    ctx.restore();
  }
}

// ─── Param card ──────────────────────────────────────────────────────────────
function ParamCard({
  label, description, value, displayValue, min, max, step, onChange, onPointerUp,
}: {
  label: string;
  description: string;
  value: number;
  displayValue: string;
  min: number; max: number; step: number;
  onChange: (v: number) => void;
  onPointerUp?: (v: number) => void;
}) {
  return (
    <div style={{
      background: "#0f0a04",
      border: "1px solid #3d2e18",
      borderRadius: 10,
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      flex: "1 1 270px",
      minWidth: 0,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#e5d5b5" }}>{label}</span>
        <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f59e0b", whiteSpace: "nowrap" }}>{displayValue}</span>
      </div>
      <p style={{ margin: 0, fontSize: "0.72rem", color: "#a08060", lineHeight: 1.45 }}>{description}</p>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        onPointerUp={onPointerUp ? e => onPointerUp(Number((e.target as HTMLInputElement).value)) : undefined}
        style={{ width: "100%", accentColor: "#f59e0b", cursor: "pointer", margin: "2px 0" }}
      />
    </div>
  );
}

// ─── Simple control row ───────────────────────────────────────────────────────
function ControlCard({
  label, description, value, displayValue, min, max, step, rtl, onChange, style,
}: {
  label: string;
  description: string;
  value: number;
  displayValue: string;
  min: number; max: number; step: number;
  rtl?: boolean;
  onChange: (v: number) => void;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      background: "#0f0a04",
      border: "1px solid #3d2e18",
      borderRadius: 10,
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      flex: "1 1 270px",
      minWidth: 0,
      ...style,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#e5d5b5" }}>{label}</span>
        <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f59e0b", whiteSpace: "nowrap" }}>{displayValue}</span>
      </div>
      <p style={{ margin: 0, fontSize: "0.72rem", color: "#a08060", lineHeight: 1.45 }}>{description}</p>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#f59e0b", cursor: "pointer", direction: rtl ? "rtl" : "ltr", margin: "2px 0" }}
      />
    </div>
  );
}

// ─── D-pad button ────────────────────────────────────────────────────────────
const DPAD_CHEVRONS: Record<string, string> = {
  up:    "M5 15 L12 8 L19 15",
  down:  "M5 9 L12 16 L19 9",
  left:  "M15 5 L8 12 L15 19",
  right: "M9 5 L16 12 L9 19",
};

function DPadButton({ dir, onPress }: { dir: "up" | "down" | "left" | "right"; onPress: () => void }) {
  return (
    <button
      onPointerDown={e => { e.preventDefault(); onPress(); }}
      aria-label={dir}
      style={{
        width: 64,
        height: 64,
        borderRadius: 12,
        border: "1px solid #3d2e18",
        background: "#1a1208",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        touchAction: "none",
        WebkitTapHighlightColor: "transparent",
        userSelect: "none",
        transition: "background 0.1s",
        flexShrink: 0,
        padding: 0,
      }}
      onPointerEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = "#2a1e0a")}
      onPointerLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = "#1a1208")}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", pointerEvents: "none" }}>
        <path d={DPAD_CHEVRONS[dir]} />
      </svg>
    </button>
  );
}

function IconPlay({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#f59e0b" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", pointerEvents: "none", flexShrink: 0 }}>
      <path d="M6 4.5 L20 12 L6 19.5 Z" />
    </svg>
  );
}

function IconPause({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#f59e0b" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", pointerEvents: "none", flexShrink: 0 }}>
      <rect x="5" y="4" width="4.5" height="16" rx="1.5" />
      <rect x="14.5" y="4" width="4.5" height="16" rx="1.5" />
    </svg>
  );
}

function IconReset({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", pointerEvents: "none", flexShrink: 0 }}>
      <path d="M3 12 a9 9 0 1 0 2.1-5.8" />
      <polyline points="3 5 3 12 10 12" />
    </svg>
  );
}

// ─── Seed <-> URL ────────────────────────────────────────────────────────────
const MAX_SEED_LENGTH = 32;

/** The seed named by `?seed=`, or a fresh one when the URL does not name a run. */
function initialSeed(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("seed")?.trim();
  return fromUrl ? fromUrl.slice(0, MAX_SEED_LENGTH) : randomSeed();
}

/**
 * Keep the address bar pointing at the run on screen, so it can be copied and
 * handed to someone else. replaceState rather than pushState: re-rolling the
 * seed a dozen times should not bury the previous page under a dozen entries.
 */
function writeSeedToUrl(seed: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", seed);
  window.history.replaceState(null, "", url);
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function AntSim() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation | null>(null);
  const rafRef = useRef<number>(0);
  const frameCountRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [colonyScores, setColonyScores] = useState<number[]>([0]);
  const [foodRate, setFoodRate] = useState(0);
  const foodTimestampsRef = useRef<number[]>([]);
  const prevTotalRef = useRef(0);
  const [framesPerTick, setFramesPerTick] = useState(4);
  const [numAnts, setNumAnts] = useState(DEFAULT_NUM_ANTS);
  const [params, setParams] = useState<SimParams>(DEFAULT_PARAMS);
  const [canvasScale, setCanvasScale] = useState(1);
  const [watchedAntIdx, setWatchedAntIdx] = useState(0);
  const [manualControl, setManualControl] = useState(false);
  const [loopRate, setLoopRate] = useState(0.1);
  const [seed, setSeed] = useState(initialSeed);
  const [seedDraft, setSeedDraft] = useState(seed);
  const [numColonies, setNumColonies] = useState(DEFAULT_NUM_COLONIES);
  const [numFoodSources, setNumFoodSources] = useState(DEFAULT_NUM_FOOD_SOURCES);
  const [foodPerSource, setFoodPerSource] = useState(DEFAULT_FOOD_PER_SOURCE);
  const [editMode, setEditMode] = useState<EditMode>("none");
  const editModeRef = useRef<EditMode>("none");
  editModeRef.current = editMode;
  const hoverCellRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragActionRef = useRef<"open" | "close" | null>(null);
  const foodPerSourceRef2 = useRef(foodPerSource);
  foodPerSourceRef2.current = foodPerSource;

  const viewMode: ViewMode = manualControl ? "one" : "all";

  const paramsRef = useRef(params);
  paramsRef.current = params;
  const framesPerTickRef = useRef(framesPerTick);
  framesPerTickRef.current = framesPerTick;
  const numAntsRef = useRef(numAnts);
  numAntsRef.current = numAnts;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const watchedAntIdxRef = useRef(watchedAntIdx);
  watchedAntIdxRef.current = watchedAntIdx;
  const manualControlRef = useRef(manualControl);
  manualControlRef.current = manualControl;
  const loopRateRef = useRef(loopRate);
  loopRateRef.current = loopRate;
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const numColoniesRef = useRef(numColonies);
  numColoniesRef.current = numColonies;
  const numFoodSourcesRef = useRef(numFoodSources);
  numFoodSourcesRef.current = numFoodSources;
  const foodPerSourceRef = useRef(foodPerSource);
  foodPerSourceRef.current = foodPerSource;

  // Responsive canvas scaling
  useEffect(() => {
    const updateScale = () => {
      if (canvasWrapRef.current) {
        const available = canvasWrapRef.current.offsetWidth;
        setCanvasScale(Math.min(1, available / W));
      }
    };
    updateScale();
    const ro = new ResizeObserver(updateScale);
    if (canvasWrapRef.current) ro.observe(canvasWrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (simRef.current) simRef.current.params = { ...params };
  }, [params]);

  useEffect(() => {
    if (simRef.current) simRef.current.setAntCount(numAnts);
  }, [numAnts]);

  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (manualControl) {
      const all = sim.allAnts;
      // View-level draw, deliberately outside the seeded stream: taking a value
      // from sim.rng here would shift every later model draw, so which ant you
      // chose to drive would change how the rest of the colony behaved.
      const idx = Math.floor(Math.random() * all.length);
      setWatchedAntIdx(idx);
      watchedAntIdxRef.current = idx;
      all[idx].manual = true;
    } else {
      const all = sim.allAnts;
      const ant = all[watchedAntIdxRef.current];
      if (ant) ant.manual = false;
    }
  }, [manualControl]);

  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const all = sim.allAnts;
    const ant = all[watchedAntIdx];
    if (ant) ant.manual = manualControlRef.current;
  }, [watchedAntIdx]);

  const moveAnt = useCallback((ddx: number, ddy: number) => {
    if (!manualControlRef.current) return;
    const sim = simRef.current;
    if (!sim) return;
    const ant = sim.allAnts[watchedAntIdxRef.current];
    if (!ant) return;
    const nx = ant.cx + ddx, ny = ant.cy + ddy;
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return;
    if (sim.grid[ny][nx] !== 1) return;
    ant.prevCx = ant.cx;
    ant.prevCy = ant.cy;
    ant.tx = nx;
    ant.ty = ny;
  }, []);

  useEffect(() => {
    const DIR_MAP: Record<string, [number, number]> = {
      ArrowRight: [1, 0],
      ArrowLeft:  [-1, 0],
      ArrowDown:  [0, 1],
      ArrowUp:    [0, -1],
    };
    const onKey = (e: KeyboardEvent) => {
      if (!manualControlRef.current) return;
      const dir = DIR_MAP[e.key];
      if (!dir) return;
      e.preventDefault();
      moveAnt(dir[0], dir[1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveAnt]);

  const forceRender = useCallback(() => {
    const sim = simRef.current;
    const ctx = canvasRef.current?.getContext("2d");
    if (sim && ctx) render(ctx, sim, viewModeRef.current, watchedAntIdxRef.current, editModeRef.current, hoverCellRef.current);
  }, []);

  const cellFromPointer = useCallback((e: React.PointerEvent): { x: number; y: number } | null => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return null;
    const rect = wrap.getBoundingClientRect();
    const scale = canvasScale > 0 ? canvasScale : 1;
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;
    const gx = Math.floor(lx / scale / CELL);
    const gy = Math.floor(ly / scale / CELL);
    if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return null;
    return { x: gx, y: gy };
  }, [canvasScale]);

  const applyEdit = useCallback((gx: number, gy: number) => {
    const sim = simRef.current;
    if (!sim) return;
    const mode = editModeRef.current;

    if (mode === "wall") {
      const isNest = sim.colonies.some(c => c.nestX === gx && c.nestY === gy);
      if (isNest) return;
      const isFoodHere = sim.foodSources.some(s => s.x === gx && s.y === gy);
      if (isFoodHere) return;
      const wasWall = sim.grid[gy][gx] === 0;

      if (dragActionRef.current === null) {
        dragActionRef.current = wasWall ? "open" : "close";
      }

      if (dragActionRef.current === "open" && wasWall) {
        sim.grid[gy][gx] = 1;
      } else if (dragActionRef.current === "close" && !wasWall) {
        sim.grid[gy][gx] = 0;
        for (const colony of sim.colonies) {
          for (const ant of colony.ants) {
            if (ant.tx === gx && ant.ty === gy) {
              ant.tx = ant.cx; ant.ty = ant.cy;
            }
          }
        }
      }
    } else if (mode === "food") {
      const isWall = sim.grid[gy][gx] === 0;
      const isNest = sim.colonies.some(c => c.nestX === gx && c.nestY === gy);
      if (isWall || isNest) return;
      const srcIdx = sim.foodSources.findIndex(s => s.x === gx && s.y === gy);
      if (srcIdx >= 0) {
        sim.foodSources.splice(srcIdx, 1);
        for (const colony of sim.colonies) {
          colony.discoveredSources.delete(srcIdx);
          const updated = new Set<number>();
          for (const idx of colony.discoveredSources) updated.add(idx > srcIdx ? idx - 1 : idx);
          colony.discoveredSources = updated;
        }
      } else {
        const amount = foodPerSourceRef2.current;
        sim.foodSources.push({ x: gx, y: gy, remaining: amount, total: amount });
      }
    }
  }, []);

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if (editModeRef.current === "none" || viewModeRef.current !== "all") return;
    e.preventDefault();
    isDraggingRef.current = true;
    dragActionRef.current = null;
    const cell = cellFromPointer(e);
    if (cell) {
      applyEdit(cell.x, cell.y);
      forceRender();
    }
  }, [cellFromPointer, applyEdit, forceRender]);

  const handleCanvasPointerMove = useCallback((e: React.PointerEvent) => {
    if (editModeRef.current === "none" || viewModeRef.current !== "all") return;
    const cell = cellFromPointer(e);
    hoverCellRef.current = cell;
    if (isDraggingRef.current && cell) {
      applyEdit(cell.x, cell.y);
    }
    forceRender();
  }, [cellFromPointer, applyEdit, forceRender]);

  const handleCanvasPointerUp = useCallback(() => {
    isDraggingRef.current = false;
    dragActionRef.current = null;
  }, []);

  const handleCanvasPointerLeave = useCallback(() => {
    hoverCellRef.current = null;
    isDraggingRef.current = false;
    dragActionRef.current = null;
    forceRender();
  }, [forceRender]);

  // Commit the seed box on blur or Enter rather than on every keystroke, so
  // typing a seed does not regenerate the maze once per character.
  const applySeedDraft = () => {
    const next = seedDraft.trim().slice(0, MAX_SEED_LENGTH);
    if (!next) { setSeedDraft(seed); return; }
    if (next !== seed) setSeed(next);
  };

  const updateParam = <K extends keyof SimParams>(key: K, value: SimParams[K]) => {
    setParams(p => ({ ...p, [key]: value }));
  };

  const initSim = useCallback(() => {
    simRef.current = new Simulation(
      numAntsRef.current,
      paramsRef.current,
      loopRateRef.current,
      numColoniesRef.current,
      numFoodSourcesRef.current,
      foodPerSourceRef.current,
      seedRef.current,
    );
    setColonyScores(simRef.current.colonies.map(() => 0));
    setFoodRate(0);
    foodTimestampsRef.current = [];
    prevTotalRef.current = 0;
    if (viewModeRef.current === "one") {
      const total = simRef.current.allAnts.length;
      // View-level draw — see the note on manual control above.
      const idx = Math.floor(Math.random() * total);
      setWatchedAntIdx(idx);
      watchedAntIdxRef.current = idx;
    }
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && simRef.current) render(ctx, simRef.current, viewModeRef.current, watchedAntIdxRef.current, editModeRef.current, hoverCellRef.current);
  }, []);

  useEffect(() => { initSim(); }, [initSim]);

  // Reset when structure-level settings change
  useEffect(() => {
    setRunning(false);
    cancelAnimationFrame(rafRef.current);
    frameCountRef.current = 0;
    initSim();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopRate, numColonies, numFoodSources, foodPerSource, seed]);

  useEffect(() => {
    setSeedDraft(seed);
    writeSeedToUrl(seed);
  }, [seed]);

  useEffect(() => {
    if (!running) { cancelAnimationFrame(rafRef.current); return; }
    frameCountRef.current = 0;
    const loop = () => {
      const sim = simRef.current;
      const ctx = canvasRef.current?.getContext("2d");
      if (!sim || !ctx) return;
      frameCountRef.current++;
      if (frameCountRef.current >= framesPerTickRef.current) {
        frameCountRef.current = 0;
        sim.step();
        setColonyScores(sim.colonies.map(c => c.foodCollected));
        const total = sim.totalFoodCollected;
        const now = Date.now();
        const delta = total - prevTotalRef.current;
        if (delta > 0) {
          for (let i = 0; i < delta; i++) foodTimestampsRef.current.push(now);
          prevTotalRef.current = total;
        }
        const cutoff = now - 30_000;
        foodTimestampsRef.current = foodTimestampsRef.current.filter(t => t > cutoff);
        setFoodRate(foodTimestampsRef.current.length * 2);
      }
      render(ctx, sim, viewModeRef.current, watchedAntIdxRef.current, editModeRef.current, hoverCellRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running]);

  useEffect(() => {
    const sim = simRef.current;
    const ctx = canvasRef.current?.getContext("2d");
    if (sim && ctx) render(ctx, sim, viewMode, watchedAntIdx, editModeRef.current, hoverCellRef.current);
  }, [viewMode, watchedAntIdx]);

  const handleReset = () => {
    setRunning(false);
    setManualControl(false);
    cancelAnimationFrame(rafRef.current);
    frameCountRef.current = 0;
    initSim();
  };

  const stepsPerSec = Math.round(60 / framesPerTick);
  const speedLabel = framesPerTick <= 2 ? "Fast" : framesPerTick <= 6 ? "Medium" : framesPerTick <= 14 ? "Slow" : "Very slow";
  const tankCells = Math.round(params.tankMax / (DEPOSIT_RATE * (CELL / V)));
  const loopPct = Math.round(loopRate * 100);
  const loopLabel = loopRate === 0 ? "None (tree)" : loopRate < 0.05 ? "Very few" : loopRate < 0.15 ? "Some" : loopRate < 0.3 ? "Many" : "Lots";

  const totalCollected = colonyScores.reduce((a, b) => a + b, 0);

  return (
    <div style={{
      minHeight: "100vh",
      width: "100%",
      overflowX: "hidden",
      background: "#0f0a04",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      fontFamily: "'Inter', sans-serif",
      padding: "20px 16px 40px",
      gap: 16,
      color: "#e5d5b5",
      boxSizing: "border-box",
    }}>

      {/* Header: title + live stats */}
      <div style={{
        width: "100%",
        maxWidth: W,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 4,
        gap: 8,
        flexWrap: "wrap",
      }}>
        <h1 style={{ fontSize: "clamp(1rem, 3.5vw, 1.35rem)", fontWeight: 700, letterSpacing: "0.04em", margin: 0, color: "#f59e0b" }}>
          Ants in Maze
        </h1>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {numColonies === 1 ? (
            <>
              <div style={{
                display: "flex", alignItems: "center", gap: 5,
                background: "#1a1208", border: "1px solid #3d2e18", borderRadius: 20,
                padding: "clamp(3px,0.4vw,5px) clamp(10px,1.5vw,14px)",
              }}>
                <span style={{ fontSize: "clamp(0.58rem,1.5vw,0.68rem)", opacity: 0.45, letterSpacing: "0.05em", textTransform: "uppercase" }}>food</span>
                <span style={{ fontSize: "clamp(0.85rem,2.2vw,1.15rem)", fontWeight: 700, color: "#f59e0b", lineHeight: 1, minWidth: "2.5ch", display: "inline-block", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{totalCollected}</span>
              </div>
              <div style={{
                display: "flex", alignItems: "center", gap: 5,
                background: "#1a1208", border: "1px solid #3d2e18", borderRadius: 20,
                padding: "clamp(3px,0.4vw,5px) clamp(10px,1.5vw,14px)",
              }}>
                <span style={{ fontSize: "clamp(0.58rem,1.5vw,0.68rem)", opacity: 0.45, letterSpacing: "0.05em", textTransform: "uppercase" }}>rate</span>
                <span style={{ fontSize: "clamp(0.85rem,2.2vw,1.15rem)", fontWeight: 700, color: "#f59e0b", lineHeight: 1, minWidth: "6ch", display: "inline-block", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {foodRate > 0 ? `${foodRate}/min` : "—"}
                </span>
              </div>
            </>
          ) : (
            colonyScores.map((score, ci) => (
              <div key={ci} style={{
                display: "flex", alignItems: "center", gap: 5,
                background: "#1a1208", border: `1px solid ${COLONY_COLORS[ci].primary}55`, borderRadius: 20,
                padding: "clamp(3px,0.4vw,5px) clamp(10px,1.5vw,14px)",
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLONY_COLORS[ci].primary, flexShrink: 0 }} />
                <span style={{ fontSize: "clamp(0.58rem,1.5vw,0.68rem)", opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.05em" }}>C{ci + 1}</span>
                <span style={{ fontSize: "clamp(0.85rem,2.2vw,1.15rem)", fontWeight: 700, color: COLONY_COLORS[ci].primary, lineHeight: 1, minWidth: "2ch", display: "inline-block", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{score}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasWrapRef}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerLeave={handleCanvasPointerLeave}
        style={{
          width: "100%",
          maxWidth: W,
          border: `2px solid ${editMode !== "none" ? "#f59e0b" : "#3d2e18"}`,
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: editMode !== "none" ? "0 0 40px rgba(245,158,11,0.35)" : "0 0 40px rgba(245,158,11,0.15)",
          boxSizing: "border-box",
          cursor: editMode !== "none" && !manualControl ? "crosshair" : "default",
          transition: "border-color 0.2s, box-shadow 0.2s",
          touchAction: editMode !== "none" ? "none" : "auto",
        }}
      >
        <div style={{ width: W, height: H * canvasScale, overflow: "hidden" }}>
          <div style={{ width: W, height: H, transform: `scale(${canvasScale})`, transformOrigin: "top left" }}>
            <canvas ref={canvasRef} width={W} height={H} style={{ display: "block" }} />
          </div>
        </div>
      </div>

      {/* Edit toolbar — hidden in manual control mode */}
      {!manualControl && <div style={{
        width: "100%",
        maxWidth: W,
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}>
        <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b5a3e", flexShrink: 0 }}>
          Edit
        </span>
        {([
          { mode: "wall" as EditMode, icon: "🧱", label: "Walls", tip: "Click walls to open them · click paths to wall them · drag to paint" },
          { mode: "food" as EditMode, icon: "🍎", label: "Food", tip: "Click open cells to place food · click existing food to remove it" },
        ]).map(({ mode, icon, label, tip }) => {
          const active = editMode === mode;
          return (
            <button
              key={mode}
              title={tip}
              onClick={() => {
                const nextTool = editMode === mode ? "none" : mode;
                setEditMode(prev => prev === mode ? "none" : mode);
                hoverCellRef.current = null;
              }}
              disabled={manualControl}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px",
                borderRadius: 8,
                border: `1px solid ${active ? "#f59e0b" : "#3d2e18"}`,
                background: active ? "#2a1a00" : "#0f0a04",
                color: active ? "#f59e0b" : "#a08060",
                fontSize: "0.78rem", fontWeight: 600,
                cursor: manualControl ? "not-allowed" : "pointer",
                opacity: manualControl ? 0.4 : 1,
                transition: "border-color 0.15s, background 0.15s, color 0.15s",
                userSelect: "none",
              }}
            >
              <span style={{ fontSize: "1rem" }}>{icon}</span>
              {label}
              {active && <span style={{ fontSize: "0.65rem", opacity: 0.7, marginLeft: 2 }}>active</span>}
            </button>
          );
        })}
        {editMode !== "none" && (
          <span style={{ fontSize: "0.68rem", color: "#6b5a3e", marginLeft: 4 }}>
            {editMode === "wall"
              ? "Green = open wall · Red = close path · drag to paint"
              : "Green = place food · Red = remove food"}
          </span>
        )}
      </div>}

      {/* Legend */}
      <div style={{
        width: "100%",
        maxWidth: W,
        background: "#0d0902",
        border: "1px solid #1e140a",
        borderRadius: 10,
        padding: "10px 14px",
        display: "flex",
        gap: "6px 18px",
        flexWrap: "wrap",
        justifyContent: "center",
      }}>
        {numColonies === 1 ? (
          <>
            {[
              { emoji: "🏠", bg: COLONY_COLORS[0].primary, label: "Nest" },
              { emoji: "🍎", bg: "#16a34a", label: "Food" },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.7rem", opacity: 0.7 }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: item.bg, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, lineHeight: 1 }}>{item.emoji}</div>
                <span>{item.label}</span>
              </div>
            ))}
            {[
              { color: `rgba(${COLONY_COLORS[0].homeRGB},0.85)`, label: "Home trail" },
              { color: `rgba(${COLONY_COLORS[0].foodRGB},0.85)`, label: "Food trail" },
              ...(params.cautionary ? [{ color: "rgba(220,60,40,0.85)", label: "Cautionary" }] : []),
              { color: COLONY_COLORS[0].primary, label: "Searching" },
              { color: "#facc15", label: "Carrying" },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.7rem", opacity: 0.7 }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
                <span>{item.label}</span>
              </div>
            ))}
          </>
        ) : (
          <>
            {Array.from({ length: numColonies }, (_, ci) => (
              <div key={ci} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.7rem", opacity: 0.7 }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: COLONY_COLORS[ci].primary, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8 }}>🏠</div>
                <span>Colony {ci + 1}</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.7rem", opacity: 0.7 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: "#16a34a", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8 }}>🍎</div>
              <span>Food source</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.7rem", opacity: 0.7 }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#facc15", flexShrink: 0 }} />
              <span>Carrying food</span>
            </div>
            {params.cautionary && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.7rem", opacity: 0.7 }}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", background: "rgba(220,60,40,0.85)", flexShrink: 0 }} />
                <span>Cautionary</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Controls zone */}
      <div style={{
        width: "100%",
        maxWidth: W,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: manualControl ? 24 : 8,
        padding: "8px 0",
        userSelect: "none",
      }}>
        {manualControl ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <button
              onClick={() => { setRunning(r => !r); }}
              style={{
                width: 64, height: 64, borderRadius: 12,
                border: `1px solid ${running ? "#5b21b6" : "#3d2e18"}`,
                background: running ? "#3b1f6e" : "#1a1208",
                color: "#f59e0b", fontSize: "1.5rem", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                touchAction: "none", WebkitTapHighlightColor: "transparent",
              }}>
              {running ? <IconPause /> : <IconPlay />}
            </button>
            <button
              onClick={handleReset}
              style={{
                width: 64, height: 64, borderRadius: 12,
                border: "1px solid #3d2e18", background: "#1a1208",
                color: "#f59e0b", fontSize: "1.5rem", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                touchAction: "none", WebkitTapHighlightColor: "transparent",
              }}>
              <IconReset size={28} />
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <button
              onClick={() => { setRunning(r => !r); }}
              style={{
                flex: "1 1 0", height: 64, borderRadius: 12,
                border: `1px solid ${running ? "#5b21b6" : "#3d2e18"}`,
                background: running ? "#3b1f6e" : "#1a1208",
                color: "#f59e0b", fontSize: "1.1rem", fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                touchAction: "none", WebkitTapHighlightColor: "transparent",
              }}>
              {running ? <IconPause /> : <IconPlay />}
              <span style={{ fontSize: "0.85rem", userSelect: "none" }}>{running ? "Pause" : "Play"}</span>
            </button>
            <button
              onClick={handleReset}
              style={{
                flex: "1 1 0", height: 64, borderRadius: 12,
                border: "1px solid #3d2e18", background: "#1a1208",
                color: "#f59e0b", fontSize: "1.1rem", fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                touchAction: "none", WebkitTapHighlightColor: "transparent",
              }}>
              <IconReset size={26} />
              <span style={{ fontSize: "0.85rem", userSelect: "none" }}>Reset</span>
            </button>
          </div>
        )}

        {manualControl && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <DPadButton dir="up" onPress={() => moveAnt(0, -1)} />
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <DPadButton dir="left" onPress={() => moveAnt(-1, 0)} />
              <DPadButton dir="down" onPress={() => moveAnt(0, 1)} />
              <DPadButton dir="right" onPress={() => moveAnt(1, 0)} />
            </div>
          </div>
        )}
      </div>

      {/* Mode + speed row */}
      <div style={{ width: "100%", maxWidth: 600, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "stretch" }}>
        <div style={{
          background: "#0f0a04",
          border: `1px solid ${manualControl ? "#f59e0b" : "#3d2e18"}`,
          borderRadius: 10,
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          flex: "1 1 270px",
          minWidth: 0,
          transition: "border-color 0.2s",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#e5d5b5" }}>Mode</span>
            <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f59e0b", whiteSpace: "nowrap" }}>
              {manualControl ? "control one" : "observe all"}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "0.72rem", color: "#a08060", lineHeight: 1.45 }}>
            {manualControl
              ? "You control one ant using the arrow buttons above (or keyboard ↑ ↓ ← →). It still lays pheromones as it moves."
              : "The whole colony explores on its own, following pheromone trails."}
          </p>
          <div style={{ display: "flex", background: "#1a1208", border: "1px solid #3d2e18", borderRadius: 8, padding: 3, gap: 3 }}>
            {([false, true] as const).map(isManual => (
              <button
                key={String(isManual)}
                onClick={() => { setManualControl(isManual); if (isManual) { setEditMode("none"); hoverCellRef.current = null; } }}
                style={{
                  flex: 1, padding: "7px 0", border: "none", borderRadius: 7, cursor: "pointer",
                  fontWeight: 600, fontSize: "0.78rem", transition: "background 0.15s, color 0.15s",
                  letterSpacing: "0.02em",
                  background: manualControl === isManual ? "#f59e0b" : "transparent",
                  color: manualControl === isManual ? "#000" : "#a08060",
                }}
              >
                {isManual ? "Control one" : "Observe all"}
              </button>
            ))}
          </div>
        </div>

        <ControlCard
          label="Simulation speed"
          description={`How many steps run per second. ${speedLabel} — ${stepsPerSec} steps/sec.`}
          value={framesPerTick}
          displayValue={speedLabel}
          min={1} max={30} step={1}
          rtl
          onChange={setFramesPerTick}
          style={{ flex: "1 1 270px" }}
        />
      </div>

      {/* ── Colony settings ───────────────────────────────────────────────────── */}
      <div style={{ width: "100%", maxWidth: 600 }}>
        <p style={{ margin: "4px 0 8px", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b5a3e" }}>
          Colony settings
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "stretch" }}>

          <ControlCard
            label="Number of colonies"
            description="How many competing ant colonies share the maze. Each colony has its own nest (corner), pheromone trails, and score. Changing this regenerates the maze."
            value={numColonies}
            displayValue={numColonies === 1 ? "1 colony" : `${numColonies} colonies`}
            min={1} max={4} step={1}
            onChange={v => { setNumColonies(v); }}
            style={{ flex: "1 1 270px" }}
          />

          <ControlCard
            label="Colony size"
            description={`Number of ants per colony${numColonies > 1 ? ` (${numAnts * numColonies} total across ${numColonies} colonies)` : ""}. More ants find paths faster but can flood weak trails.`}
            value={numAnts}
            displayValue={`${numAnts} per colony`}
            min={1} max={100} step={1}
            onChange={v => { setNumAnts(v); }}
            style={{ flex: "1 1 270px" }}
          />

        </div>

        <p style={{ margin: "16px 0 8px", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b5a3e" }}>
          Food settings
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "stretch" }}>

          <ControlCard
            label="Food sources"
            description="How many food piles are scattered across the maze. All colonies compete for the same piles. Changing this regenerates the maze."
            value={numFoodSources}
            displayValue={`${numFoodSources} source${numFoodSources > 1 ? "s" : ""}`}
            min={1} max={8} step={1}
            onChange={v => { setNumFoodSources(v); }}
            style={{ flex: "1 1 270px" }}
          />

          <ControlCard
            label="Food per source"
            description="How many food units each pile contains. Once depleted, the pile goes dark and trails to it gradually fade. Changing this regenerates the maze."
            value={foodPerSource}
            displayValue={`${foodPerSource} units`}
            min={50} max={10000} step={50}
            onChange={v => { setFoodPerSource(v); }}
            style={{ flex: "1 1 270px" }}
          />

        </div>
      </div>

      {/* ── Ant settings ───────────────────────────────────────────────────────── */}
      <div style={{ width: "100%", maxWidth: 600 }}>
        <p style={{ margin: "4px 0 8px", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b5a3e" }}>
          Ant settings
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "stretch" }}>

          <ParamCard
            label="Evaporation rate"
            description="How quickly pheromone trails fade away. Higher = trails vanish faster, forcing re-exploration. Lower = old paths persist, ants stay focused on established routes."
            value={params.evapRate}
            displayValue={`${(params.evapRate * 1000).toFixed(0)}‰ / step`}
            min={0.001} max={0.02} step={0.001}
            onChange={v => updateParam("evapRate", v)}
          />

          <ParamCard
            label="Trail bias"
            description="How strongly ants prefer stronger trails. Power 1 = nearly random exploration. Power 10 = ants almost always follow the most-travelled path."
            value={params.trailPower}
            displayValue={`power ${params.trailPower}`}
            min={1} max={10} step={0.5}
            onChange={v => updateParam("trailPower", v)}
          />

          <ParamCard
            label="Gland size"
            description="How much pheromone each ant can carry. Larger glands mark longer paths before running dry. Smaller glands mean only short routes get reinforced."
            value={params.tankMax}
            displayValue={`~${tankCells} cells`}
            min={1600} max={16000} step={800}
            onChange={v => updateParam("tankMax", v)}
          />

          {/* Cautionary pheromone toggle */}
          <div style={{
            background: "#0f0a04",
            border: "1px solid #3d2e18",
            borderRadius: 10,
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            flex: "1 1 270px",
            minWidth: 0,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#e5d5b5" }}>Cautionary</span>
              <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f59e0b", whiteSpace: "nowrap" }}>
                {params.cautionary ? "on" : "off"}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: "0.72rem", color: "#a08060", lineHeight: 1.45 }}>
              Ants whose gland runs dry mark those cells red. Others avoid them, pruning routes too long to sustain.
            </p>
            <div style={{ display: "flex", background: "#1a1208", border: "1px solid #3d2e18", borderRadius: 8, padding: 3, gap: 3 }}>
              {([false, true] as const).map(val => (
                <button
                  key={String(val)}
                  onClick={() => { updateParam("cautionary", val); }}
                  style={{
                    flex: 1, padding: "7px 0", border: "none", borderRadius: 7, cursor: "pointer",
                    fontWeight: 600, fontSize: "0.78rem", transition: "background 0.15s, color 0.15s",
                    letterSpacing: "0.02em",
                    background: params.cautionary === val ? "#f59e0b" : "transparent",
                    color: params.cautionary === val ? "#000" : "#a08060",
                  }}
                >
                  {val ? "On" : "Off"}
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* ── Maze settings ──────────────────────────────────────────────────────── */}
      <div style={{ width: "100%", maxWidth: 600 }}>
        <p style={{ margin: "4px 0 8px", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b5a3e" }}>
          Maze settings
        </p>
        <div style={{
          background: "#0f0a04",
          border: "1px solid #3d2e18",
          borderRadius: 10,
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#e5d5b5" }}>Extra holes (loop rate)</span>
            <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f59e0b", whiteSpace: "nowrap" }}>
              {loopLabel} — {loopPct}%
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "0.72rem", color: "#a08060", lineHeight: 1.45 }}>
            How many extra holes are punched through maze walls. At 0% the maze is a pure tree — one unique path between every two points. Higher values add shortcuts and loops, giving ants more route options. <strong style={{ color: "#e5d5b5" }}>Changing this regenerates the maze.</strong>
          </p>
          <input
            type="range"
            min={0} max={0.5} step={0.01} value={loopRate}
            onChange={e => setLoopRate(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#f59e0b", cursor: "pointer", margin: "2px 0" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "#6b5a3e" }}>
            <span>0% — tree maze</span>
            <span>50% — many loops</span>
          </div>
        </div>

        {/* Seed */}
        <div style={{
          background: "#0f0a04",
          border: "1px solid #3d2e18",
          borderRadius: 10,
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginTop: 10,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#e5d5b5" }}>Seed</span>
            <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f59e0b", whiteSpace: "nowrap" }}>
              {seed}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "0.72rem", color: "#a08060", lineHeight: 1.45 }}>
            Every random choice in the run — the maze, where food lands, which way each ant turns — comes from this seed. The same seed and the same settings replay the same run exactly, so a difference between two runs is the setting you changed and not luck. The address bar tracks the seed, so copying the link hands someone your exact run. <strong style={{ color: "#e5d5b5" }}>Changing this regenerates the maze.</strong>
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <input
              type="text"
              value={seedDraft}
              maxLength={MAX_SEED_LENGTH}
              spellCheck={false}
              autoComplete="off"
              aria-label="Simulation seed"
              onChange={e => setSeedDraft(e.target.value)}
              onBlur={() => applySeedDraft()}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); applySeedDraft(); (e.target as HTMLInputElement).blur(); } }}
              style={{
                flex: "1 1 auto",
                minWidth: 0,
                background: "#1a1208",
                border: "1px solid #3d2e18",
                borderRadius: 8,
                padding: "8px 10px",
                color: "#e5d5b5",
                fontSize: "0.85rem",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                letterSpacing: "0.04em",
              }}
            />
            <button
              type="button"
              onClick={() => setSeed(randomSeed())}
              title="Start a new run with a fresh seed"
              style={{
                flexShrink: 0,
                background: "#1a1208",
                border: "1px solid #3d2e18",
                borderRadius: 8,
                padding: "8px 14px",
                color: "#f59e0b",
                fontSize: "0.75rem",
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              New seed
            </button>
          </div>
        </div>
      </div>

      {/* Footer note */}
      <p style={{ fontSize: "0.68rem", opacity: 0.35, textAlign: "center", maxWidth: 520, margin: 0, lineHeight: 1.6 }}>
        {manualControl
          ? "You are one ant. The maze is vast. You smell pheromones but cannot see the whole picture."
          : numColonies > 1
            ? "Each colony builds its own pheromone map. Food depletes as colonies compete — the fastest forager wins."
            : "Shorter paths win by completing more round-trips per unit time — pure stigmergy, no individual intelligence. Ant opacity shows remaining gland level."}
      </p>
    </div>
  );
}
