import { COLS, ROWS, CELL, W, H, NEST_SEED, cellCenter } from "@stigsim/sim-core";
import type { Simulation } from "@stigsim/sim-core";

// ─── One-ant view: half-size of the source window in pixels ─────────────────
export const VIEW_HALF = CELL * 1;

// ─── Colony visual identity ──────────────────────────────────────────────────
export const COLONY_COLORS = [
  { primary: "#4b9eff", homeRGB: "80,158,255", foodRGB: "80,220,200" },
  { primary: "#ff6b6b", homeRGB: "255,107,107", foodRGB: "255,200,80"  },
  { primary: "#4bde80", homeRGB: "75,222,128",  foodRGB: "200,255,80"  },
  { primary: "#c084fc", homeRGB: "192,132,252", foodRGB: "252,132,200" },
];

export type ViewMode = "all" | "one";
export type EditMode = "none" | "wall" | "food";

export function render(
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
