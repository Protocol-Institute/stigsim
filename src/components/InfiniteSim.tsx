import { useRef, useEffect, useState, useCallback } from "react";
import {
  CELL,
  CHUNK_SIZE,
  TICKS_PER_SEC,
  COLONY_COLORS,
  type ColonyParams,
  type ColonyInfo,
  type LeaderboardEntry,
} from "../../shared/infinite-contract";

const INFINITE_SERVER_URL = (import.meta.env.VITE_INFINITE_SERVER_URL ?? "").replace(/\/$/, "");
const infiniteApiUrl = (path: string) => `${INFINITE_SERVER_URL}${path}`;
const infiniteWsUrl = () => {
  const base = INFINITE_SERVER_URL || location.origin;
  const url = new URL("/api/infinite/ws", base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

// ─── Types ────────────────────────────────────────────────────────────────────
type Tool = "pan" | "wall" | "food" | "colony";
type AppMode = "god" | "survive";

interface FoodSrc {
  x: number; y: number;
  r: number; t: number;
}

interface AntInfo {
  cid: number;
  wx: number; wy: number;
  f: number;
}

interface PheroChunkData {
  home: number[];
  food: number[];
}

type PheroMap = Map<string, PheroChunkData>;

interface WorldState {
  walls: Set<string>;
  colonies: ColonyInfo[];
  foodSources: FoodSrc[];
  ants: AntInfo[];
  phero: Map<number, PheroMap>;
}

interface DeathNotice {
  name: string;
  lifespanTicks: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatLifespan(ticks: number): string {
  const secs = Math.round(ticks / TICKS_PER_SEC);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// ─── Chunk helpers ────────────────────────────────────────────────────────────
function chunkOf(v: number) { return Math.floor(v / CHUNK_SIZE); }
function localOf(v: number) { return ((v % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE; }
function chunkKey(cx: number, cy: number) { return `${cx},${cy}`; }

function getPhero(phero: Map<number, PheroMap>, colonyId: number, type: "home" | "food", wx: number, wy: number): number {
  const pm = phero.get(colonyId);
  if (!pm) return 0;
  const chunk = pm.get(chunkKey(chunkOf(wx), chunkOf(wy)));
  if (!chunk) return 0;
  return chunk[type][localOf(wy) * CHUNK_SIZE + localOf(wx)] / 255;
}

// suppress unused warning
void getPhero;

// ─── Canvas render ────────────────────────────────────────────────────────────
function renderWorld(
  canvas: HTMLCanvasElement,
  world: WorldState,
  pan: { x: number; y: number },
  zoom: number,
  tool: Tool,
  hoverCell: { x: number; y: number } | null,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const CW = canvas.width, CH = canvas.height;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#2a1e0e";
  ctx.fillRect(0, 0, CW, CH);

  ctx.setTransform(zoom, 0, 0, zoom, -pan.x * zoom, -pan.y * zoom);

  const x0 = Math.floor(pan.x / CELL) - 1;
  const y0 = Math.floor(pan.y / CELL) - 1;
  const x1 = Math.ceil((pan.x + CW / zoom) / CELL) + 1;
  const y1 = Math.ceil((pan.y + CH / zoom) / CELL) + 1;

  ctx.fillStyle = "#0d0a06";
  for (const key of world.walls) {
    const comma = key.indexOf(",");
    const wx = parseInt(key.slice(0, comma));
    const wy = parseInt(key.slice(comma + 1));
    if (wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1) {
      ctx.fillRect(wx * CELL, wy * CELL, CELL, CELL);
    }
  }

  const cxMin = chunkOf(x0), cyMin = chunkOf(y0);
  const cxMax = chunkOf(x1), cyMax = chunkOf(y1);

  for (const [colonyId, pm] of world.phero) {
    const col = world.colonies.find(c => c.id === colonyId);
    if (!col) continue;
    const colors = COLONY_COLORS[col.params.colorIdx % COLONY_COLORS.length];

    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const chunk = pm.get(chunkKey(cx, cy));
        if (!chunk) continue;
        const baseX = cx * CHUNK_SIZE;
        const baseY = cy * CHUNK_SIZE;

        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          const wy = baseY + ly;
          if (wy < y0 || wy > y1) continue;
          for (let lx = 0; lx < CHUNK_SIZE; lx++) {
            const wx = baseX + lx;
            if (wx < x0 || wx > x1) continue;
            if (world.walls.has(`${wx},${wy}`)) continue;

            const idx = ly * CHUNK_SIZE + lx;
            const hi = chunk.home[idx] / 255;
            const fi = chunk.food[idx] / 255;
            const px = wx * CELL, py = wy * CELL;

            if (hi > 0.02) {
              ctx.fillStyle = `rgba(${colors.homeRGB},${Math.min(0.55, hi * 0.55).toFixed(3)})`;
              ctx.fillRect(px, py, CELL, CELL);
            }
            if (fi > 0.02) {
              ctx.fillStyle = `rgba(${colors.foodRGB},${Math.min(0.6, fi * 0.6).toFixed(3)})`;
              ctx.fillRect(px, py, CELL, CELL);
            }
          }
        }
      }
    }
  }

  if (zoom > 0.4) {
    ctx.font = `${CELL - 2}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }
  for (const src of world.foodSources) {
    if (src.x < x0 || src.x > x1 || src.y < y0 || src.y > y1) continue;
    const fpx = src.x * CELL, fpy = src.y * CELL;
    ctx.fillStyle = "#16a34a";
    ctx.fillRect(fpx, fpy, CELL, CELL);
    if (zoom > 0.5) ctx.fillText("🍎", fpx + CELL / 2, fpy + CELL / 2);
    if (src.r < src.t) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(fpx, fpy + CELL - 3, CELL, 3);
      ctx.fillStyle = "#4ade80";
      ctx.fillRect(fpx, fpy + CELL - 3, Math.round(CELL * (src.r / src.t)), 3);
    }
  }

  for (const col of world.colonies) {
    if (col.nestX < x0 || col.nestX > x1 || col.nestY < y0 || col.nestY > y1) continue;
    const npx = col.nestX * CELL, npy = col.nestY * CELL;
    const colors = COLONY_COLORS[col.params.colorIdx % COLONY_COLORS.length];
    ctx.fillStyle = colors.primary;
    ctx.fillRect(npx, npy, CELL, CELL);
    if (zoom > 0.5) ctx.fillText("🏠", npx + CELL / 2, npy + CELL / 2);
  }

  for (const ant of world.ants) {
    const col = world.colonies.find(c => c.id === ant.cid);
    if (!col) continue;
    const colors = COLONY_COLORS[col.params.colorIdx % COLONY_COLORS.length];
    const r = ant.f ? 4.5 : 3.5;
    ctx.beginPath();
    ctx.arc(ant.wx, ant.wy, r, 0, Math.PI * 2);
    ctx.fillStyle = ant.f ? "#facc15" : colors.primary;
    ctx.fill();
  }

  if (hoverCell && tool !== "pan") {
    const { x: hx, y: hy } = hoverCell;
    const hpx = hx * CELL, hpy = hy * CELL;
    const isWall = world.walls.has(`${hx},${hy}`);
    ctx.globalAlpha = 0.45;
    if (tool === "wall") ctx.fillStyle = isWall ? "#22c55e" : "#ef4444";
    else if (tool === "food") ctx.fillStyle = isWall ? "#6b7280" : "#22c55e";
    else if (tool === "colony") ctx.fillStyle = isWall ? "#6b7280" : "#a78bfa";
    ctx.fillRect(hpx, hpy, CELL, CELL);
    ctx.globalAlpha = 1;
  }

  if (zoom >= 3) {
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 0.5 / zoom;
    for (let x = x0; x <= x1; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL, y0 * CELL); ctx.lineTo(x * CELL, (y1 + 1) * CELL); ctx.stroke();
    }
    for (let y = y0; y <= y1; y++) {
      ctx.beginPath(); ctx.moveTo(x0 * CELL, y * CELL); ctx.lineTo((x1 + 1) * CELL, y * CELL); ctx.stroke();
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────
function ModeToggle({ mode, setMode }: { mode: AppMode; setMode: (m: AppMode) => void }) {
  return (
    <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid #3d2e18", flexShrink: 0 }}>
      <button onClick={() => setMode("god")} style={{
        padding: "5px 10px", border: "none", cursor: "pointer",
        background: mode === "god" ? "#92400e" : "transparent",
        color: mode === "god" ? "#fcd34d" : "#6b5040",
        fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.04em",
        transition: "background 0.15s, color 0.15s",
      }}>⚡ GOD</button>
      <div style={{ width: 1, background: "#3d2e18", alignSelf: "stretch" }} />
      <button onClick={() => setMode("survive")} style={{
        padding: "5px 10px", border: "none", cursor: "pointer",
        background: mode === "survive" ? "#14532d" : "transparent",
        color: mode === "survive" ? "#4ade80" : "#6b5040",
        fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.04em",
        transition: "background 0.15s, color 0.15s",
      }}>🎯 SURVIVE</button>
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────
function ToolBtn({ label, icon, active, onClick, compact }: {
  label: string; icon: string; active: boolean; onClick: () => void; compact?: boolean;
}) {
  return (
    <button onClick={onClick} title={label} style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      padding: compact ? "6px 8px" : "6px 10px",
      borderRadius: 8, cursor: "pointer", border: "none",
      background: active ? "#3d2e18" : "transparent",
      color: active ? "#f59e0b" : "#a08060",
      fontSize: compact ? "1.1rem" : "1.2rem", lineHeight: 1,
      transition: "background 0.15s, color 0.15s",
    }}>
      <span>{icon}</span>
      {!compact && <span style={{ fontSize: "0.55rem", fontWeight: 600, letterSpacing: "0.05em" }}>{label}</span>}
    </button>
  );
}

function Toolbar({
  tool, setTool, connected, colonies, leaderboard, onGoTo, onCenter,
  mode, setMode, surviveColonyPlaced,
}: {
  tool: Tool; setTool: (t: Tool) => void;
  connected: boolean; colonies: ColonyInfo[];
  leaderboard: LeaderboardEntry[];
  onGoTo: (x: number, y: number) => void;
  onCenter: () => void;
  mode: AppMode;
  setMode: (m: AppMode) => void;
  surviveColonyPlaced: boolean;
}) {
  const [open, setOpen] = useState(false);
  const deadEntries = leaderboard.filter(e => !e.alive);
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 640;

  return (
    <div style={{
      position: "fixed",
      top: 8,
      ...(isMobile
        ? { left: 8, right: 8, transform: "none" }
        : { left: "50%", transform: "translateX(-50%)" }),
      display: "flex", alignItems: "center", gap: isMobile ? 2 : 4,
      background: "#0f0a04cc", backdropFilter: "blur(8px)",
      border: "1px solid #3d2e18", borderRadius: 12,
      padding: isMobile ? "5px 8px" : "6px 10px", zIndex: 100,
      boxShadow: "0 4px 24px rgba(0,0,0,0.6)", userSelect: "none",
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%", marginRight: isMobile ? 4 : 6, flexShrink: 0,
        background: connected ? "#4ade80" : "#f87171",
        boxShadow: connected ? "0 0 6px #4ade80" : undefined,
      }} title={connected ? "Live" : "Connecting…"} />

      <ModeToggle mode={mode} setMode={setMode} />

      <div style={{ width: 1, height: 28, background: "#3d2e18", margin: isMobile ? "0 2px" : "0 4px" }} />

      <ToolBtn label="Pan" icon="✋" active={tool === "pan"} onClick={() => setTool("pan")} compact={isMobile} />

      {mode === "god" && (
        <>
          <ToolBtn label="Wall" icon="🧱" active={tool === "wall"} onClick={() => setTool("wall")} compact={isMobile} />
          <ToolBtn label="Food" icon="🍎" active={tool === "food"} onClick={() => setTool("food")} compact={isMobile} />
          <ToolBtn label="Colony" icon="🏠" active={tool === "colony"} onClick={() => setTool("colony")} compact={isMobile} />
        </>
      )}

      {mode === "survive" && !surviveColonyPlaced && (
        <ToolBtn label="Colony" icon="🏠" active={tool === "colony"} onClick={() => setTool("colony")} compact={isMobile} />
      )}

      <div style={{ width: 1, height: 28, background: "#3d2e18", margin: isMobile ? "0 2px" : "0 4px" }} />

      {/* Colonies button — on mobile show icon only */}
      <div style={{ position: "relative" }}>
        <button onClick={() => setOpen(v => !v)} style={{
          padding: isMobile ? "6px 8px" : "6px 10px",
          borderRadius: 8, border: "none", cursor: "pointer",
          background: open ? "#3d2e18" : "transparent", color: "#a08060",
          fontSize: isMobile ? "1rem" : "0.7rem", fontWeight: 600,
          display: "flex", alignItems: "center", gap: 4,
        }}>
          {isMobile ? (
            <span title={`Colonies (${colonies.length})`}>🏘️</span>
          ) : (
            `Colonies (${colonies.length})`
          )}
        </button>
        {open && (
          <div style={{
            position: "absolute", top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
            background: "#0f0a04", border: "1px solid #3d2e18", borderRadius: 10,
            padding: 8, minWidth: 240, maxWidth: "90vw",
            maxHeight: "70vh", overflowY: "auto",
            display: "flex", flexDirection: "column", gap: 4,
            zIndex: 200,
          }}>
            {colonies.length === 0 && deadEntries.length === 0 ? (
              <span style={{ fontSize: "0.75rem", color: "#6b5040", padding: "6px 4px" }}>
                No colonies yet — switch to Colony tool and click anywhere
              </span>
            ) : colonies.length === 0 ? null : (
              <>
                <div style={{ fontSize: "0.6rem", fontWeight: 700, color: "#6b5040", letterSpacing: "0.08em", padding: "2px 4px 0" }}>
                  ACTIVE
                </div>
                {colonies.map(col => {
                  const color = COLONY_COLORS[col.params.colorIdx % COLONY_COLORS.length].primary;
                  const lb = leaderboard.find(e => e.alive && e.name === col.params.name);
                  return (
                    <button key={col.id} onClick={() => { onGoTo(col.nestX, col.nestY); setOpen(false); }} style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "7px 8px",
                      borderRadius: 8, border: "none", background: "#1a1208", cursor: "pointer",
                      textAlign: "left",
                    }}>
                      <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
                        <div style={{
                          position: "absolute", inset: 0, borderRadius: "50%",
                          background: color, opacity: 0.4,
                          animation: "pulse 1.5s ease-in-out infinite",
                        }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#e5d5b5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {col.params.name}
                        </div>
                        <div style={{ fontSize: "0.62rem", color: "#6b5040" }}>
                          {col.params.numAnts} ants · 🍎 {col.foodCollected}
                          {lb ? ` · ${formatLifespan(lb.lifespanTicks)}` : ""}
                        </div>
                      </div>
                      <span style={{ fontSize: "0.65rem", color: "#6b5040" }}>→</span>
                    </button>
                  );
                })}
              </>
            )}

            {deadEntries.length > 0 && (
              <>
                {colonies.length > 0 && (
                  <div style={{ height: 1, background: "#1a1208", margin: "4px 0" }} />
                )}
                <div style={{ fontSize: "0.6rem", fontWeight: 700, color: "#6b5040", letterSpacing: "0.08em", padding: "2px 4px 0" }}>
                  🏆 PAST COLONIES
                </div>
                {deadEntries.map((entry, i) => (
                  <div key={`${entry.name}-${i}`} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "7px 8px",
                    borderRadius: 8, background: "#110d07",
                  }}>
                    <span style={{ fontSize: "0.65rem", color: "#4b5563", width: 16, textAlign: "right", flexShrink: 0 }}>
                      {i + 1}
                    </span>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#374151", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.73rem", fontWeight: 600, color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.name}
                      </div>
                      <div style={{ fontSize: "0.62rem", color: "#4b5563" }}>
                        💀 {formatLifespan(entry.lifespanTicks)}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <button onClick={onCenter} title="Re-center view" style={{
        padding: "6px 10px", borderRadius: 8, border: "none", cursor: "pointer",
        background: "transparent", color: "#a08060", fontSize: "1rem",
      }}>⊹</button>
    </div>
  );
}

// ─── Colony dialog ────────────────────────────────────────────────────────────
const DEFAULT_PARAMS: ColonyParams = {
  numAnts: 20, evapRate: 0.005, trailPower: 5, tankMax: 6400,
  cautionary: false, colorIdx: 0, name: "Colony",
};

function Row({ label, value, min, max, step, fmt, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  fmt?: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.72rem", color: "#a08060" }}>{label}</span>
        <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#f59e0b" }}>
          {fmt ? fmt(value) : value}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#f59e0b" }} />
    </div>
  );
}

function ColonyDialog({ onClose, onConfirm, surviveMode }: {
  onClose: () => void; onConfirm: (p: ColonyParams) => void; surviveMode?: boolean;
}) {
  const [p, setP] = useState<ColonyParams>({ ...DEFAULT_PARAMS });
  const set = <K extends keyof ColonyParams>(k: K, v: ColonyParams[K]) => setP(prev => ({ ...prev, [k]: v }));
  return (
    <Overlay onClose={onClose}>
      <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#e5d5b5" }}>
        {surviveMode ? "🎯 Name Your Colony" : "Place Colony 🏠"}
      </div>
      {surviveMode && (
        <div style={{ fontSize: "0.72rem", color: "#4b7a5a", lineHeight: 1.5 }}>
          Your colony will try to survive. Configure it, then click Place Colony.
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: "0.72rem", color: "#a08060" }}>Name</label>
        <input value={p.name} onChange={e => set("name", e.target.value)} style={{
          background: "#1a1208", border: "1px solid #3d2e18", borderRadius: 6,
          color: "#e5d5b5", padding: "6px 10px", fontSize: "0.8rem",
        }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Row label="Ants" value={p.numAnts} min={1} max={200} step={1} onChange={v => set("numAnts", v)} />
        <Row label="Evaporation rate" value={p.evapRate} min={0.001} max={0.03} step={0.001}
          fmt={v => v.toFixed(3)} onChange={v => set("evapRate", v)} />
        <Row label="Trail power" value={p.trailPower} min={1} max={15} step={0.5}
          fmt={v => v.toFixed(1)} onChange={v => set("trailPower", v)} />
        <Row label="Tank max" value={p.tankMax} min={500} max={20000} step={500} onChange={v => set("tankMax", v)} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: "0.72rem", color: "#a08060", flex: 1 }}>Cautionary pheromones</span>
        <button onClick={() => set("cautionary", !p.cautionary)} style={{
          padding: "4px 14px", borderRadius: 6, border: "1px solid #3d2e18", cursor: "pointer",
          background: p.cautionary ? "#7c3aed" : "#1a1208",
          color: p.cautionary ? "#fff" : "#a08060", fontSize: "0.72rem",
        }}>{p.cautionary ? "On" : "Off"}</button>
      </div>
      <Buttons onClose={onClose} onConfirm={() => onConfirm(p)} label="Place Colony" />
    </Overlay>
  );
}

function FoodDialog({ onClose, onConfirm }: {
  onClose: () => void; onConfirm: (units: number) => void;
}) {
  const [units, setUnits] = useState(500);
  return (
    <Overlay onClose={onClose}>
      <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#e5d5b5" }}>Place Food Source 🍎</div>
      <Row label="Food units" value={units} min={50} max={5000} step={50} onChange={setUnits} />
      <Buttons onClose={onClose} onConfirm={() => onConfirm(units)} label="Place" confirmStyle={{ background: "#14532d", color: "#4ade80" }} />
    </Overlay>
  );
}

function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#0f0a04", border: "1px solid #3d2e18", borderRadius: 14,
        padding: 20, width: 340, display: "flex", flexDirection: "column", gap: 14,
        boxShadow: "0 8px 40px rgba(0,0,0,0.8)",
      }}>
        {children}
      </div>
    </div>
  );
}

function Buttons({ onClose, onConfirm, label, confirmStyle }: {
  onClose: () => void; onConfirm: () => void; label: string;
  confirmStyle?: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
      <button onClick={onClose} style={{
        flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid #3d2e18",
        background: "transparent", color: "#a08060", cursor: "pointer", fontSize: "0.8rem",
      }}>Cancel</button>
      <button onClick={onConfirm} style={{
        flex: 1, padding: "8px 0", borderRadius: 8, border: "none",
        background: "#92400e", color: "#fcd34d", cursor: "pointer",
        fontSize: "0.8rem", fontWeight: 700, ...confirmStyle,
      }}>{label}</button>
    </div>
  );
}

// ─── Death notice toast ───────────────────────────────────────────────────────
function DeathToast({ notice, onDismiss }: { notice: DeathNotice; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div style={{
      position: "fixed", bottom: 48, left: "50%", transform: "translateX(-50%)",
      background: "#0f0a04", border: "1px solid #7f1d1d", borderRadius: 10,
      padding: "10px 18px", zIndex: 200,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      boxShadow: "0 4px 24px rgba(0,0,0,0.8)",
      animation: "fadeIn 0.2s ease",
    }}>
      <div style={{ fontSize: "0.85rem", color: "#fca5a5", fontWeight: 700 }}>
        💀 Colony lost: {notice.name}
      </div>
      <div style={{ fontSize: "0.7rem", color: "#6b5040" }}>
        Survived {formatLifespan(notice.lifespanTicks)}
      </div>
    </div>
  );
}

// ─── Survive name dialog ──────────────────────────────────────────────────────
function SurviveNameDialog({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (name: string, numAnts: number) => void;
}) {
  const [name, setName] = useState("My Colony");
  const [numAnts, setNumAnts] = useState(20);
  return (
    <Overlay onClose={onClose}>
      <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#4ade80" }}>🎯 Survive Mode</div>
      <div style={{ fontSize: "0.72rem", color: "#4b7a5a", lineHeight: 1.6 }}>
        Name your colony and pick a starting population. Then click the map to place your nest — your ants will need food to survive.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: "0.72rem", color: "#a08060" }}>Colony name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
          style={{
            background: "#1a1208", border: "1px solid #3d2e18", borderRadius: 6,
            color: "#e5d5b5", padding: "6px 10px", fontSize: "0.85rem",
          }}
        />
      </div>
      <Row label="Ants" value={numAnts} min={1} max={200} step={1} onChange={setNumAnts} />
      <Buttons
        onClose={onClose}
        onConfirm={() => onConfirm(name.trim() || "Colony", numAnts)}
        label="Choose placement →"
        confirmStyle={{ background: "#14532d", color: "#4ade80" }}
      />
    </Overlay>
  );
}

// ─── Survive placement prompt ─────────────────────────────────────────────────
function SurvivePlacementPrompt({ name }: { name: string }) {
  return (
    <div style={{
      position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
      background: "#0a1f0f", border: "1px solid #166534", borderRadius: 12,
      padding: "14px 24px", zIndex: 150,
      display: "flex", alignItems: "center", gap: 12,
      boxShadow: "0 4px 32px rgba(0,0,0,0.8)",
      animation: "fadeIn 0.3s ease",
      pointerEvents: "none",
    }}>
      <span style={{ fontSize: "1.4rem" }}>🏠</span>
      <div>
        <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#4ade80" }}>
          Click anywhere to place <em style={{ fontStyle: "normal", color: "#86efac" }}>{name}</em>
        </div>
        <div style={{ fontSize: "0.68rem", color: "#4b7a5a", marginTop: 2 }}>
          Choose your spot wisely — your ants need food nearby to survive
        </div>
      </div>
    </div>
  );
}

function useWindowWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const fn = () => setWidth(window.innerWidth);
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return width;
}

// ─── Survive HUD ──────────────────────────────────────────────────────────────
function SurviveHUD({
  colonyName, leaderboard, isDead, antCount, totalFood, colonyColor, timeLivedTicks,
}: {
  colonyName: string;
  leaderboard: LeaderboardEntry[];
  isDead: boolean;
  antCount: number;
  totalFood: number;
  colonyColor: string;
  timeLivedTicks: number;
}) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 640;

  const rank = leaderboard.filter(e => e.lifespanTicks > timeLivedTicks).length + 1;
  const total = leaderboard.length + 1;
  const ticks = timeLivedTicks;
  const accent = isDead ? "#fca5a5" : "#4ade80";
  const borderColor = isDead ? "#7f1d1d" : "#166534";
  const bg = isDead ? "#0f0705" : "#050f07";

  const Dot = () => !isDead ? (
    <div style={{ position: "relative", width: 8, height: 8, flexShrink: 0 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: colonyColor }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: colonyColor, opacity: 0.4, animation: "pulse 1.5s ease-in-out infinite" }} />
    </div>
  ) : null;

  if (isMobile) {
    return (
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: bg, borderTop: `1px solid ${borderColor}`,
        zIndex: 150, padding: "10px 16px",
        display: "flex", flexDirection: "column", gap: 8,
        boxShadow: "0 -4px 24px rgba(0,0,0,0.8)",
      }}>
        {/* Name row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Dot />
            <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#e5d5b5" }}>{colonyName}</span>
          </div>
          <span style={{ fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.1em", color: borderColor }}>
            {isDead ? "💀 COLONY LOST" : "🎯 SURVIVE MODE"}
          </span>
        </div>
        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: "0.52rem", color: "#6b5040", fontWeight: 600, letterSpacing: "0.06em" }}>TIME</span>
            <span style={{ fontSize: "1.1rem", fontWeight: 800, color: accent, lineHeight: 1 }}>{formatLifespan(ticks)}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: "0.52rem", color: "#6b5040", fontWeight: 600, letterSpacing: "0.06em" }}>RANK</span>
            <span style={{ fontSize: "1.1rem", fontWeight: 800, color: "#f59e0b", lineHeight: 1 }}>
              #{rank}<span style={{ fontSize: "0.6rem", color: "#6b5040", fontWeight: 400 }}> /{total}</span>
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: "0.52rem", color: "#6b5040", fontWeight: 600, letterSpacing: "0.06em" }}>ANTS</span>
            <span style={{ fontSize: "1.1rem", fontWeight: 700, color: isDead ? "#6b7280" : "#e5d5b5", lineHeight: 1 }}>{isDead ? "0" : antCount}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: "0.52rem", color: "#6b5040", fontWeight: 600, letterSpacing: "0.06em" }}>FOOD</span>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: "0.75rem" }}>🍎</span>
              <span style={{ fontSize: "0.9rem", fontWeight: 700, color: totalFood > 0 ? "#e5d5b5" : "#4b5563", lineHeight: 1 }}>
                {totalFood >= 1000 ? `${(totalFood / 1000).toFixed(1)}k` : totalFood}
              </span>
            </div>
          </div>
        </div>
        {isDead && (
          <div style={{ fontSize: "0.6rem", color: "#6b5040", textAlign: "center" }}>
            Switch to God Mode to keep playing, or Survive again
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", right: 16, top: "50%", transform: "translateY(-50%)",
      background: bg, border: `1px solid ${borderColor}`,
      borderRadius: 16, padding: "20px 22px", zIndex: 150, width: 192,
      display: "flex", flexDirection: "column", gap: 16,
      boxShadow: "0 8px 40px rgba(0,0,0,0.8)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", color: borderColor }}>
          {isDead ? "💀 COLONY LOST" : "🎯 SURVIVE MODE"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Dot />
          <div style={{
            fontSize: "0.85rem", fontWeight: 700, color: "#e5d5b5",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {colonyName}
          </div>
        </div>
      </div>

      {/* Time lived */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: "0.58rem", color: "#6b5040", letterSpacing: "0.08em", fontWeight: 600 }}>TIME LIVED</div>
        <div style={{ fontSize: "2rem", fontWeight: 800, color: accent, lineHeight: 1 }}>
          {formatLifespan(ticks)}
        </div>
      </div>

      {/* Rank */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: "0.58rem", color: "#6b5040", letterSpacing: "0.08em", fontWeight: 600 }}>LEADERBOARD</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: "1.6rem", fontWeight: 800, color: "#f59e0b", lineHeight: 1 }}>
            #{rank}
          </span>
          {total > 0 && (
            <span style={{ fontSize: "0.7rem", color: "#6b5040" }}>of {total}</span>
          )}
        </div>
      </div>

      {/* Ants remaining */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: "0.58rem", color: "#6b5040", letterSpacing: "0.08em", fontWeight: 600 }}>ANTS REMAINING</div>
        <div style={{ fontSize: "1.4rem", fontWeight: 700, color: isDead ? "#6b7280" : "#e5d5b5", lineHeight: 1 }}>
          {isDead ? "0" : antCount}
        </div>
      </div>

      {/* Food remaining in maze */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: "0.58rem", color: "#6b5040", letterSpacing: "0.08em", fontWeight: 600 }}>FOOD IN MAZE</div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: "0.9rem" }}>🍎</span>
          <span style={{ fontSize: "1.2rem", fontWeight: 700, color: totalFood > 0 ? "#e5d5b5" : "#4b5563", lineHeight: 1 }}>
            {totalFood.toLocaleString()}
          </span>
        </div>
      </div>

    </div>
  );
}

// ─── Survive game over ────────────────────────────────────────────────────────
function SurviveGameOver({
  colonyName, colonyColor, finalTicks, leaderboard, onTryAgain, onGodMode,
}: {
  colonyName: string;
  colonyColor: string;
  finalTicks: number;
  leaderboard: LeaderboardEntry[];
  onTryAgain: () => void;
  onGodMode: () => void;
}) {
  const windowWidth = useWindowWidth();
  const isMobile = windowWidth < 640;

  const sorted = [...leaderboard].sort((a, b) => b.lifespanTicks - a.lifespanTicks);
  const rank = sorted.filter(e => e.lifespanTicks > finalTicks).length + 1;
  const total = sorted.length;
  // Show up to 5 entries, always include ours (inserted at right position)
  const ourEntry = { name: colonyName, lifespanTicks: finalTicks, alive: false };
  const merged = [...sorted];
  const alreadyIn = merged.some(e => e.name === colonyName && Math.abs(e.lifespanTicks - finalTicks) < TICKS_PER_SEC * 5);
  if (!alreadyIn) merged.splice(rank - 1, 0, ourEntry);
  const topN = merged.slice(0, 7);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 300,
      background: "rgba(0,0,0,0.82)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: isMobile ? "16px" : "0",
    }}>
      <div style={{
        background: "#0a0604", border: "1px solid #7f1d1d",
        borderRadius: 20, padding: isMobile ? "24px 20px" : "32px 36px",
        width: isMobile ? "100%" : 340, maxWidth: "100%",
        display: "flex", flexDirection: "column", gap: 24,
        boxShadow: "0 16px 64px rgba(0,0,0,0.9)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
          <div style={{ fontSize: isMobile ? "2.5rem" : "3rem", lineHeight: 1 }}>💀</div>
          <div style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.14em", color: "#7f1d1d" }}>COLONY LOST</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: colonyColor, flexShrink: 0 }} />
            <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "#e5d5b5" }}>{colonyName}</span>
          </div>
        </div>

        {/* Time */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "0.6rem", color: "#6b5040", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 4 }}>SURVIVED</div>
          <div style={{ fontSize: isMobile ? "3rem" : "3.5rem", fontWeight: 900, color: "#fca5a5", lineHeight: 1 }}>
            {formatLifespan(finalTicks)}
          </div>
        </div>

        {/* Rank */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "0.6rem", color: "#6b5040", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 4 }}>
            ALL-TIME RANK
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, justifyContent: "center" }}>
            <span style={{ fontSize: "2.4rem", fontWeight: 900, color: "#f59e0b", lineHeight: 1 }}>#{rank}</span>
            {total > 0 && <span style={{ fontSize: "0.8rem", color: "#6b5040" }}>of {total}</span>}
          </div>
        </div>

        {/* Leaderboard snippet */}
        {topN.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: "0.58rem", color: "#6b5040", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 2 }}>
              LEADERBOARD
            </div>
            {topN.map((entry, i) => {
              const isOurs = entry.name === colonyName && Math.abs(entry.lifespanTicks - finalTicks) < TICKS_PER_SEC * 5;
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "5px 10px",
                  borderRadius: 8, background: isOurs ? "rgba(239,68,68,0.12)" : "transparent",
                  border: isOurs ? "1px solid #7f1d1d" : "1px solid transparent",
                }}>
                  <span style={{ fontSize: "0.7rem", color: "#6b5040", width: 20, textAlign: "right", flexShrink: 0 }}>
                    #{i + 1}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: isOurs ? "#fca5a5" : "#a08060", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.name}
                    {entry.alive && <span style={{ fontSize: "0.6rem", color: "#4ade80", marginLeft: 4 }}>●</span>}
                  </span>
                  <span style={{ fontSize: "0.7rem", fontWeight: 700, color: isOurs ? "#fca5a5" : "#6b5040", flexShrink: 0 }}>
                    {formatLifespan(entry.lifespanTicks)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onGodMode} style={{
            flex: 1, padding: "10px 0", borderRadius: 10, border: "1px solid #3d2e18",
            background: "#1a1208", color: "#a08060", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer",
          }}>
            ⚡ God Mode
          </button>
          <button onClick={onTryAgain} style={{
            flex: 1, padding: "10px 0", borderRadius: 10, border: "1px solid #7f1d1d",
            background: "#1f0a0a", color: "#fca5a5", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer",
          }}>
            🎯 Try Again
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function InfiniteSim() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const worldRef = useRef<WorldState>({
    walls: new Set(), colonies: [], foodSources: [], ants: [], phero: new Map(),
  });
  const panRef = useRef({ x: -400, y: -300 });
  const zoomRef = useRef(1.5);
  const toolRef = useRef<Tool>("pan");
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const wallAction = useRef<"add" | "remove" | null>(null);
  const lastWallCell = useRef<string | null>(null);

  // Survive mode refs (safe inside WS callbacks)
  const modeRef = useRef<AppMode>("god");
  const surviveColonyIdRef = useRef<number | null>(null);
  const placedAtMsRef = useRef<number | null>(null);
  const finalSurviveTicksRef = useRef<number>(0);
  const surviveNameRef = useRef<string>("Colony");
  const surviveNumAntsRef = useRef<number>(20);

  const [connected, setConnected] = useState(false);
  const [tool, setToolState] = useState<Tool>("pan");
  const [colonies, setColonies] = useState<ColonyInfo[]>([]);
  const [colonyDlg, setColonyDlg] = useState<{ x: number; y: number } | null>(null);
  const [foodDlg, setFoodDlg] = useState<{ x: number; y: number } | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [deathNotice, setDeathNotice] = useState<DeathNotice | null>(null);

  // Mode state
  const [mode, setModeState] = useState<AppMode>("god");
  const [surviveNameDlg, setSurviveNameDlg] = useState(false);
  const [surviveColonyId, setSurviveColonyId] = useState<number | null>(null);
  const [surviveColonyName, setSurviveColonyName] = useState<string | null>(null);
  const [surviveColonyColor, setSurviveColonyColor] = useState<string>("#4b9eff");
  const [surviveColonyDied, setSurviveColonyDied] = useState(false);
  const [surviveStats, setSurviveStats] = useState<{ antCount: number; totalFood: number; timeLivedTicks: number }>({ antCount: 0, totalFood: 0, timeLivedTicks: 0 });

  const setTool = useCallback((t: Tool) => {
    toolRef.current = t;
    setToolState(t);
    hoverRef.current = null;
  }, []);

  const setMode = useCallback((m: AppMode) => {
    modeRef.current = m;
    setModeState(m);
    if (m === "survive" && surviveColonyIdRef.current === null) {
      // Show name dialog first; tool stays pan until confirmed
      setSurviveNameDlg(true);
      toolRef.current = "pan";
      setToolState("pan");
      hoverRef.current = null;
    } else {
      // God mode or survive post-placement: pan
      toolRef.current = "pan";
      setToolState("pan");
      hoverRef.current = null;
    }
  }, []);

  // Update survive stats every 500ms from live world state
  useEffect(() => {
    const interval = setInterval(() => {
      const id = surviveColonyIdRef.current;
      if (id === null) return;
      const w = worldRef.current;
      const antCount = w.ants.filter(a => a.cid === id).length;
      const totalFood = w.foodSources.reduce((s, f) => s + f.r, 0);
      const timeLivedTicks = placedAtMsRef.current
        ? Math.round((Date.now() - placedAtMsRef.current) / 1000 * TICKS_PER_SEC)
        : 0;
      setSurviveStats({ antCount, totalFood, timeLivedTicks });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // ── Sync colony state for React UI ─────────────────────────────────────────
  const syncColonies = useCallback(() => {
    setColonies(worldRef.current.colonies.map(c => ({ ...c })));
  }, []);

  // ── Leaderboard fetch ──────────────────────────────────────────────────────
  const fetchLeaderboard = useCallback(() => {
    fetch(infiniteApiUrl("/api/infinite/leaderboard"))
      .then(r => r.json())
      .then((data: LeaderboardEntry[]) => setLeaderboard(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 5000);
    return () => clearInterval(interval);
  }, [fetchLeaderboard]);

  // ── WebSocket ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const url = infiniteWsUrl();
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let stopped = false;
    let attempt = 0;

    function connect() {
      if (stopped) return;
      ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => { attempt = 0; setConnected(true); };
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** attempt++));
      };
      ws.onerror = () => ws.close();
      ws.onmessage = ({ data }) => {
        try { handle(JSON.parse(data as string)); } catch {}
      };
    }

    function handle(msg: Record<string, unknown>) {
      const w = worldRef.current;
      switch (msg["type"] as string) {
        case "init": {
          w.walls = new Set((msg["walls"] as string[]) ?? []);
          w.colonies = (msg["colonies"] as ColonyInfo[]) ?? [];
          w.foodSources = (msg["foodSources"] as { x: number; y: number; remaining: number; total: number }[])
            .map(s => ({ x: s.x, y: s.y, r: s.remaining, t: s.total }));
          w.ants = [];
          w.phero = new Map();
          syncColonies();
          centerOnContent(w.walls, w.colonies);
          break;
        }
        case "tick": {
          w.ants = (msg["ants"] as AntInfo[]) ?? [];
          const fs = msg["foodSources"] as { x: number; y: number; r: number; t: number }[] | undefined;
          if (fs) w.foodSources = fs;
          const fc = msg["fc"] as { id: number; n: number }[] | undefined;
          if (fc) {
            for (const { id, n } of fc) {
              const col = w.colonies.find(c => c.id === id);
              if (col) col.foodCollected = n;
            }
            syncColonies();
          }
          break;
        }
        case "phero": {
          const list = msg["colonies"] as { id: number; chunks: { key: string; home: number[]; food: number[] }[]; cleared?: string[] }[];
          for (const { id, chunks, cleared } of list) {
            let pm = w.phero.get(id);
            if (!pm) { pm = new Map(); w.phero.set(id, pm); }
            for (const { key, home, food } of chunks) pm.set(key, { home, food });
            for (const key of cleared ?? []) pm.delete(key);
          }
          break;
        }
        case "wallUpdate": {
          const x = msg["x"] as number, y = msg["y"] as number, v = msg["v"] as number;
          const key = `${x},${y}`;
          if (v === 1) w.walls.delete(key); else w.walls.add(key);
          break;
        }
        case "foodUpdate": {
          const fs = msg["foodSources"] as { x: number; y: number; remaining: number; total: number }[];
          w.foodSources = fs.map(s => ({ x: s.x, y: s.y, r: s.remaining, t: s.total }));
          break;
        }
        case "colonyAdded": {
          const col = msg["colony"] as ColonyInfo;
          if (!w.colonies.find(c => c.id === col.id)) w.colonies.push(col);
          syncColonies();
          fetchLeaderboard();
          // Capture survive colony on first placement in survive mode
          if (modeRef.current === "survive" && surviveColonyIdRef.current === null) {
            surviveColonyIdRef.current = col.id;
            placedAtMsRef.current = Date.now();
            const colorEntry = COLONY_COLORS[col.params.colorIdx % COLONY_COLORS.length];
            setSurviveColonyId(col.id);
            setSurviveColonyName(col.params.name);
            setSurviveColonyColor(colorEntry.primary);
            setSurviveColonyDied(false);
            // Switch to pan — colony is placed, just observe
            toolRef.current = "pan";
            setToolState("pan");
            hoverRef.current = null;
          }
          break;
        }
        case "colonyRemoved": {
          const id = msg["id"] as number;
          w.colonies = w.colonies.filter(c => c.id !== id);
          w.phero.delete(id);
          syncColonies();
          break;
        }
        case "colonyDied": {
          const id = msg["colonyId"] as number;
          const name = msg["name"] as string;
          const lifespanTicks = msg["lifespanTicks"] as number;
          w.colonies = w.colonies.filter(c => c.id !== id);
          w.phero.delete(id);
          syncColonies();
          setDeathNotice({ name, lifespanTicks });
          fetchLeaderboard();
          if (surviveColonyIdRef.current === id) {
            // Freeze final ticks at death moment; stop the live timer
            finalSurviveTicksRef.current = placedAtMsRef.current
              ? Math.round((Date.now() - placedAtMsRef.current) / 1000 * TICKS_PER_SEC)
              : lifespanTicks;
            placedAtMsRef.current = null;
            setSurviveColonyDied(true);
          }
          break;
        }
      }
    }

    connect();
    return () => { stopped = true; clearTimeout(retry); ws?.close(); };
  }, [syncColonies, fetchLeaderboard]);

  // ── Canvas resize ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = canvas.offsetWidth * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ── Render loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    let raf: number;
    function frame() {
      const canvas = canvasRef.current;
      if (canvas) renderWorld(canvas, worldRef.current, panRef.current, zoomRef.current, toolRef.current, hoverRef.current);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Coordinate helpers ────────────────────────────────────────────────────
  function toCell(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const cx = (e.clientX - rect.left) * devicePixelRatio;
    const cy = (e.clientY - rect.top) * devicePixelRatio;
    return {
      x: Math.floor((cx / zoomRef.current + panRef.current.x) / CELL),
      y: Math.floor((cy / zoomRef.current + panRef.current.y) / CELL),
    };
  }

  function send(msg: object) {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function goTo(nestX: number, nestY: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wpx = nestX * CELL + CELL / 2, wpy = nestY * CELL + CELL / 2;
    panRef.current = { x: wpx - canvas.width / (2 * zoomRef.current), y: wpy - canvas.height / (2 * zoomRef.current) };
  }

  function centerOnContent(walls: Set<string>, cols: ColonyInfo[]) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cx = 0, cy = 0;
    if (walls.size > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const key of walls) {
        const comma = key.indexOf(",");
        const wx = parseInt(key.slice(0, comma));
        const wy = parseInt(key.slice(comma + 1));
        if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
        if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      }
      cx = ((minX + maxX) / 2) * CELL + CELL / 2;
      cy = ((minY + maxY) / 2) * CELL + CELL / 2;
    } else if (cols.length > 0) {
      cx = cols[0].nestX * CELL + CELL / 2;
      cy = cols[0].nestY * CELL + CELL / 2;
    }
    panRef.current = {
      x: cx - canvas.width / (2 * zoomRef.current),
      y: cy - canvas.height / (2 * zoomRef.current),
    };
  }

  function reCenter() {
    centerOnContent(worldRef.current.walls, worldRef.current.colonies);
  }

  // ── Pointer events ────────────────────────────────────────────────────────
  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
    wallAction.current = null;
    lastWallCell.current = null;

    const cell = toCell(e);
    const t = toolRef.current;
    const w = worldRef.current;

    if (t === "wall") {
      const key = `${cell.x},${cell.y}`;
      const isWall = w.walls.has(key);
      wallAction.current = isWall ? "remove" : "add";
      lastWallCell.current = key;
      send({ type: "toggleWall", x: cell.x, y: cell.y });
    } else if (t === "food") {
      setFoodDlg(cell);
      dragging.current = false;
    } else if (t === "colony") {
      if (modeRef.current === "survive" && surviveColonyIdRef.current === null) {
        // Survive mode: place immediately with pre-entered name, no dialog
        const surviveParams = { ...DEFAULT_PARAMS, name: surviveNameRef.current, numAnts: surviveNumAntsRef.current };
        send({ type: "placeColony", x: cell.x, y: cell.y, params: surviveParams });
      } else {
        setColonyDlg(cell);
      }
      dragging.current = false;
    }
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    hoverRef.current = toCell(e);
    if (!dragging.current) return;
    const t = toolRef.current;

    if (t === "pan") {
      const dx = (e.clientX - dragStart.current.x) * devicePixelRatio;
      const dy = (e.clientY - dragStart.current.y) * devicePixelRatio;
      panRef.current = { x: dragStart.current.panX - dx / zoomRef.current, y: dragStart.current.panY - dy / zoomRef.current };
    } else if (t === "wall" && wallAction.current) {
      const cell = toCell(e);
      const key = `${cell.x},${cell.y}`;
      if (key === lastWallCell.current) return;
      lastWallCell.current = key;
      const isWall = worldRef.current.walls.has(key);
      if (wallAction.current === "add" && !isWall) send({ type: "toggleWall", x: cell.x, y: cell.y });
      if (wallAction.current === "remove" && isWall) send({ type: "toggleWall", x: cell.x, y: cell.y });
    }
  }

  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragging.current = false;
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const cx = (e.clientX - rect.left) * devicePixelRatio;
    const cy = (e.clientY - rect.top) * devicePixelRatio;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newZoom = Math.min(8, Math.max(0.15, zoomRef.current * factor));
    const wx = cx / zoomRef.current + panRef.current.x;
    const wy = cy / zoomRef.current + panRef.current.y;
    panRef.current = { x: wx - cx / newZoom, y: wy - cy / newZoom };
    zoomRef.current = newZoom;
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0a0602", overflow: "hidden" }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>

      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => { hoverRef.current = null; }}
        onWheel={onWheel}
      />

      <Toolbar
        tool={tool} setTool={setTool}
        connected={connected} colonies={colonies} leaderboard={leaderboard}
        onGoTo={goTo} onCenter={reCenter}
        mode={mode} setMode={setMode}
        surviveColonyPlaced={surviveColonyId !== null}
      />

      {mode === "survive" && surviveColonyId === null && !surviveNameDlg && (
        <SurvivePlacementPrompt name={surviveNameRef.current} />
      )}

      {mode === "survive" && surviveColonyId !== null && !surviveColonyDied && (
        <SurviveHUD
          colonyName={surviveColonyName ?? ""}
          leaderboard={leaderboard}
          isDead={false}
          antCount={surviveStats.antCount}
          totalFood={surviveStats.totalFood}
          colonyColor={surviveColonyColor}
          timeLivedTicks={surviveStats.timeLivedTicks}
        />
      )}

      {mode === "survive" && surviveColonyDied && (
        <SurviveGameOver
          colonyName={surviveColonyName ?? ""}
          colonyColor={surviveColonyColor}
          finalTicks={finalSurviveTicksRef.current}
          leaderboard={leaderboard}
          onGodMode={() => setMode("god")}
          onTryAgain={() => {
            // Reset all survive state
            surviveColonyIdRef.current = null;
            placedAtMsRef.current = null;
            finalSurviveTicksRef.current = 0;
            setSurviveColonyId(null);
            setSurviveColonyName(null);
            setSurviveColonyDied(false);
            setSurviveStats({ antCount: 0, totalFood: 0, timeLivedTicks: 0 });
            modeRef.current = "survive";
            setModeState("survive");
            // Show name dialog to start fresh
            setSurviveNameDlg(true);
          }}
        />
      )}

      {!connected && (
        <div style={{
          position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
          background: "#0f0a04cc", border: "1px solid #3d2e18", borderRadius: 8,
          padding: "8px 16px", color: "#f87171", fontSize: "0.75rem",
        }}>
          Connecting to simulation server…
        </div>
      )}

      <div style={{
        position: "fixed", bottom: 16, right: 16,
        fontSize: "0.65rem", color: "#3d2e18", pointerEvents: "none",
      }}>
        Scroll to zoom · Drag to pan
      </div>

      {surviveNameDlg && (
        <SurviveNameDialog
          onClose={() => {
            // Cancelled — revert to god mode
            setSurviveNameDlg(false);
            modeRef.current = "god";
            setModeState("god");
          }}
          onConfirm={(name, numAnts) => {
            surviveNameRef.current = name;
            surviveNumAntsRef.current = numAnts;
            setSurviveNameDlg(false);
            // Now enter placement mode: auto-select colony tool
            toolRef.current = "colony";
            setToolState("colony");
            hoverRef.current = null;
          }}
        />
      )}

      {colonyDlg && (
        <ColonyDialog
          onClose={() => setColonyDlg(null)}
          onConfirm={(params) => {
            if (colonyDlg) send({ type: "placeColony", x: colonyDlg.x, y: colonyDlg.y, params });
            setColonyDlg(null);
          }}
        />
      )}

      {foodDlg && (
        <FoodDialog
          onClose={() => setFoodDlg(null)}
          onConfirm={(units) => {
            if (foodDlg) send({ type: "placeFood", x: foodDlg.x, y: foodDlg.y, units });
            setFoodDlg(null);
          }}
        />
      )}

      {deathNotice && (
        <DeathToast notice={deathNotice} onDismiss={() => setDeathNotice(null)} />
      )}
    </div>
  );
}
