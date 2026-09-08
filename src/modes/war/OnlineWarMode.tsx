import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CELL,
  COLS,
  DEFAULT_PARAMS,
  H,
  ROWS,
  W,
  generateMasterSeed,
  type SimParams,
} from "@stigsim/sim-core";
import { COLONY_COLORS } from "../../render";
import { appHref } from "../../routes";
import {
  DEFAULT_ONLINE_WAR_SETTINGS,
  type OnlineWarSettings,
  type WarClientMessage,
  type WarMatchSummary,
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

function warSocketUrl(): string {
  const configured = (import.meta.env.VITE_INFINITE_SERVER_URL ?? "").replace(/\/$/, "");
  const base = configured || window.location.origin;
  const url = new URL("/api/war/ws", base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (!configured && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) url.port = "3001";
  return url.toString();
}

function drawSnapshot(canvas: HTMLCanvasElement, snapshot: WarSnapshot): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const maxHome = snapshot.colonies.map(colony => Math.max(1, ...colony.homePhero));
  const maxFood = snapshot.colonies.map(colony => Math.max(1, ...colony.foodPhero));
  const maxCaution = snapshot.colonies.map(colony => Math.max(1, ...colony.cautPhero));

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
        const caution = colony.cautPhero[index];
        if (home > 0.5) {
          ctx.fillStyle = `rgba(${colors.homeRGB},${Math.min(0.55, home / maxHome[colonyIndex] * 0.55)})`;
          ctx.fillRect(px, py, CELL, CELL);
        }
        if (food > 0.5) {
          ctx.fillStyle = `rgba(${colors.foodRGB},${Math.min(0.6, food / maxFood[colonyIndex] * 0.6)})`;
          ctx.fillRect(px, py, CELL, CELL);
        }
        if (colony.doctrine.cautionary && caution > 0.5) {
          ctx.fillStyle = `rgba(220,60,40,${Math.min(0.45, caution / maxCaution[colonyIndex] * 0.45)})`;
          ctx.fillRect(px, py, CELL, CELL);
        }
      });
    }
  }

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
  for (const colony of snapshot.colonies) {
    for (const ant of colony.ants) {
      const energyFraction = Math.max(0, Math.min(1, ant.energy / 1_600));
      const radius = ant.hasFood ? 4.5 : 3.5;
      ctx.globalAlpha = 0.3 + 0.7 * energyFraction;
      ctx.beginPath();
      ctx.arc(ant.x, ant.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = ant.hasFood ? "#facc15" : COLONY_COLORS[colony.id].primary;
      ctx.fill();
      if (energyFraction <= 0.35) {
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(ant.x, ant.y, radius + 2, 0, Math.PI * 2);
        ctx.strokeStyle = "#ef4444";
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
}

function ColonyPanel({ colonyId, name, metrics, doctrine, editable, onChange }: {
  colonyId: number;
  name: string | null;
  metrics: WarMetricsWire;
  doctrine: SimParams;
  editable: boolean;
  onChange: <K extends keyof SimParams>(key: K, value: SimParams[K]) => void;
}) {
  const color = COLONY_COLORS[colonyId].primary;
  const controls = [
    ["evapRate", "Evaporation", 0.001, 0.02, 0.001, `${Math.round(doctrine.evapRate * 1_000)}‰`],
    ["trailPower", "Trail bias", 1, 10, 0.5, `${doctrine.trailPower}`],
    ["tankMax", "Gland", 1_600, 16_000, 800, `${doctrine.tankMax}`],
  ] as const;
  return <aside className="online-war-colony" style={{ "--colony-color": color } as React.CSSProperties}>
    <div className="online-war-colony__name"><span />{name ?? `Colony ${colonyId + 1}`}{editable ? " · You" : ""}</div>
    <div className="online-war-colony__population"><span>Total ants</span><strong>{metrics.population}</strong></div>
    <div className="online-war-colony__metrics">
      {[["Reserve", Math.floor(metrics.reserve)], ["Food", metrics.foodCollected], ["Hatching", metrics.hatching], ["Retreating", metrics.retreating], ["Waiting", metrics.waiting], ["Died", metrics.deaths]].map(([label, value]) =>
        <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <div className="online-war-colony__controls">
      {controls.map(([key, label, min, max, step, value]) => <label key={key}>
        <span>{label}<strong>{value}</strong></span>
        <input disabled={!editable} type="range" min={min} max={max} step={step} value={doctrine[key] as number}
          onChange={event => onChange(key, Number(event.target.value))} />
      </label>)}
      <div className="online-war-colony__toggle"><span>Cautionary</span>{([false, true] as const).map(value =>
        <button disabled={!editable} className={doctrine.cautionary === value ? "is-active" : ""} key={String(value)} onClick={() => onChange("cautionary", value)}>{value ? "On" : "Off"}</button>)}</div>
    </div>
    {metrics.doctrineChanged && <p>{metrics.doctrineAdopted}/{metrics.population} ants have adopted your changes.</p>}
  </aside>;
}

function SettingsForm({ settings, onChange }: { settings: OnlineWarSettings; onChange: (settings: OnlineWarSettings) => void }) {
  const update = <K extends keyof OnlineWarSettings>(key: K, value: OnlineWarSettings[K]) => onChange({ ...settings, [key]: value });
  return <div className="online-war-settings">
    <label><span>Speed <strong>{settings.stepsPerSecond}/sec</strong></span><input type="range" min="2" max="60" step="1" value={settings.stepsPerSecond} onChange={event => update("stepsPerSecond", Number(event.target.value))} /></label>
    <label><span>Starting ants <strong>{settings.startingAnts}</strong></span><input type="range" min="1" max="100" step="1" value={settings.startingAnts} onChange={event => update("startingAnts", Number(event.target.value))} /></label>
    <label><span>Food sources <strong>{settings.foodSources}</strong></span><input type="range" min="1" max="12" step="1" value={settings.foodSources} onChange={event => update("foodSources", Number(event.target.value))} /></label>
    <label><span>Food/source <strong>{settings.foodPerSource}</strong></span><input type="range" min="50" max="10000" step="50" value={settings.foodPerSource} onChange={event => update("foodPerSource", Number(event.target.value))} /></label>
    <label><span>Maze loops <strong>{Math.round(settings.loopRate * 100)}%</strong></span><input type="range" min="0" max="0.5" step="0.05" value={settings.loopRate} onChange={event => update("loopRate", Number(event.target.value))} /></label>
    <label className="online-war-settings__seed"><span>Seed</span><input value={settings.masterSeed} onChange={event => update("masterSeed", event.target.value)} /></label>
  </div>;
}

export default function OnlineWarMode() {
  const socketRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [initialInvite] = useState(() => new URLSearchParams(location.search).get("match")?.trim().toUpperCase() ?? "");
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("stigsim-player-name") ?? "");
  const [nameConfirmed, setNameConfirmed] = useState(() => Boolean(localStorage.getItem("stigsim-player-name")?.trim()));
  const [connection, setConnection] = useState("Connecting…");
  const [matches, setMatches] = useState<WarMatchSummary[]>([]);
  const [matchId, setMatchId] = useState("");
  const [colonyId, setColonyId] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<WarSnapshot | null>(null);
  const [connected, setConnected] = useState([false, false]);
  const [ready, setReady] = useState([false, false]);
  const [names, setNames] = useState<Array<string | null>>([null, null]);
  const [settings, setSettings] = useState<OnlineWarSettings>(() => ({ ...DEFAULT_ONLINE_WAR_SETTINGS, masterSeed: generateMasterSeed() }));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const send = useCallback((message: WarClientMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
  }, []);

  const join = useCallback((id: string, name = playerName) => {
    const normalized = id.trim().toUpperCase();
    if (!normalized || !name.trim()) return;
    send({ type: "join-room", matchId: normalized, playerName: name.trim(), reconnectToken: sessionStorage.getItem(tokenKey(normalized)) ?? undefined });
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
        if (room && savedName) socket.send(JSON.stringify({ type: "join-room", matchId: room, playerName: savedName, reconnectToken: sessionStorage.getItem(tokenKey(room)) ?? undefined } satisfies WarClientMessage));
      };
      socket.onmessage = event => {
        const message = JSON.parse(event.data) as WarServerMessage;
        if (message.type === "lobby-state") setMatches(message.matches);
        else if (message.type === "joined") {
          setMatchId(message.matchId);
          setColonyId(message.colonyId);
          if (message.reconnectToken) sessionStorage.setItem(tokenKey(message.matchId), message.reconnectToken);
          history.replaceState(null, "", appHref(`/multiplayer?match=${message.matchId}`, import.meta.env.BASE_URL));
          setError("");
        } else if (message.type === "player-state") {
          setConnected(message.connected); setReady(message.ready); setNames(message.names);
        } else if (message.type === "snapshot") setSnapshot(message.snapshot);
        else if (message.type === "error") setError(message.message);
      };
      socket.onerror = () => setConnection("Server unavailable");
      socket.onclose = () => {
        if (stopped) return;
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
    if (canvasRef.current && snapshot) drawSnapshot(canvasRef.current, snapshot);
  }, [snapshot]);

  const doctrine = (id: number) => snapshot?.colonies[id]?.doctrine ?? DEFAULT_PARAMS;
  const changeDoctrine = <K extends keyof SimParams>(id: number, key: K, value: SimParams[K]) => {
    if (id !== colonyId) return;
    send({ type: "set-doctrine", doctrine: { ...doctrine(id), [key]: value } });
  };
  const waitingMatches = useMemo(() => matches.filter(match => match.phase === "waiting"), [matches]);
  const runningMatches = useMemo(() => matches.filter(match => match.phase === "running"), [matches]);

  if (!nameConfirmed) return <main className="online-war-name">
    <form onSubmit={event => { event.preventDefault(); const name = playerName.trim(); if (!name) return; localStorage.setItem("stigsim-player-name", name); setPlayerName(name); setNameConfirmed(true); if (initialInvite) join(initialInvite, name); }}>
      <span>🐜</span><h1>Choose your player name</h1><p>Your name identifies your colony during the workshop.</p>
      <input autoFocus maxLength={24} value={playerName} onChange={event => setPlayerName(event.target.value)} placeholder="Player name" />
      <button disabled={!playerName.trim()}>Enter Online War</button>
    </form>
  </main>;

  if (!matchId) return <main className="online-war-lobby">
    <header><div><p>Online · Multiplayer</p><h1>War Mode</h1><span>Create a match, join an open colony, or watch one already running.</span></div><div><strong>{playerName}</strong><small>{connection}</small></div></header>
    {error && <div className="online-war-error">{error}</div>}
    {initialInvite && <section className="online-war-invite"><span>Invitation to room <strong>{initialInvite}</strong></span><button onClick={() => join(initialInvite)}>Join room</button></section>}
    <section className="online-war-create">
      <div><h2>Start a match</h2><p>Settings lock when the room is created.</p></div>
      <button onClick={() => setCreating(value => !value)}>{creating ? "Close setup" : "Configure match"}</button>
      {creating && <><SettingsForm settings={settings} onChange={setSettings} /><div className="online-war-create__actions"><button onClick={() => send({ type: "create-room", playerName, settings })}>Create human match</button><button onClick={() => send({ type: "create-room", playerName, settings, randomOpponent: true })}>Play random colony</button></div></>}
    </section>
    <section className="online-war-directory"><div><h2>Waiting for an opponent</h2>{waitingMatches.length === 0 ? <p>No open matches yet.</p> : waitingMatches.map(match => <article key={match.id}><strong>{match.id}</strong><span>{match.playerNames.filter(Boolean).join(" vs ") || "Open room"}</span><small>{match.settings.startingAnts} ants · {match.settings.stepsPerSecond}/sec</small><button onClick={() => join(match.id)}>Join</button></article>)}</div>
      <div><h2>Live matches</h2>{runningMatches.length === 0 ? <p>No live matches yet.</p> : runningMatches.map(match => <article key={match.id}><strong>{match.id}</strong><span>{match.playerNames.filter(Boolean).join(" vs ")}</span><small>Live · {match.settings.stepsPerSecond}/sec</small><button onClick={() => join(match.id)}>Watch</button></article>)}</div></section>
  </main>;

  const inviteUrl = new URL(appHref(`/multiplayer?match=${matchId}`, import.meta.env.BASE_URL), location.origin).toString();
  const status = snapshot?.phase === "finished" ? snapshot.winner === "draw" ? "Draw" : `${names[Number(snapshot.winner)] ?? `Colony ${Number(snapshot.winner) + 1}`} wins`
    : snapshot?.phase === "running" ? "Match running" : connected.every(Boolean) ? "Both players connected" : "Waiting for opponent";
  return <main className="online-war-match">
    <header><div><a href={appHref("/multiplayer", import.meta.env.BASE_URL)}>← Match rooms</a><p>Room {matchId}</p><h1>{status}</h1><span>{connection}</span></div>
      {colonyId !== null && snapshot?.phase === "waiting" && <button disabled={ready[colonyId]} onClick={() => send({ type: "ready" })}>{ready[colonyId] ? "Ready — waiting" : "Ready up"}</button>}
      {colonyId !== null && snapshot?.phase === "finished" && <button onClick={() => send({ type: "reset" })}>Rematch</button>}
    </header>
    <section className="online-war-invite"><input readOnly value={inviteUrl} /><button onClick={() => void navigator.clipboard.writeText(inviteUrl)}>Copy invite</button></section>
    {error && <div className="online-war-error">{error}</div>}
    <section className="online-war-players">{[0, 1].map(id => <div key={id} style={{ color: COLONY_COLORS[id].primary }}><strong>{names[id] ?? `Colony ${id + 1}`}</strong><span>{connected[id] ? ready[id] || snapshot?.phase !== "waiting" ? "Ready" : "Connected" : "Open seat"}</span>{colonyId === null && !connected[id] && <button onClick={() => send({ type: "claim-seat", colonyId: id })}>Claim seat</button>}</div>)}</section>
    <section className="war-arena online-war-arena">
      <ColonyPanel colonyId={0} name={names[0]} metrics={snapshot?.colonies[0]?.metrics ?? EMPTY_METRICS} doctrine={doctrine(0)} editable={colonyId === 0} onChange={(key, value) => changeDoctrine(0, key, value)} />
      <div className="war-maze"><canvas ref={canvasRef} width={W} height={H} /><div className="war-maze__legend"><span>Blue: Colony 1</span><span>Yellow: carrying food</span><span>Red ring: low energy</span><span>Red: Colony 2</span></div></div>
      <ColonyPanel colonyId={1} name={names[1]} metrics={snapshot?.colonies[1]?.metrics ?? EMPTY_METRICS} doctrine={doctrine(1)} editable={colonyId === 1} onChange={(key, value) => changeDoctrine(1, key, value)} />
    </section>
    {colonyId === null && <p className="online-war-spectator">You’re watching as a spectator.</p>}
  </main>;
}
