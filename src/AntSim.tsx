import { useRef, useEffect, useCallback, useState } from "react";
import {
  Simulation, computeHighwayScore, cellCenter,
  COLS, ROWS, CELL, W, H, V, DEPOSIT_RATE, DEFAULT_NUM_ANTS,
  DEFAULT_PARAMS, DEFAULT_NUM_COLONIES, DEFAULT_NUM_FOOD_SOURCES,
  DEFAULT_FOOD_PER_SOURCE, makeSeeds, generateMasterSeed,
} from "./sim";
import type { SimParams, RunConfig, Command } from "./sim";
import { render, COLONY_COLORS } from "./render";
import type { ViewMode, EditMode } from "./render";

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
  const [numColonies, setNumColonies] = useState(DEFAULT_NUM_COLONIES);
  const [numFoodSources, setNumFoodSources] = useState(DEFAULT_NUM_FOOD_SOURCES);
  const [foodPerSource, setFoodPerSource] = useState(DEFAULT_FOOD_PER_SOURCE);
  const [seedInput, setSeedInput] = useState(() => generateMasterSeed());
  const [activeSeed, setActiveSeed] = useState(seedInput);
  const seedInputRef = useRef(seedInput);
  seedInputRef.current = seedInput;
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
  const numColoniesRef = useRef(numColonies);
  numColoniesRef.current = numColonies;
  const numFoodSourcesRef = useRef(numFoodSources);
  numFoodSourcesRef.current = numFoodSources;
  const foodPerSourceRef = useRef(foodPerSource);
  foodPerSourceRef.current = foodPerSource;
  const runningRef = useRef(running);
  runningRef.current = running;

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

  const forceRender = useCallback(() => {
    const sim = simRef.current;
    const ctx = canvasRef.current?.getContext("2d");
    if (sim && ctx) render(ctx, sim, viewModeRef.current, watchedAntIdxRef.current, editModeRef.current, hoverCellRef.current);
  }, []);

  const send = useCallback((cmd: Command) => {
    const sim = simRef.current;
    if (!sim) return;
    sim.enqueue(cmd);
    if (!runningRef.current) {
      sim.flushPending();
      forceRender();
    }
  }, [forceRender]);

  useEffect(() => {
    send({ kind: "setParam", key: "evapRate", value: params.evapRate });
  }, [params.evapRate, send]);

  useEffect(() => {
    send({ kind: "setParam", key: "trailPower", value: params.trailPower });
  }, [params.trailPower, send]);

  useEffect(() => {
    send({ kind: "setParam", key: "tankMax", value: params.tankMax });
  }, [params.tankMax, send]);

  useEffect(() => {
    send({ kind: "setCautionary", value: params.cautionary });
  }, [params.cautionary, send]);

  useEffect(() => {
    send({ kind: "setAntCount", n: numAnts });
  }, [numAnts, send]);

  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (!manualControl) {
      send({ kind: "setManualAnt", index: null });
      return;
    }
    const idx = Math.floor(Math.random() * sim.allAnts.length);
    setWatchedAntIdx(idx);
    watchedAntIdxRef.current = idx;
    send({ kind: "setManualAnt", index: idx });
  }, [manualControl, send]);

  useEffect(() => {
    if (!manualControlRef.current) return;
    send({ kind: "setManualAnt", index: watchedAntIdx });
  }, [watchedAntIdx, send]);

  const moveAnt = useCallback((ddx: number, ddy: number) => {
    if (!manualControlRef.current) return;
    send({ kind: "moveManualAnt", dx: ddx, dy: ddy });
  }, [send]);

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
        send({ kind: "setWall", x: gx, y: gy, open: true });
      } else if (dragActionRef.current === "close" && !wasWall) {
        send({ kind: "setWall", x: gx, y: gy, open: false });
      }
    } else if (mode === "food") {
      const isWall = sim.grid[gy][gx] === 0;
      const isNest = sim.colonies.some(c => c.nestX === gx && c.nestY === gy);
      if (isWall || isNest) return;
      const exists = sim.foodSources.some(s => s.x === gx && s.y === gy);
      send({ kind: "setFood", x: gx, y: gy, amount: exists ? 0 : foodPerSourceRef2.current });
    }
  }, [send]);

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

  const updateParam = <K extends keyof SimParams>(key: K, value: SimParams[K]) => {
    setParams(p => ({ ...p, [key]: value }));
  };

  const initSim = useCallback(() => {
    const master = seedInputRef.current.trim() || generateMasterSeed();
    setActiveSeed(master);
    simRef.current = new Simulation({
      seeds: makeSeeds(master),
      numAnts: numAntsRef.current,
      params: paramsRef.current,
      loopRate: loopRateRef.current,
      numColonies: numColoniesRef.current,
      numFoodSources: numFoodSourcesRef.current,
      foodPerSource: foodPerSourceRef.current,
    });
    setColonyScores(simRef.current.colonies.map(() => 0));
    setFoodRate(0);
    foodTimestampsRef.current = [];
    prevTotalRef.current = 0;
    if (viewModeRef.current === "one") {
      const total = simRef.current.allAnts.length;
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
  }, [loopRate, numColonies, numFoodSources, foodPerSource]);

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

      <div style={{ width: "100%", maxWidth: 600 }}>
        <p style={{ margin: "4px 0 8px", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6b5a3e" }}>
          Run
        </p>
        <div style={{
          background: "#0f0a04", border: "1px solid #3d2e18", borderRadius: 10,
          padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={seedInput}
              onChange={e => setSeedInput(e.target.value)}
              spellCheck={false}
              aria-label="Run seed"
              style={{
                flex: 1, minWidth: 0, background: "#1a1208", color: "#e5d5b5",
                border: "1px solid #3d2e18", borderRadius: 6, padding: "6px 8px",
                fontFamily: "monospace", fontSize: "0.8rem",
              }}
            />
            <button
              type="button"
              onClick={() => setSeedInput(generateMasterSeed())}
              style={{
                background: "#1a1208", color: "#f59e0b", border: "1px solid #3d2e18",
                borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: "0.8rem",
              }}
            >
              New seed
            </button>
          </div>
          <p style={{ margin: 0, fontSize: "0.72rem", color: "#a08060", lineHeight: 1.45 }}>
            {seedInput.trim() === activeSeed
              ? "Runs with this seed reproduce exactly."
              : `Running as "${activeSeed}". Reset to use the new seed.`}
          </p>
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
