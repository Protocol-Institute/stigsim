import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CELL,
  COLS,
  DEFAULT_PARAMS,
  DEPOSIT_RATE,
  H,
  ROWS,
  W,
  V,
  generateMasterSeed,
  type SimParams,
} from "@stigsim/sim-core";
import { COLONY_COLORS } from "../../render";
import { appHref } from "../../routes";
import { WAR_RULES } from "./war-simulation";
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
  const previousAnts = new Map(previousSnapshot?.colonies.flatMap(colony => colony.ants.map(ant => [`${colony.id}:${ant.key}`, ant] as const)) ?? []);
  for (const colony of snapshot.colonies) {
    for (const ant of colony.ants) {
      const previous = previousAnts.get(`${colony.id}:${ant.key}`);
      const x = previous ? previous.x + (ant.x - previous.x) * interpolation : ant.x;
      const y = previous ? previous.y + (ant.y - previous.y) * interpolation : ant.y;
      const energyFraction = Math.max(0, Math.min(1, ant.energy / 1_600));
      const radius = ant.hasFood ? 4.5 : 3.5;
      ctx.globalAlpha = 0.3 + 0.7 * energyFraction;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = ant.hasFood ? "#facc15" : COLONY_COLORS[colony.id].primary;
      ctx.fill();
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

function ColonyPanel({ colonyId, name, metrics, doctrine, editable, status, onClaim, onChange }: {
  colonyId: number;
  name: string | null;
  metrics: WarMetricsWire;
  doctrine: SimParams;
  editable: boolean;
  status: string;
  onClaim?: () => void;
  onChange: <K extends keyof SimParams>(key: K, value: SimParams[K]) => void;
}) {
  const color = COLONY_COLORS[colonyId].primary;
  const tankCells = Math.round(doctrine.tankMax / (DEPOSIT_RATE * (CELL / V)));
  const controls = [
    ["evapRate", "Evaporation rate", 0.001, 0.02, 0.001, `${Math.round(doctrine.evapRate * 1_000)}‰ / step`],
    ["trailPower", "Trail bias", 1, 10, 0.5, `power ${doctrine.trailPower}`],
    ["tankMax", "Gland size", 1_600, 16_000, 800, `~${tankCells} cells`],
  ] as const;
  return <aside className="war-colony" style={{ "--colony-color": color } as React.CSSProperties}>
    <div className="war-colony__name"><span />{name ?? `Colony ${colonyId + 1}`}{editable ? " · You" : ""}<em>{status}</em></div>
    {onClaim && <button className="war-button online-war-claim" onClick={onClaim}>Join Colony {colonyId + 1}</button>}
    <div className="war-colony__hero"><span>Total ants</span><strong>{metrics.population}</strong></div>
    <div className="war-metrics">
      {[["Reserve", Math.floor(metrics.reserve)], ["Food total", metrics.foodCollected], ["Hatching", metrics.hatching], ["Searching", metrics.searching], ["Carrying", metrics.carrying], ["Retreating", metrics.retreating], ["Waiting", metrics.waiting], ["Low energy", metrics.lowEnergy], ["Born", metrics.births], ["Died", metrics.deaths]].map(([label, value]) =>
        <div className="war-metric" key={label}><span>{label}</span><strong className={["Retreating", "Waiting", "Low energy", "Died"].includes(String(label)) && Number(value) > 0 ? "war-metric--warning" : ""}>{value}</strong></div>)}
    </div>
    <div className="war-doctrine">
      {controls.map(([key, label, min, max, step, value]) => <label key={key}>
        <span><b>{label}</b><strong>{value}</strong></span>
        <input disabled={!editable} type="range" min={min} max={max} step={step} value={doctrine[key] as number}
          onChange={event => onChange(key, Number(event.target.value))} />
      </label>)}
      <div className="war-toggle"><b>Cautionary</b><div>{([false, true] as const).map(value =>
        <button disabled={!editable} className={doctrine.cautionary === value ? "is-active" : ""} key={String(value)} onClick={() => onChange("cautionary", value)}>{value ? "On" : "Off"}</button>)}</div></div>
    </div>
    {metrics.doctrineChanged && <p className="war-adoption"><strong>{metrics.doctrineAdopted}/{metrics.population} ants updated.</strong>{" "}Changes are adopted when each ant returns to this colony’s nest.</p>}
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

function MatchRow({ match, mode, ownRoom, onJoin }: { match: WarMatchSummary; mode: "waiting" | "running"; ownRoom: boolean; onJoin: (spectate: boolean) => void }) {
  const waitingAction = ownRoom ? "Enter your game" : !match.playerNames[1] ? "Join and take Colony 2" : "View waiting room";
  return <article className="mp-match-row">
    <div className={`mp-row-mode ${mode === "running" ? "live" : ""}`}><span>{mode === "running" ? "●" : "🐜"}</span><strong>{match.id}</strong><small>{mode === "running" ? "Live now" : "War match"}</small></div>
    <div className="mp-row-players"><div><i className="blue" /><strong>{match.playerNames[0] ?? "Open colony"}</strong></div><div><i className="red" /><strong className={match.playerNames[1] ? "" : "is-open"}>{match.playerNames[1] ?? "Open colony"}</strong></div></div>
    <div className="mp-row-stat"><small>Ants</small><strong>{match.settings.startingAnts}</strong><span>per colony</span></div>
    <div className="mp-row-stat"><small>Food</small><strong>{match.settings.foodSources}</strong><span>{match.settings.foodPerSource}/source</span></div>
    <div className="mp-row-stat"><small>Speed</small><strong>{match.settings.stepsPerSecond}</strong><span>steps/sec</span></div>
    <div className="mp-row-stat"><small>Maze</small><strong>{Math.round(match.settings.loopRate * 100)}%</strong><span>loops</span></div>
    <button className={`mp-row-action ${mode === "running" ? "watch" : "join"}`} onClick={() => onJoin(mode === "running" || Boolean(match.playerNames[1]) && !ownRoom)}>{mode === "running" ? "Watch game" : waitingAction}</button>
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
    <div className="mp-row-result"><small>Result</small><strong>{result}</strong><button className="mp-review-action" disabled>Review · Coming soon</button></div>
  </article>;
}

export default function OnlineWarMode() {
  const socketRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  const [connected, setConnected] = useState([false, false]);
  const [ready, setReady] = useState([false, false]);
  const [names, setNames] = useState<Array<string | null>>([null, null]);
  const [settings, setSettings] = useState<OnlineWarSettings>(() => ({ ...DEFAULT_ONLINE_WAR_SETTINGS, masterSeed: generateMasterSeed() }));
  const [setupMode, setSetupMode] = useState<"human" | "random" | null>(null);
  const [error, setError] = useState("");
  const [shareCopied, setShareCopied] = useState(false);

  const send = useCallback((message: WarClientMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
  }, []);

  const join = useCallback((id: string, name = playerName, spectate = false) => {
    const normalized = id.trim().toUpperCase();
    if (!normalized || !name.trim()) return;
    send({ type: "join-room", matchId: normalized, playerName: name.trim(), reconnectToken: spectate ? undefined : sessionStorage.getItem(tokenKey(normalized)) ?? undefined });
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
        const reconnectToken = room ? sessionStorage.getItem(tokenKey(room)) : null;
        if (room && savedName && reconnectToken) socket.send(JSON.stringify({ type: "join-room", matchId: room, playerName: savedName, reconnectToken } satisfies WarClientMessage));
      };
      socket.onmessage = event => {
        const message = JSON.parse(event.data) as WarServerMessage;
        if (message.type === "lobby-state") { setMatches(message.matches); setMatchHistory(message.history); }
        else if (message.type === "room-created") {
          sessionStorage.setItem(tokenKey(message.matchId), message.reconnectToken);
          setError("");
        } else if (message.type === "joined") {
          setMatchId(message.matchId);
          setColonyId(message.colonyId);
          if (message.reconnectToken) sessionStorage.setItem(tokenKey(message.matchId), message.reconnectToken);
          history.replaceState(null, "", appHref(`/multiplayer?match=${message.matchId}`, import.meta.env.BASE_URL));
          setError("");
        } else if (message.type === "player-state") {
          setConnected(message.connected); setReady(message.ready); setNames(message.names);
        } else if (message.type === "snapshot") {
          renderSnapshotsRef.current.previous = renderSnapshotsRef.current.current;
          renderSnapshotsRef.current.current = { snapshot: message.snapshot, receivedAt: performance.now() };
          setSnapshot(message.snapshot);
        }
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

  const doctrine = (id: number) => snapshot?.colonies[id]?.doctrine ?? DEFAULT_PARAMS;
  const changeDoctrine = <K extends keyof SimParams>(id: number, key: K, value: SimParams[K]) => {
    if (id !== colonyId || !snapshot) return;
    const nextDoctrine = { ...doctrine(id), [key]: value };
    setSnapshot({ ...snapshot, colonies: snapshot.colonies.map(colony => colony.id === id ? { ...colony, doctrine: nextDoctrine } : colony) });
    send({ type: "set-doctrine", doctrine: nextDoctrine });
  };
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
      <div className="mp-directory-actions"><div className="mp-saved-identity"><span>Playing as</span><strong>{playerName}</strong><button onClick={() => { localStorage.removeItem("stigsim-player-name"); setPlayerName(""); setNameConfirmed(false); }}>Change</button></div><button disabled={connection !== "Connected"} className="mp-create-room" onClick={() => setSetupMode("human")}>New game</button><button disabled={connection !== "Connected"} className="mp-random-room" onClick={() => setSetupMode("random")}>Play against random</button></div></header>
    {error && <div className="online-war-error">{error}</div>}
    {initialInvite && <section className="mp-invite-join"><span>Invitation to room <strong>{initialInvite}</strong></span><button onClick={() => join(initialInvite)}>Join room</button></section>}
    <div className="mp-directory-sections">
      <section className="mp-directory-section mp-waiting-section"><div className="mp-section-title"><div><span>1</span><h2>Waiting for opponent</h2><p>Take the open colony and start a match.</p></div><strong>{waitingMatches.length}</strong></div><div className="mp-match-rows">{waitingMatches.length ? waitingMatches.map(match => <MatchRow key={match.id} match={match} mode="waiting" ownRoom={Boolean(sessionStorage.getItem(tokenKey(match.id)))} onJoin={spectate => join(match.id, playerName, spectate)} />) : <div className="mp-section-empty">No one is waiting yet. Start a new game above.</div>}</div></section>
      <section className="mp-directory-section mp-active-section"><div className="mp-section-title"><div><span>2</span><h2>Active games</h2><p>Drop into a live match as a spectator.</p></div><strong>{runningMatches.length}</strong></div><div className="mp-match-rows">{runningMatches.length ? runningMatches.map(match => <MatchRow key={match.id} match={match} mode="running" ownRoom={Boolean(sessionStorage.getItem(tokenKey(match.id)))} onJoin={spectate => join(match.id, playerName, spectate)} />) : <div className="mp-section-empty">No matches are live right now.</div>}</div></section>
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
  const playerStatus = (id: number) => !connected[id] ? "Open seat" : snapshot?.phase === "waiting" ? ready[id] ? "Ready" : "Connected" : "Connected";
  const opponentId = colonyId === 0 ? 1 : 0;
  const waitingTitle = !connected.every(Boolean) ? "Waiting for an opponent" : colonyId === null ? "Waiting for players" : ready[colonyId] ? "You’re ready" : "Ready to begin?";
  const waitingMessage = !connected.every(Boolean) ? "Share this room so another player can claim the open colony." : colonyId === null ? "Both players must ready up before the match begins." : ready[colonyId] ? `Waiting for ${names[opponentId] ?? "your opponent"} to ready up.` : "Review your doctrine, then signal that you’re ready to start.";
  return <main className="war-page online-war-match">
    <header className="war-header online-war-room-header"><div><nav className="online-war-breadcrumb" aria-label="Breadcrumb"><a href={appHref("/multiplayer", import.meta.env.BASE_URL)}>Match rooms</a><span aria-hidden="true">›</span><strong>Room {matchId}</strong></nav><h1 className="visually-hidden">Online War Mode — Room {matchId}</h1></div><div className="war-header__actions">
      <span className="online-war-identity">Playing as <strong>{playerName}</strong></span>
      <span className={`online-war-status online-war-status--${matchStatus.toLowerCase()}`}>{matchStatus}</span>
      <button className="war-button" onClick={() => void shareInvite()}>{shareCopied ? "Link copied" : "Share"}</button>
    </div></header>
    {error && <div className="online-war-error">{error}</div>}
    {snapshot && <section className="war-matchbar" aria-label="Locked match settings"><div className="war-matchbar__group"><strong>Match settings</strong><div className="war-matchbar__summary"><span>{snapshot.settings.startingAnts} ants / colony</span><span>{snapshot.settings.foodSources} food {snapshot.settings.foodSources === 1 ? "source" : "sources"}</span><span>{snapshot.settings.foodPerSource} food / source</span><span>{Math.round(snapshot.settings.loopRate * 100)}% maze loops</span><span className="war-matchbar__seed" title={snapshot.settings.masterSeed}>Seed: {snapshot.settings.masterSeed}</span></div></div><div className="war-matchbar__group war-matchbar__group--controls"><strong>Simulation</strong><div className="war-matchbar__summary"><span>{snapshot.settings.stepsPerSecond} steps / sec</span></div></div></section>}
    <section className="war-arena">
      <ColonyPanel colonyId={0} name={names[0]} metrics={snapshot?.colonies[0]?.metrics ?? EMPTY_METRICS} doctrine={doctrine(0)} editable={colonyId === 0} status={playerStatus(0)} onClaim={colonyId === null && !connected[0] ? () => send({ type: "claim-seat", colonyId: 0 }) : undefined} onChange={(key, value) => changeDoctrine(0, key, value)} />
      <div className="war-maze online-war-maze"><canvas ref={canvasRef} width={W} height={H} />
        {snapshot?.phase === "waiting" && <div className="online-war-overlay"><span>Room {matchId}</span><h2>{waitingTitle}</h2><p>{waitingMessage}</p><div>{!connected.every(Boolean) && <button className="war-button" onClick={() => void shareInvite()}>{shareCopied ? "Link copied" : "Share invite"}</button>}{colonyId !== null && connected.every(Boolean) && <button className="war-button war-button--primary" disabled={ready[colonyId]} onClick={() => send({ type: "ready" })}>{ready[colonyId] ? "Ready — waiting" : "Ready up"}</button>}</div></div>}
        {snapshot?.phase === "finished" && <div className="online-war-overlay online-war-overlay--result"><span>Match complete</span><h2>{status}</h2><p>The match has ended. Replay these conditions or return to the match rooms.</p><div>{colonyId !== null && <button className="war-button war-button--primary" onClick={() => send({ type: "reset" })}>Rematch same seed</button>}<a className="war-button" href={appHref("/multiplayer", import.meta.env.BASE_URL)}>Match rooms</a></div></div>}
        <div className="war-maze__legend"><span>Blue: Colony 1</span><span>Yellow: carrying food</span><span>Red ring: low energy</span><span>Red: Colony 2</span></div></div>
      <ColonyPanel colonyId={1} name={names[1]} metrics={snapshot?.colonies[1]?.metrics ?? EMPTY_METRICS} doctrine={doctrine(1)} editable={colonyId === 1} status={playerStatus(1)} onClaim={colonyId === null && !connected[1] ? () => send({ type: "claim-seat", colonyId: 1 }) : undefined} onChange={(key, value) => changeDoctrine(1, key, value)} />
    </section>
    <p className="war-rules-note">Ants retreat below {Math.round(WAR_RULES.retreatEnergy / WAR_RULES.maxEnergy * 100)}% energy, refuel from their colony reserve, and new ants hatch when the colony can afford them.</p>
  </main>;
}
