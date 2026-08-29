// ─────────────────────────────────────────────────────────────────────────────
// Offscreen layers for the maze renderer.
//
// Drawing a rectangle per cell per colony per pheromone field is fine on a
// 31x31 grid and hopeless on a room-sized one: at six thousand cells and four
// colonies it is tens of thousands of fills every frame.
//
// Two layers instead. Ground changes only when the world is regenerated or
// painted, so it is drawn once at full resolution and blitted. Pheromone
// changes constantly but is one value per cell, so it is written as an image
// the size of the grid and scaled up — which also blends it, and a diffuse
// chemical field reads better soft than tiled.
// ─────────────────────────────────────────────────────────────────────────────

import { CELL } from "./constants";
import { Facing, FACING_VECTORS, Terrain, type TerrainLayer } from "./terrain";
import type { CellType } from "./world";

const WALL_FILL = "#0d0a06";
const VOID_FILL = "#0a0602";

/** Deterministic speckle so terrain texture holds still between frames. */
function speckle(
  ctx: CanvasRenderingContext2D,
  px: number, py: number,
  gx: number, gy: number,
  color: string,
) {
  ctx.fillStyle = color;
  let h = (gx * 73_856_093) ^ (gy * 19_349_663);
  for (let i = 0; i < 3; i++) {
    h = (h * 1_103_515_245 + 12_345) & 0x7fffffff;
    ctx.fillRect(px + ((h >> 8) % CELL), py + ((h >> 16) % CELL), 2, 2);
  }
}

/** Chevrons pointing the way a scarp falls. */
function scarpMark(ctx: CanvasRenderingContext2D, px: number, py: number, facing: Facing) {
  const [fx, fy] = FACING_VECTORS[facing];
  const cx = px + CELL / 2, cy = py + CELL / 2;
  const wx = -fy, wy = fx;

  ctx.strokeStyle = "rgba(226,214,226,0.55)";
  ctx.lineWidth = 1.25;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const lead of [-3, 2]) {
    const tipX = cx + fx * (lead + 3), tipY = cy + fy * (lead + 3);
    ctx.beginPath();
    ctx.moveTo(tipX - fx * 3 + wx * 3.5, tipY - fy * 3 + wy * 3.5);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tipX - fx * 3 - wx * 3.5, tipY - fy * 3 - wy * 3.5);
    ctx.stroke();
  }
}

/**
 * Ground: walls, surfaces, texture and scarp markings, drawn once and reused
 * until the world changes.
 */
export class GroundLayer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private drawnVersion = -1;

  constructor(readonly cols: number, readonly rows: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = cols * CELL;
    this.canvas.height = rows * CELL;
    this.ctx = this.canvas.getContext("2d");
  }

  /** Redraw if `version` has moved since the last time. */
  sync(grid: CellType[][], terrain: TerrainLayer, version: number) {
    if (version === this.drawnVersion) return;
    this.drawnVersion = version;

    const ctx = this.ctx;
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = VOID_FILL;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const px = x * CELL, py = y * CELL;
        if (grid[y][x] === 0) {
          ctx.fillStyle = WALL_FILL;
          ctx.fillRect(px, py, CELL, CELL);
          continue;
        }
        const ground = terrain.props(x, y);
        ctx.fillStyle = ground.fill;
        ctx.fillRect(px, py, CELL, CELL);
        if (ground.speckle) speckle(ctx, px, py, x, y, ground.speckle);
        if (terrain.at(x, y) === Terrain.Scarp) scarpMark(ctx, px, py, terrain.facingAt(x, y));
      }
    }
  }

  /** Force a redraw on the next sync, whatever the version says. */
  invalidate() {
    this.drawnVersion = -1;
  }
}

export interface PheroColors {
  homeRGB: string;
  foodRGB: string;
}

function parseRGB(rgb: string): [number, number, number] {
  const [r, g, b] = rgb.split(",").map(Number);
  return [r, g, b];
}

export interface PheroSource {
  homePhero: Float32Array;
  foodPhero: Float32Array;
  cautPhero: Float32Array;
}

/**
 * Pheromone: one pixel per cell, composited across colonies, then scaled up
 * over the ground with the canvas doing the blending.
 */
export class PheroLayer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private image: ImageData | null;

  constructor(readonly cols: number, readonly rows: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = cols;
    this.canvas.height = rows;
    this.ctx = this.canvas.getContext("2d");
    this.image = this.ctx?.createImageData(cols, rows) ?? null;
  }

  /**
   * Rebuild from the colonies' fields.
   *
   * Colours are mixed weighted by strength and the alphas summed, so where two
   * colonies overlap you see both rather than whichever drew last.
   */
  sync(
    colonies: readonly PheroSource[],
    palette: readonly PheroColors[],
    cautionary: boolean,
    nestSeed: number,
  ) {
    const ctx = this.ctx, image = this.image;
    if (!ctx || !image) return;

    const data = image.data;
    const cells = this.cols * this.rows;
    const rgbCache = palette.map(p => ({ home: parseRGB(p.homeRGB), food: parseRGB(p.foodRGB) }));

    for (let i = 0; i < cells; i++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let ci = 0; ci < colonies.length; ci++) {
        const colony = colonies[ci];
        const colors = rgbCache[ci % rgbCache.length];

        const hi = colony.homePhero[i];
        if (hi > 0.5) {
          const alpha = Math.min(0.55, (hi / nestSeed) * 0.55);
          r += colors.home[0] * alpha; g += colors.home[1] * alpha; b += colors.home[2] * alpha;
          a += alpha;
        }
        const fi = colony.foodPhero[i];
        if (fi > 0.5) {
          const alpha = Math.min(0.6, (fi / nestSeed) * 0.6);
          r += colors.food[0] * alpha; g += colors.food[1] * alpha; b += colors.food[2] * alpha;
          a += alpha;
        }
        if (cautionary) {
          const ci2 = colony.cautPhero[i];
          if (ci2 > 0.5) {
            const alpha = Math.min(0.45, (ci2 / nestSeed) * 0.45);
            r += 220 * alpha; g += 60 * alpha; b += 40 * alpha;
            a += alpha;
          }
        }
      }

      const o = i * 4;
      if (a <= 0) {
        data[o + 3] = 0;
        continue;
      }
      data[o] = Math.min(255, r / a);
      data[o + 1] = Math.min(255, g / a);
      data[o + 2] = Math.min(255, b / a);
      data[o + 3] = Math.min(255, Math.round(a * 255));
    }

    ctx.putImageData(image, 0, 0);
  }
}
