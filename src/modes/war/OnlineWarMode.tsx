import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CELL,
  COLS,
  DEFAULT_DOCTRINE,
  DEPOSIT_RATE,
  DEPOSITS_PER_CELL,
  H,
  ROWS,
  W,
  cloneDoctrine,
  generateMasterSeed,
  type Doctrine,
} from "@stigsim/sim-core";
import { COLONY_COLORS } from "../../render";
import { DoctrinePanel as FullDoctrinePanel } from "../../DoctrinePanel";
import { TOPOLOGY_CHOICES, choiceFor, conformDoctrine } from "../../topology-choices";
import { appHref } from "../../routes";
import { WAR_RULES } from "./war-simulation";
import { terminalWarCloseMessage, warCloseAction } from "./online-war-connection";
import { sameWarDoctrine } from "./online-war-doctrine";
import { settingsForOnlineWarSetup } from "./online-war-setup";
import {
  DEFAULT_ONLINE_WAR_SETTINGS,
  type OnlineWarSettings,
  type WarClientMessage,
  type WarMatchSummary,
  type WarMatchRecord,
  type WarMetricsWire,
  type WarServerMessage,
  type WarSnapshot,
} from "../../../shared/war-contract";

const EMPTY_METRICS: WarMetricsWire = {
  population: 0, foodCollected: 0, reserve: 0, hatching: 0,
  searching: 0, carrying: 0, retreating: 0, waiting: 0,
  lowEnergy: 0, births: 0, deaths: 0, doctrineChanged: false, doctrineAdopted: 0,
};

const tokenKey = (matchId: string) => `stigsim-war-token-${matchId}`;

function storedToken(matchId: string): string | null {
  const key = tokenKey(matchId);
  const durableToken = localStorage.getItem(key);
  if (durableToken) return durableToken;
  const legacyToken = sessionStorage.getItem(key);
  if (legacyToken) {
    localStorage.setItem(key, legacyToken);
    sessionStorage.removeItem(key);
  }
  return legacyToken;
}

function storeToken(matchId: string, token: string): void {
  localStorage.setItem(tokenKey(matchId), token);
  sessionStorage.removeItem(tokenKey(matchId));
}

function removeStoredToken(matchId: string): void {
  localStorage.removeItem(tokenKey(matchId));
  sessionStorage.removeItem(tokenKey(matchId));
}

function warSocketUrl(): string {
  const configured = (import.meta.env.VITE_INFINITE_SERVER_URL ?? "").replace(/\/$/, "");
  const base = configured || window.location.origin;
  const url = new URL("/api/war/ws", base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (!configured && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) url.port = "3001";
  return url.toString();
}

function drawSnapshot(canvas: HTMLCanvasElement, snapshot: WarSnapshot, previousSnapshot: WarSnapshot | null = null, interpolation = 1): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const maxHome = snapshot.colonies.map(colony => Math.max(1, ...colony.homePhero));
  const maxFood = snapshot.colonies.map(colony => Math.max(1, ...colony.foodPhero));

  ctx.fillStyle = "#1a1208";
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const px = x * CELL;
      const py = y * CELL;
      if (snapshot.grid[y]?.[x] === 0) {
        ctx.fillStyle = "#0d0a06";
        ctx.fillRect(px, py, CELL, CELL);
        continue;
      }
      ctx.fillStyle = "#2a1e0e";
      ctx.fillRect(px, py, CELL, CELL);
      const index = y * COLS + x;
      snapshot.colonies.forEach((colony, colonyIndex) => {
        const colors = COLONY_COLORS[colony.id];
        const home = colony.homePhero[index];
        const food = colony.foodPhero[index];
        if (home > 0.5) {
          ctx.fillStyle = `rgba(${colors.homeRGB},${Math.min(0.55, home / maxHome[colonyIndex] * 0.55)})`;
          ctx.fillRect(px, py, CELL, CELL);
        }
        if (food > 0.5) {
          ctx.fillStyle = `rgba(${colors.foodRGB},${Math.min(0.6, food / maxFood[colonyIndex] * 0.6)})`;
          ctx.fillRect(px, py, CELL, CELL);
        }
      });
    }
  }

  const inset = 4;
  for (const target of snapshot.colonies) {
    for (const received of target.receivedPhero) {
      const color = COLONY_COLORS[received.from].primary;
      for (let index = 0; index < received.food.length; index++) {
        const value = received.food[index] + received.home[index];
        if (value <= 0.5) continue;
        const x = index % COLS;
        const y = Math.floor(index / COLS);
        ctx.globalAlpha = Math.min(0.9, 0.3 + value / 100);
        ctx.fillStyle = color;
        ctx.fillRect(x * CELL + inset, y * CELL + inset, CELL - 2 * inset, CELL - 2 * inset);
      }
    }
  }
  ctx.globalAlpha = 1;

  ctx.font = `${CELL - 4}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const colony of snapshot.colonies) {
    const px = colony.nestX * CELL;
    const py = colony.nestY * CELL;
    ctx.fillStyle = COLONY_COLORS[colony.id].primary;
    ctx.fillRect(px, py, CELL, CELL);
    ctx.fillText("🏠", px + CELL / 2, py + CELL / 2);
  }
  for (const source of snapshot.foodSources) {
    const px = source.x * CELL;
    const py = source.y * CELL;
    ctx.fillStyle = source.remaining > 0 ? "#16a34a" : "#2a2a2a";
    ctx.fillRect(px, py, CELL, CELL);
    ctx.globalAlpha = source.remaining > 0 ? 1 : 0.35;
    ctx.fillText("🍎", px + CELL / 2, py + CELL / 2);
    ctx.globalAlpha = 1;
  }
  const previousAnts = new Map(previousSnapshot?.colonies.flatMap(colony => colony.ants.map(ant => [`${colony.id}:${ant.id}`, ant] as const)) ?? []);
  for (const colony of snapshot.colonies) {
    for (const ant of colony.ants) {
      const previous = previousAnts.get(`${colony.id}:${ant.id}`);
      const x = previous ? previous.x + (ant.x - previous.x) * interpolation : ant.x;
      const y = previous ? previous.y + (ant.y - previous.y) * interpolation : ant.y;
      const energyFraction = Math.max(0, Math.min(1, ant.energy / WAR_RULES.maxEnergy));
      const radius = ant.hasFood ? 4.5 : 3.5;
      ctx.globalAlpha = 0.3 + 0.7 * energyFraction;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = ant.hasFood ? "#facc15" : COLONY_COLORS[colony.id].primary;
      ctx.fill();
      if (ant.role === "spoiler") {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }
      if (energyFraction <= 0.35) {
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
        ctx.strokeStyle = "#ef4444";
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
}

function ColonyPanel({ colonyId, name, metrics, doctrine, topology, editable, status, onClaim, onStandUp, onCommit }: {
  colonyId: number;
  name: string | null;
  metrics: WarMetricsWire;
  doctrine: Doctrine;
  topology: OnlineWarSettings["topology"];
  editable: boolean;
  status: string;
  onClaim?: () => void;
  onStandUp?: () => void;
  onCommit: (colonyId: number, doctrine: Doctrine) => void;
}) {
  const color = COLONY_COLORS[colonyId].primary;
  const adopted = metrics.population === 0 ? 1 : metrics.doctrineAdopted / metrics.population;
  return <aside className="war-colony" style={{ "--colony-color": color } as React.CSSProperties}>
    <div className="war-colony__name"><span />{name ?? `Colony ${colonyId + 1}`}{editable ? " · You" : ""}<em>{status}</em></div>
    {onClaim && <button className="war-button online-war-claim" onClick={onClaim}>Join Colony {colonyId + 1}</button>}
    {onStandUp && <button className="online-war-stand-up" onClick={onStandUp}>Stand up</button>}
    <div className="war-colony__hero"><span>Total ants</span><strong>{metrics.population}</strong></div>
    <div className="war-metrics">
      {[["Reserve", Math.floor(metrics.reserve)], ["Food total", metrics.foodCollected], ["Hatching", metrics.hatching], ["Searching", metrics.searching], ["Carrying", metrics.carrying], ["Retreating", metrics.retreating], ["Waiting", metrics.waiting], ["Low energy", metrics.lowEnergy], ["Born", metrics.births], ["Died", metrics.deaths]].map(([label, value]) =>
        <div className="war-metric" key={label}><span>{label}</span><strong className={["Retreating", "Waiting", "Low energy", "Died"].includes(String(label)) && Number(value) > 0 ? "war-metric--warning" : ""}>{value}</strong></div>)}
    </div>
    <FullDoctrinePanel numColonies={2} selected={colonyId} onSelect={() => undefined} doctrine={doctrine}
      adopted={adopted} topology={topology} disabled={!editable} onCommit={onCommit} showColonySelector={false} />
    {metrics.doctrineChanged && <p className="war-adoption"><strong>{metrics.doctrineAdopted}/{metrics.population} ants updated.</strong>{" "}Follow and lay behavior updates when each ant returns; colony-level settings apply on the next tick.</p>}
  </aside>;
}

function SettingsForm({ settings, onChange }: { settings: OnlineWarSettings; onChange: (settings: OnlineWarSettings) => void }) {
  const update = <K extends keyof OnlineWarSettings>(key: K, value: OnlineWarSettings[K]) => onChange({ ...settings, [key]: value });
  return <div className="online-war-settings">
    <label><span>Speed <strong>{settings.stepsPerSecond}/sec</strong></span><input type="range" min="2" max="60" step="1" value={settings.stepsPerSecond} onChange={event => update("stepsPerSecond", Number(event.target.value))} /></label>
    <label><span>Starting ants <strong>{settings.startingAnts}</strong></span><input type="range" min="1" max="100" step="1" value={settings.startingAnts} onChange={event => update("startingAnts", Number(event.target.value))} /></label>
    <label><span>Gland size <strong>~{Math.round(settings.tankMax / (DEPOSIT_RATE * DEPOSITS_PER_CELL))} cells</strong></span><input type="range" min="1600" max="16000" step="800" value={settings.tankMax} onChange={event => update("tankMax", Number(event.target.value))} /></label>
    <label><span>Food sources <strong>{settings.foodSources}</strong></span><input type="range" min="1" max="12" step="1" value={settings.foodSources} onChange={event => update("foodSources", Number(event.target.value))} /></label>
    <label><span>Food/source <strong>{settings.foodPerSource}</strong></span><input type="range" min="50" max="10000" step="50" value={settings.foodPerSource} onChange={event => update("foodPerSource", Number(event.target.value))} /></label>
    <label><span>Maze loops <strong>{Math.round(settings.loopRate * 100)}%</strong></span><input type="range" min="0" max="0.5" step="0.05" value={settings.loopRate} onChange={event => update("loopRate", Number(event.target.value))} /></label>
    <div className="war-setting war-setting--topology online-war-settings__topology">
      <span><b>Field topology</b><strong>{choiceFor(settings.topology).label}</strong></span>
      <p>{choiceFor(settings.topology).description}</p>
      <div className="war-topology-options">{TOPOLOGY_CHOICES.map(choice => <button type="button" key={choice.name}
        className={choice.name === choiceFor(settings.topology).name ? "is-active" : ""}
        onClick={() => update("topology", choice.topology)}>{choice.label}</button>)}</div>
    </div>
    <label className="online-war-settings__seed"><span>Seed</span><input value={settings.masterSeed} onChange={event => update("masterSeed", event.target.value)} /></label>
  </div>;
}

function SetupModal({ mode, settings, onChange, onClose, onStart }: {
  mode: "human" | "random";
  settings: OnlineWarSettings;
  onChange: (settings: OnlineWarSettings) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  return <div className="mp-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="mp-setup-modal" role="dialog" aria-modal="true" aria-labelledby="match-setup-title">
      <button className="mp-modal-close" aria-label="Close match setup" onClick={onClose}>×</button>
      <span className="mp-modal-kicker">{mode === "random" ? "Solo match" : "Multiplayer match"}</span>
      <h2 id="match-setup-title">Set up your game</h2>
      <p>{mode === "random" ? "Choose the rules, then play immediately against a colony with a randomized doctrine." : "Choose the rules before opening a seat for your opponent."}</p>
      <SettingsForm settings={settings} onChange={onChange} />
      <div className="mp-modal-actions"><button onClick={onClose}>Cancel</button><button className="primary" onClick={onStart}>{mode === "random" ? "Start against random" : "Create game"}</button></div>
      <small>These settings are locked once the game is created.</small>
    </section>
  </div>;
}

function MatchRow({ match, mode, ownRoom, onJoin }: { match: WarMatchSummary; mode: "waiting" | "running"; ownRoom: boolean; onJoin: () => void }) {
  const action = ownRoom ? "Return to room" : mode === "running" ? "Watch game" : "Enter room";
  return <article className="mp-match-row">
    <div className={`mp-row-mode ${mode === "running" ? "live" : ""}`}><span>{mode === "running" ? "●" : "🐜"}</span><strong>{match.id}</strong><small>{mode === "running" ? "Live now" : "War match"}</small></div>
    <div className="mp-row-players"><div><i className="blue" /><strong className={!match.playerNames[0] ? "is-open" : !match.connected[0] ? "is-disconnected" : ""}>{match.playerNames[0] ?? "Open colony"}</strong>{match.playerNames[0] && !match.connected[0] && <small>Disconnected</small>}</div><div><i className="red" /><strong className={!match.playerNames[1] ? "is-open" : !match.connected[1] ? "is-disconnected" : ""}>{match.playerNames[1] ?? "Open colony"}</strong>{match.playerNames[1] && !match.connected[1] && <small>Disconnected</small>}</div></div>
    <div className="mp-row-stat"><small>Ants</small><strong>{match.settings.startingAnts}</strong><span>per colony</span></div>
    <div className="mp-row-stat"><small>Food</small><strong>{match.settings.foodSources}</strong><span>{match.settings.foodPerSource}/source</span></div>
    <div className="mp-row-stat"><small>Speed</small><strong>{match.settings.stepsPerSecond}</strong><span>steps/sec</span></div>
    <div className="mp-row-stat"><small>Field</small><strong>{choiceFor(match.settings.topology).label}</strong><span>{Math.round(match.settings.loopRate * 100)}% loops · ~{Math.round(match.settings.tankMax / (DEPOSIT_RATE * DEPOSITS_PER_CELL))} gland</span></div>
    <button className={`mp-row-action ${mode === "running" ? "watch" : "join"}`} onClick={onJoin}>{action}</button>
  </article>;
}

function HistoryRow({ record }: { record: WarMatchRecord }) {
  const result = record.winner === "draw" ? "Draw" : `${record.playerNames[record.winner] ?? `Colony ${record.winner + 1}`} won`;
  return <article className="mp-match-row past">
    <div className="mp-row-mode"><span>✓</span><strong>{record.matchId}</strong><small>{new Date(record.completedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></div>
    <div className="mp-row-players"><div><i className="blue" /><strong>{record.playerNames[0] ?? "Colony 1"}</strong><b>{record.winner === 0 ? "1" : "0"}</b></div><div><i className="red" /><strong>{record.playerNames[1] ?? "Colony 2"}</strong><b>{record.winner === 1 ? "1" : "0"}</b></div></div>
    <div className="mp-row-stat"><small>Ants</small><strong>{record.settings.startingAnts}</strong><span>per colony</span></div>
    <div className="mp-row-stat"><small>Food</small><strong>{record.settings.foodSources}</strong><span>{record.settings.foodPerSource}/source</span></div>
    <div className="mp-row-stat"><small>Speed</small><strong>{record.settings.stepsPerSecond}</strong><span>steps/sec</span></div>
    <div className="mp-row-stat"><small>Field</small><strong>{choiceFor(record.settings.topology).label}</strong><span>~{Math.round(record.settings.tankMax / (DEPOSIT_RATE * DEPOSITS_PER_CELL))} gland</span></div>
    <div className="mp-row-result"><small>Result</small><strong>{result}</strong><button className="mp-review-action" disabled>Review · Coming soon</button></div>
  </article>;
}

export default function OnlineWarMode() {
  const socketRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doctrineSendRef = useRef<{ pending: Doctrine | null; timer: ReturnType<typeof setTimeout> | null; lastSentAt: number }>({ pending: null, timer: null, lastSentAt: 0 });
  const pendingDoctrineRef = useRef<{ colonyId: number; doctrine: Doctrine } | null>(null);
  const renderSnapshotsRef = useRef<{ previous: { snapshot: WarSnapshot; receivedAt: number } | null; current: { snapshot: WarSnapshot; receivedAt: number } | null }>({ previous: null, current: null });
  const [initialInvite] = useState(() => new URLSearchParams(location.search).get("match")?.trim().toUpperCase() ?? "");
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("stigsim-player-name") ?? "");
  const [nameConfirmed, setNameConfirmed] = useState(() => Boolean(localStorage.getItem("stigsim-player-name")?.trim()));
  const [connection, setConnection] = useState("Connecting…");
  const [matches, setMatches] = useState<WarMatchSummary[]>([]);
  const [matchHistory, setMatchHistory] = useState<WarMatchRecord[]>([]);
  const [matchId, setMatchId] = useState("");
  const [colonyId, setColonyId] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<WarSnapshot | null>(null);
  const [pendingDoctrine, setPendingDoctrine] = useState<{ colonyId: number; doctrine: Doctrine } | null>(null);
  const [connected, setConnected] = useState([false, false]);
  const [ready, setReady] = useState([false, false]);
  const [names, setNames] = useState<Array<string | null>>([null, null]);
  const [spectators, setSpectators] = useState<string[]>([]);
  const [settings, setSettings] = useState<OnlineWarSettings>(() => ({ ...DEFAULT_ONLINE_WAR_SETTINGS, masterSeed: generateMasterSeed() }));
  const [setupMode, setSetupMode] = useState<"human" | "random" | null>(null);
  const [error, setError] = useState("");
  const [shareCopied, setShareCopied] = useState(false);

  const openSetup = (mode: "human" | "random") => {
    setSettings(current => settingsForOnlineWarSetup(mode, current));
    setSetupMode(mode);
  };

  const send = useCallback((message: WarClientMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
  }, []);

  const join = useCallback((id: string, name = playerName) => {
    const normalized = id.trim().toUpperCase();
    if (!normalized || !name.trim()) return;
    send({ type: "join-room", matchId: normalized, playerName: name.trim(), reconnectToken: storedToken(normalized) ?? undefined });
  }, [playerName, send]);

  useEffect(() => {
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      setConnection("Connecting…");
      const socket = new WebSocket(warSocketUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        setConnection("Connected");
        const room = new URLSearchParams(location.search).get("match")?.trim().toUpperCase();
        const savedName = localStorage.getItem("stigsim-player-name")?.trim();
        const reconnectToken = room ? storedToken(room) : null;
        if (room && savedName) socket.send(JSON.stringify({ type: "join-room", matchId: room, playerName: savedName, reconnectToken: reconnectToken ?? undefined } satisfies WarClientMessage));
      };
      socket.onmessage = event => {
        const message = JSON.parse(event.data) as WarServerMessage;
        if (message.type === "lobby-state") { setMatches(message.matches); setMatchHistory(message.history); }
        else if (message.type === "room-created") {
          storeToken(message.matchId, message.reconnectToken);
          const savedName = localStorage.getItem("stigsim-player-name")?.trim();
          if (savedName) socket.send(JSON.stringify({ type: "join-room", matchId: message.matchId, playerName: savedName, reconnectToken: message.reconnectToken } satisfies WarClientMessage));
          setError("");
        } else if (message.type === "joined") {
          pendingDoctrineRef.current = null;
          setPendingDoctrine(null);
          setMatchId(message.matchId);
          setColonyId(message.colonyId);
          if (message.reconnectToken) storeToken(message.matchId, message.reconnectToken);
          else removeStoredToken(message.matchId);
          history.replaceState(null, "", appHref(`/multiplayer?match=${message.matchId}`, import.meta.env.BASE_URL));
          setError("");
        } else if (message.type === "player-state") {
          setConnected(message.connected); setReady(message.ready); setNames(message.names); setSpectators(message.spectators);
        } else if (message.type === "snapshot") {
          const pending = pendingDoctrineRef.current;
          const serverDoctrine = pending ? message.snapshot.colonies[pending.colonyId]?.doctrine : null;
          if (pending && serverDoctrine && sameWarDoctrine(pending.doctrine, serverDoctrine)) {
            pendingDoctrineRef.current = null;
            setPendingDoctrine(null);
          }
          renderSnapshotsRef.current.previous = renderSnapshotsRef.current.current;
          renderSnapshotsRef.current.current = { snapshot: message.snapshot, receivedAt: performance.now() };
          setSnapshot(message.snapshot);
        }
        else if (message.type === "error") setError(message.message);
      };
      socket.onerror = () => setConnection("Server unavailable");
      socket.onclose = event => {
        if (stopped) return;
        const closeAction = warCloseAction(event.code);
        if (closeAction === "stop") {
          setConnection("Disconnected");
          setError(terminalWarCloseMessage(event.code) ?? "Disconnected");
          return;
        }
        if (closeAction === "return-to-lobby") {
          const room = new URLSearchParams(location.search).get("match")?.trim().toUpperCase();
          if (room) removeStoredToken(room);
          pendingDoctrineRef.current = null;
          renderSnapshotsRef.current = { previous: null, current: null };
          setMatchId("");
          setColonyId(null);
          setSnapshot(null);
          setPendingDoctrine(null);
          setConnected([false, false]);
          setReady([false, false]);
          setNames([null, null]);
          setSpectators([]);
          history.replaceState(null, "", appHref("/multiplayer", import.meta.env.BASE_URL));
          setError("That match is no longer available.");
        }
        setConnection("Reconnecting…");
        reconnectTimer = setTimeout(connect, 1_500);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [initialInvite]);

  useEffect(() => {
    let frame = 0;
    const render = () => {
      const { previous, current } = renderSnapshotsRef.current;
      if (canvasRef.current && current) {
        const interval = previous ? Math.max(1, current.receivedAt - previous.receivedAt) : 100;
        drawSnapshot(canvasRef.current, current.snapshot, previous?.snapshot ?? null, Math.min(1, (performance.now() - current.receivedAt) / interval));
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, []);

  const doctrine = (id: number) => pendingDoctrine?.colonyId === id
    ? pendingDoctrine.doctrine
    : snapshot?.colonies[id]?.doctrine ?? DEFAULT_DOCTRINE;
  const flushDoctrine = () => {
    const queued = doctrineSendRef.current;
    if (queued.timer) clearTimeout(queued.timer);
    queued.timer = null;
    if (!queued.pending) return;
    send({ type: "set-doctrine", doctrine: queued.pending });
    queued.pending = null;
    queued.lastSentAt = performance.now();
  };
  const queueDoctrine = (nextDoctrine: Doctrine) => {
    const queued = doctrineSendRef.current;
    queued.pending = nextDoctrine;
    if (queued.timer) return;
    const remaining = Math.max(0, 100 - (performance.now() - queued.lastSentAt));
    if (remaining === 0) flushDoctrine();
    else queued.timer = setTimeout(flushDoctrine, remaining);
  };
  const changeDoctrine = (id: number, nextValue: Doctrine) => {
    if (id !== colonyId || !snapshot) return;
    const nextDoctrine = conformDoctrine(cloneDoctrine(nextValue), snapshot.settings.topology);
    const pending = { colonyId: id, doctrine: nextDoctrine };
    pendingDoctrineRef.current = pending;
    setPendingDoctrine(pending);
    queueDoctrine(nextDoctrine);
  };
  useEffect(() => () => {
    if (doctrineSendRef.current.timer) clearTimeout(doctrineSendRef.current.timer);
  }, []);
  const waitingMatches = useMemo(() => matches.filter(match => match.phase === "waiting"), [matches]);
  const runningMatches = useMemo(() => matches.filter(match => match.phase === "running"), [matches]);

  if (!nameConfirmed) return <main className="mp-name-gate">
    <form onSubmit={event => { event.preventDefault(); const name = playerName.trim(); if (!name) return; localStorage.setItem("stigsim-player-name", name); setPlayerName(name); setNameConfirmed(true); }}>
      <span className="mp-name-ant">🐜</span><h1>What should we call you?</h1><p>This name will identify your colony in multiplayer games.</p>
      <input aria-label="Your multiplayer name" autoFocus maxLength={24} value={playerName} onChange={event => setPlayerName(event.target.value)} placeholder="Enter your name" />
      <button disabled={!playerName.trim()}>Continue to multiplayer</button>
    </form>
  </main>;

  if (!matchId) return <main className="mp-page mp-room-page"><div className="mp-directory-shell">
    <header className="mp-directory-header"><div><h1>Online War Mode</h1><p>Find a match, watch one in progress, or create a new challenge.</p></div>
      <div className="mp-directory-actions"><div className="mp-saved-identity"><span>Playing as</span><strong>{playerName}</strong><button onClick={() => { localStorage.removeItem("stigsim-player-name"); setPlayerName(""); setNameConfirmed(false); }}>Change</button></div><button disabled={connection !== "Connected"} className="mp-create-room" onClick={() => openSetup("human")}>New game</button><button disabled={connection !== "Connected"} className="mp-random-room" onClick={() => openSetup("random")}>Play against random</button></div></header>
    {error && <div className="online-war-error">{error}</div>}
    {initialInvite && <section className="mp-invite-join"><span>Invitation to room <strong>{initialInvite}</strong></span><button onClick={() => join(initialInvite)}>Join room</button></section>}
    <div className="mp-directory-sections">
      <section className="mp-directory-section mp-waiting-section"><div className="mp-section-title"><div><span>1</span><h2>Waiting for opponent</h2><p>Enter a room, then choose an open colony.</p></div><strong>{waitingMatches.length}</strong></div><div className="mp-match-rows">{waitingMatches.length ? waitingMatches.map(match => <MatchRow key={match.id} match={match} mode="waiting" ownRoom={Boolean(storedToken(match.id))} onJoin={() => join(match.id)} />) : <div className="mp-section-empty">No one is waiting yet. Start a new game above.</div>}</div></section>
      <section className="mp-directory-section mp-active-section"><div className="mp-section-title"><div><span>2</span><h2>Active games</h2><p>Drop into a live match as a spectator.</p></div><strong>{runningMatches.length}</strong></div><div className="mp-match-rows">{runningMatches.length ? runningMatches.map(match => <MatchRow key={match.id} match={match} mode="running" ownRoom={Boolean(storedToken(match.id))} onJoin={() => join(match.id)} />) : <div className="mp-section-empty">No matches are live right now.</div>}</div></section>
      <section className="mp-directory-section"><div className="mp-section-title"><div><span>3</span><h2>Past games</h2><p>Completed results and match configurations.</p></div><strong>{matchHistory.length}</strong></div><div className="mp-match-rows">{matchHistory.length ? matchHistory.map(record => <HistoryRow key={record.recordId} record={record} />) : <div className="mp-section-empty">Completed games will appear here.</div>}</div></section>
    </div><small className="mp-directory-connection">{connection}</small>
    {setupMode && <SetupModal mode={setupMode} settings={settings} onChange={setSettings} onClose={() => setSetupMode(null)} onStart={() => { send({ type: "create-room", playerName, settings, randomOpponent: setupMode === "random" }); setSetupMode(null); }} />}
  </div></main>;

  const inviteUrl = new URL(appHref(`/multiplayer?match=${matchId}`, import.meta.env.BASE_URL), location.origin).toString();
  const status = snapshot?.phase === "finished" ? snapshot.winner === "draw" ? "Draw" : `${names[Number(snapshot.winner)] ?? `Colony ${Number(snapshot.winner) + 1}`} wins`
    : snapshot?.phase === "running" ? "Match running" : connected.every(Boolean) ? "Both players connected" : "Waiting for opponent";
  const shareInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1_800);
    } catch { setError("Could not copy the invite link. Copy it from the browser address bar instead."); }
  };
  const matchStatus = snapshot?.phase === "finished" ? "Finished" : snapshot?.phase === "running" ? "Running" : colonyId !== null && ready[colonyId] ? "Ready" : "Waiting";
  const playerStatus = (id: number) => !connected[id] ? snapshot?.phase === "waiting" && !names[id] ? "Open seat" : "Disconnected" : snapshot?.phase === "waiting" ? ready[id] ? "Ready" : "Connected" : "Connected";
  const opponentId = colonyId === 0 ? 1 : 0;
  const waitingTitle = !connected.every(Boolean) ? "Waiting for an opponent" : colonyId === null ? "Waiting for players" : ready[colonyId] ? "You’re ready" : "Ready to begin?";
  const waitingMessage = !connected.every(Boolean) ? "Share this room so another player can claim the open colony." : colonyId === null ? "Both players must ready up before the match begins." : ready[colonyId] ? `Waiting for ${names[opponentId] ?? "your opponent"} to ready up.` : "Review your doctrine, then signal that you’re ready to start.";
  return <main className="war-page online-war-match">
    <header className="war-header online-war-room-header"><div><nav className="online-war-breadcrumb" aria-label="Breadcrumb"><a href={appHref("/multiplayer", import.meta.env.BASE_URL)}>Match rooms</a><span aria-hidden="true">›</span><strong>Room {matchId}</strong></nav><h1 className="visually-hidden">Online War Mode — Room {matchId}</h1></div><div className="war-header__actions">
      <span className="online-war-identity">Playing as <strong>{playerName}</strong></span>
      <span className="online-war-spectators" title={spectators.length ? `Watching: ${spectators.join(", ")}` : "No spectators"}>{spectators.length} watching</span>
      <span className={`online-war-status online-war-status--${matchStatus.toLowerCase()}`}>{matchStatus}</span>
      <button className="war-button" onClick={() => void shareInvite()}>{shareCopied ? "Link copied" : "Share"}</button>
    </div></header>
    {error && <div className="online-war-error">{error}</div>}
    {snapshot && <section className="war-matchbar" aria-label="Locked match settings"><div className="war-matchbar__group"><strong>Match settings</strong><div className="war-matchbar__summary"><span>{snapshot.settings.startingAnts} ants / colony</span><span>~{Math.round(snapshot.settings.tankMax / (DEPOSIT_RATE * DEPOSITS_PER_CELL))}-cell gland</span><span>{snapshot.settings.foodSources} food {snapshot.settings.foodSources === 1 ? "source" : "sources"}</span><span>{snapshot.settings.foodPerSource} food / source</span><span>{Math.round(snapshot.settings.loopRate * 100)}% maze loops</span><span>{choiceFor(snapshot.settings.topology).label} topology</span><span className="war-matchbar__seed" title={snapshot.settings.masterSeed}>Seed: {snapshot.settings.masterSeed}</span></div></div><div className="war-matchbar__group war-matchbar__group--controls"><strong>Simulation</strong><div className="war-matchbar__summary"><span>{snapshot.settings.stepsPerSecond} steps / sec</span></div></div></section>}
    <section className="war-arena">
      <ColonyPanel colonyId={0} name={names[0]} metrics={snapshot?.colonies[0]?.metrics ?? EMPTY_METRICS} doctrine={doctrine(0)} topology={snapshot?.settings.topology ?? settings.topology} editable={colonyId === 0} status={playerStatus(0)} onClaim={snapshot?.phase === "waiting" && colonyId === null && !connected[0] ? () => send({ type: "claim-seat", colonyId: 0 }) : undefined} onStandUp={snapshot?.phase === "waiting" && colonyId === 0 ? () => send({ type: "stand-up" }) : undefined} onCommit={changeDoctrine} />
      <div className="war-maze online-war-maze"><canvas ref={canvasRef} width={W} height={H} />
        {snapshot?.phase === "waiting" && <div className="online-war-overlay"><span>Room {matchId}</span><h2>{waitingTitle}</h2><p>{waitingMessage}</p><div>{!connected.every(Boolean) && <button className="war-button" onClick={() => void shareInvite()}>{shareCopied ? "Link copied" : "Share invite"}</button>}{colonyId !== null && connected.every(Boolean) && <button className="war-button war-button--primary" disabled={ready[colonyId]} onClick={() => send({ type: "ready" })}>{ready[colonyId] ? "Ready — waiting" : "Ready up"}</button>}</div></div>}
        {snapshot?.phase === "finished" && <div className="online-war-overlay"><span>Match complete</span><h2>{status}</h2><p>The match has ended. Replay these conditions or return to the match rooms.</p><div>{colonyId !== null && <button className="war-button war-button--primary" onClick={() => send({ type: "reset" })}>Rematch same seed</button>}<a className="war-button" href={appHref("/multiplayer", import.meta.env.BASE_URL)}>Match rooms</a></div></div>}
        <div className="war-maze__legend"><span>Blue: Colony 1</span><span>Yellow: carrying food</span><span>White ring: spoiler</span><span>Inset: false-trail provenance</span><span>Red ring: low energy</span><span>Red: Colony 2</span></div></div>
      <ColonyPanel colonyId={1} name={names[1]} metrics={snapshot?.colonies[1]?.metrics ?? EMPTY_METRICS} doctrine={doctrine(1)} topology={snapshot?.settings.topology ?? settings.topology} editable={colonyId === 1} status={playerStatus(1)} onClaim={snapshot?.phase === "waiting" && colonyId === null && !connected[1] ? () => send({ type: "claim-seat", colonyId: 1 }) : undefined} onStandUp={snapshot?.phase === "waiting" && colonyId === 1 ? () => send({ type: "stand-up" }) : undefined} onCommit={changeDoctrine} />
    </section>
  </main>;
}
