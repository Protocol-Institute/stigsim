import { useCallback, useEffect, useRef, useState } from "react";
import { CELL, COLONY_COLORS, COLS, DEFAULT_PARAMS, H, ROWS, W } from "./AntSim";
import type { ColonyMetrics, SimParams } from "./AntSim";
import type { ClientMessage, MatchHistoryRecord, MatchSettings, MatchSnapshot, MatchSummary, ServerMessage } from "./multiplayerProtocol";

const MAX_ENERGY = 1600;
const tokenKey = (matchId: string) => `stigsim-multiplayer-token-${matchId}`;
const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  stepsPerSecond: 15, startingAnts: 20, foodSources: 1, foodPerSource: 500, loopRate: 0.1,
};

const emptyMetrics: ColonyMetrics = {
  population: 0, foodCollected: 0, reserve: 0, hatching: 0, searching: 0,
  carrying: 0, retreating: 0, waiting: 0, lowEnergy: 0, births: 0, deaths: 0,
};

function drawSnapshot(
  canvas: HTMLCanvasElement,
  snapshot: MatchSnapshot,
  previousSnapshot: MatchSnapshot | null = null,
  interpolation = 1,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const maxHome = snapshot.colonies.map(c => Math.max(1, ...c.homePhero));
  const maxFood = snapshot.colonies.map(c => Math.max(1, ...c.foodPhero));
  const maxCaution = snapshot.colonies.map(c => Math.max(1, ...c.cautPhero));

  ctx.fillStyle = "#1a1208";
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const px = x * CELL, py = y * CELL;
      if (snapshot.grid[y]?.[x] === 0) {
        ctx.fillStyle = "#0d0a06";
        ctx.fillRect(px, py, CELL, CELL);
        continue;
      }
      ctx.fillStyle = "#2a1e0e";
      ctx.fillRect(px, py, CELL, CELL);
      const index = y * COLS + x;
      snapshot.colonies.forEach((colony, ci) => {
        const colors = COLONY_COLORS[colony.id];
        const home = colony.homePhero[index];
        const food = colony.foodPhero[index];
        const caution = colony.cautPhero[index];
        if (home > 0.5) {
          ctx.fillStyle = `rgba(${colors.homeRGB},${Math.min(0.55, home / maxHome[ci] * 0.55)})`;
          ctx.fillRect(px, py, CELL, CELL);
        }
        if (food > 0.5) {
          ctx.fillStyle = `rgba(${colors.foodRGB},${Math.min(0.6, food / maxFood[ci] * 0.6)})`;
          ctx.fillRect(px, py, CELL, CELL);
        }
        if (caution > 0.5) {
          ctx.fillStyle = `rgba(220,60,40,${Math.min(0.45, caution / maxCaution[ci] * 0.45)})`;
          ctx.fillRect(px, py, CELL, CELL);
        }
      });
    }
  }

  ctx.font = `${CELL - 4}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  snapshot.colonies.forEach(colony => {
    const px = colony.nestX * CELL, py = colony.nestY * CELL;
    ctx.fillStyle = COLONY_COLORS[colony.id].primary;
    ctx.fillRect(px, py, CELL, CELL);
    ctx.fillText("🏠", px + CELL / 2, py + CELL / 2);
  });
  snapshot.foodSources.forEach(source => {
    const px = source.x * CELL, py = source.y * CELL;
    ctx.fillStyle = source.remaining > 0 ? "#16a34a" : "#2a2a2a";
    ctx.fillRect(px, py, CELL, CELL);
    ctx.globalAlpha = source.remaining > 0 ? 1 : 0.35;
    ctx.fillText("🍎", px + CELL / 2, py + CELL / 2);
    ctx.globalAlpha = 1;
  });
  const previousAnts = new Map(
    previousSnapshot?.colonies.flatMap(colony => colony.ants.map(ant => [ant.id, ant] as const)) ?? [],
  );
  snapshot.colonies.forEach(colony => colony.ants.forEach(ant => {
    const previous = previousAnts.get(ant.id);
    const x = previous ? previous.x + (ant.x - previous.x) * interpolation : ant.x;
    const y = previous ? previous.y + (ant.y - previous.y) * interpolation : ant.y;
    const fraction = Math.max(0, Math.min(1, ant.energy / MAX_ENERGY));
    const radius = ant.hasFood ? 4.5 : 3.5;
    ctx.globalAlpha = 0.3 + 0.7 * fraction;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = ant.hasFood ? "#facc15" : COLONY_COLORS[colony.id].primary;
    ctx.fill();
    if (fraction <= 0.35) {
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
      ctx.strokeStyle = "#ef4444";
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }));
}

function ColonyPanel({ colonyId, playerName, metrics, doctrine, editable, onChange }: {
  colonyId: number;
  playerName?: string | null;
  metrics: ColonyMetrics;
  doctrine: SimParams;
  editable: boolean;
  onChange: <K extends keyof SimParams>(key: K, value: SimParams[K]) => void;
}) {
  const color = COLONY_COLORS[colonyId].primary;
  const controls = [
    ["evapRate", "Evaporation rate", 0.001, 0.02, 0.001, `${(doctrine.evapRate * 1000).toFixed(0)}‰ / step`],
    ["trailPower", "Trail bias", 1, 10, 0.5, `power ${doctrine.trailPower}`],
    ["tankMax", "Gland size", 1600, 16000, 800, `${doctrine.tankMax}`],
  ] as const;
  const cards: Array<[string, number]> = [
    ["Reserve", Math.floor(metrics.reserve)], ["Food total", metrics.foodCollected],
    ["Hatching", metrics.hatching], ["Searching", metrics.searching],
    ["Carrying", metrics.carrying], ["Retreating", metrics.retreating],
    ["Waiting", metrics.waiting], ["Low energy", metrics.lowEnergy],
    ["Born", metrics.births], ["Died", metrics.deaths],
  ];
  return <section className="mp-panel" style={{ borderColor: `${color}66` }}>
    <div className="mp-panel-title"><span style={{ background: color }} />{playerName || `Colony ${colonyId + 1}`}{editable ? " · You" : ""}</div>
    <div className="mp-hero" style={{ borderColor: `${color}44`, background: `linear-gradient(135deg, ${color}20, #171007 70%)` }}>
      <small>Total ants</small><strong style={{ color }}>{metrics.population}</strong>
    </div>
    <div className="mp-metrics">{cards.map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
    {controls.map(([key, label, min, max, step, display]) => <label className="mp-control" key={key}>
      <span>{label}<strong style={{ color }}>{display}</strong></span>
      <input type="range" min={min} max={max} step={step} value={doctrine[key] as number}
        disabled={!editable} onChange={event => onChange(key, Number(event.target.value))} style={{ accentColor: color }} />
    </label>)}
    <div className="mp-caution"><span>Cautionary</span>{([false, true] as const).map(value =>
      <button key={String(value)} disabled={!editable} onClick={() => onChange("cautionary", value)}
        style={doctrine.cautionary === value ? { background: color, color: "#080604" } : undefined}>{value ? "On" : "Off"}</button>)}</div>
  </section>;
}

const matchSettingControls = (settings: MatchSettings) => [
  ["stepsPerSecond", "Simulation speed", 1, 30, 1, `${settings.stepsPerSecond} steps/sec`],
  ["startingAnts", "Starting ants", 1, 100, 1, `${settings.startingAnts} per colony`],
  ["foodSources", "Food sources", 1, 8, 1, `${settings.foodSources}`],
  ["foodPerSource", "Food per source", 50, 10000, 50, `${settings.foodPerSource} units`],
  ["loopRate", "Maze loop rate", 0, 0.5, 0.01, `${Math.round(settings.loopRate * 100)}%`],
] as const;

function MatchSettingsPanel({ settings }: { settings: MatchSettings }) {
  const controls = matchSettingControls(settings);
  return <section className="mp-settings mp-settings-locked">
    <div className="mp-settings-heading">
      <div><strong>Match setup</strong><span>Locked for this game</span></div>
    </div>
    <div className="mp-settings-summary">{controls.map(([key, label, , , , display]) => <div key={key}>
      <small>{label}</small><strong>{display}</strong>
    </div>)}</div>
  </section>;
}

function MatchSetupModal({ mode, settings, onChange, onClose, onStart }: {
  mode: "human" | "random";
  settings: MatchSettings;
  onChange: <K extends keyof MatchSettings>(key: K, value: MatchSettings[K]) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  const controls = matchSettingControls(settings);
  return <div className="mp-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="mp-setup-modal" role="dialog" aria-modal="true" aria-labelledby="match-setup-title">
      <button className="mp-modal-close" aria-label="Close match setup" onClick={onClose}>×</button>
      <span className="mp-modal-kicker">{mode === "random" ? "Solo match" : "Multiplayer match"}</span>
      <h2 id="match-setup-title">Set up your game</h2>
      <p>{mode === "random" ? "Choose the rules, then play immediately against a colony with a fixed random doctrine." : "Choose the rules before opening a seat for your opponent."}</p>
      <div className="mp-modal-settings">{controls.map(([key, label, min, max, step, display]) => <label key={key}>
      <span>{label}<strong>{display}</strong></span>
      <input type="range" min={min} max={max} step={step} value={settings[key]}
        onChange={event => onChange(key, Number(event.target.value))} />
      </label>)}</div>
      <div className="mp-modal-actions"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" onClick={onStart}>{mode === "random" ? "Start against random" : "Create game"}</button></div>
      <small>These settings are locked once the game is created.</small>
    </section>
  </div>;
}

function HistoryReview({ record, onBack }: { record: MatchHistoryRecord; onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const checkpoints = record.checkpoints;
  const current = checkpoints[Math.min(frame, checkpoints.length - 1)];
  useEffect(() => {
    if (canvasRef.current && current) drawSnapshot(canvasRef.current, current);
  }, [current]);
  useEffect(() => {
    if (!playing || checkpoints.length < 2) return;
    const timer = window.setInterval(() => setFrame(value => {
      if (value >= checkpoints.length - 1) { setPlaying(false); return value; }
      return value + 1;
    }), 1000 / speed);
    return () => window.clearInterval(timer);
  }, [playing, speed, checkpoints.length]);
  const populations = checkpoints.map(point => point.colonies.map(colony => colony.metrics.population));
  const maxPopulation = Math.max(1, ...populations.flat());
  const points = (colonyId: number) => populations.map((values, index) => `${checkpoints.length === 1 ? 0 : index / (checkpoints.length - 1) * 100},${100 - values[colonyId] / maxPopulation * 100}`).join(" ");
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `stigsim-${record.summary.id}-history.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  const winner = record.summary.winner === "draw" ? "Draw" : `${record.summary.playerNames[Number(record.summary.winner)] || `Colony ${Number(record.summary.winner) + 1}`} won`;
  return <main className="mp-page mp-review-page">
    <header className="mp-review-header"><div><button onClick={onBack}>← Game history</button><h1>{record.summary.playerNames[0]} vs {record.summary.playerNames[1]}</h1><p>Room {record.summary.id} · {winner}</p></div><button className="mp-export" onClick={download}>Download JSON</button></header>
    <section className="mp-review-grid">
      <div className="mp-replay-card"><canvas ref={canvasRef} width={W} height={H} /><div className="mp-replay-controls"><button onClick={() => setPlaying(value => !value)}>{playing ? "Pause" : "Play"}</button><input aria-label="Replay position" type="range" min={0} max={Math.max(0, checkpoints.length - 1)} value={frame} onChange={event => { setPlaying(false); setFrame(Number(event.target.value)); }} /><select value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select><span>{current ? Math.round(current.tick / current.settings.stepsPerSecond) : 0}s</span></div></div>
      <aside className="mp-review-sidebar"><h2>At this moment</h2>{current?.colonies.map((colony, id) => <div className="mp-review-colony" key={colony.id} style={{ borderColor: `${COLONY_COLORS[id].primary}55` }}><strong style={{ color: COLONY_COLORS[id].primary }}>{record.summary.playerNames[id]}</strong><span>{colony.metrics.population} ants</span><span>{colony.metrics.foodCollected} food</span><span>{colony.metrics.births} born · {colony.metrics.deaths} died</span></div>)}<h2>Match settings</h2><div className="mp-review-settings"><span>{record.summary.settings.startingAnts} starting ants</span><span>{record.summary.settings.foodSources} food sources</span><span>{record.summary.settings.stepsPerSecond} steps/sec</span><span>{Math.round(record.summary.settings.loopRate * 100)}% maze loops</span></div></aside>
    </section>
    <section className="mp-history-analysis"><div className="mp-history-chart"><div><h2>Population over time</h2><span>One recorded checkpoint per second</span></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Population history chart"><polyline points={points(0)} fill="none" stroke={COLONY_COLORS[0].primary} strokeWidth="2" vectorEffect="non-scaling-stroke"/><polyline points={points(1)} fill="none" stroke={COLONY_COLORS[1].primary} strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg></div><div className="mp-event-log"><h2>Key events</h2>{record.events.slice().reverse().map((event, index) => <div key={`${event.tick}-${event.type}-${index}`}><time>{Math.round(event.tick / record.summary.settings.stepsPerSecond)}s</time><span>{event.type.replaceAll("-", " ")}{event.colonyId !== undefined ? ` · ${record.summary.playerNames[event.colonyId]}` : ""}{event.count ? ` · ${event.count}` : ""}</span></div>)}</div></section>
  </main>;
}

export default function Multiplayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const renderSnapshotsRef = useRef<{
    previous: { snapshot: MatchSnapshot; receivedAt: number } | null;
    current: { snapshot: MatchSnapshot; receivedAt: number } | null;
  }>({ previous: null, current: null });
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const initialMatchId = new URLSearchParams(location.search).get("match")?.trim().toUpperCase() ?? "";
  const [matchId, setMatchId] = useState("");
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("stigsim-player-name") ?? "");
  const [nameConfirmed, setNameConfirmed] = useState(() => Boolean(localStorage.getItem("stigsim-player-name")?.trim()));
  const [activeMatches, setActiveMatches] = useState<MatchSummary[]>([]);
  const [matchHistory, setMatchHistory] = useState<MatchSummary[]>([]);
  const [colonyId, setColonyId] = useState<number | null>(null);
  const [connected, setConnected] = useState([false, false]);
  const [ready, setReady] = useState([false, false]);
  const [names, setNames] = useState<Array<string | null>>([null, null]);
  const [connection, setConnection] = useState("Connecting…");
  const [error, setError] = useState("");
  const [historyRecord, setHistoryRecord] = useState<MatchHistoryRecord | null>(null);
  const [setupMode, setSetupMode] = useState<"human" | "random" | null>(null);
  const [draftSettings, setDraftSettings] = useState<MatchSettings>({ ...DEFAULT_MATCH_SETTINGS });

  const send = useCallback((message: ClientMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
  }, []);

  useEffect(() => {
    const configured = import.meta.env.VITE_WS_URL as string | undefined;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const localUrl = `${protocol}://${location.hostname}:3001`;
    const deployedUrl = `${protocol}://${location.host}`;
    const socket = new WebSocket(configured ?? (location.hostname === "localhost" || location.hostname === "127.0.0.1" ? localUrl : deployedUrl));
    socketRef.current = socket;
    socket.onopen = () => {
      setConnection("Connected");
      const query = new URLSearchParams(location.search);
      const reviewId = query.get("review"); const createdAt = Number(query.get("created"));
      if (reviewId && createdAt) socket.send(JSON.stringify({ type: "get-history", matchId: reviewId, createdAt } satisfies ClientMessage));
    };
    socket.onmessage = event => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === "room-created") {
        sessionStorage.setItem(tokenKey(message.matchId), message.reconnectToken);
        setError("");
      } else if (message.type === "joined") {
        setMatchId(message.matchId);
        setColonyId(message.colonyId);
        setError("");
        sessionStorage.setItem(tokenKey(message.matchId), message.reconnectToken);
        history.replaceState(null, "", `/multiplayer?match=${message.matchId}`);
      } else if (message.type === "player-state") {
        setConnected(message.connected); setReady(message.ready); setNames(message.names);
      } else if (message.type === "lobby-state") {
        setActiveMatches(message.active); setMatchHistory(message.history);
      } else if (message.type === "history-record") {
        setHistoryRecord(message.record); setError("");
      } else if (message.type === "snapshot") {
        const renderState = renderSnapshotsRef.current;
        renderState.previous = renderState.current;
        renderState.current = { snapshot: message.snapshot, receivedAt: performance.now() };
        setSnapshot(message.snapshot);
      }
      else if (message.type === "error") setError(message.message);
    };
    socket.onerror = () => setConnection("Server unavailable");
    socket.onclose = () => setConnection("Disconnected");
    return () => socket.close();
  }, []);

  useEffect(() => {
    let animationFrame = 0;
    const render = (now: number) => {
      const canvas = canvasRef.current;
      const { previous, current } = renderSnapshotsRef.current;
      if (canvas && current) {
        let interpolation = 1;
        if (previous && current.snapshot.phase === "running") {
          const snapshotInterval = Math.max(50, Math.min(300, current.receivedAt - previous.receivedAt));
          interpolation = Math.max(0, Math.min(1, (now - current.receivedAt) / snapshotInterval));
        }
        drawSnapshot(canvas, current.snapshot, previous?.snapshot ?? null, interpolation);
      }
      animationFrame = requestAnimationFrame(render);
    };
    animationFrame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

  const changeDoctrine = <K extends keyof SimParams>(id: number, key: K, value: SimParams[K]) => {
    if (id !== colonyId || !snapshot) return;
    const colony = snapshot.colonies[id];
    const doctrine = { ...colony.doctrine, [key]: value };
    setSnapshot({ ...snapshot, colonies: snapshot.colonies.map(c => c.id === id ? { ...c, doctrine } : c) });
    send({ type: "set-doctrine", doctrine });
  };

  const status = snapshot?.phase === "running" ? "Match running" : snapshot?.phase === "finished"
    ? snapshot.winner === "draw" ? "Draw" : `Colony ${Number(snapshot.winner) + 1} wins`
    : connected.every(Boolean) ? "Both players connected" : "Waiting for opponent";

  const enterRoom = (gameId: string, asSpectator = false) => {
    if (!playerName.trim()) { setError("Enter your name first"); return; }
    localStorage.setItem("stigsim-player-name", playerName.trim());
    send({
      type: "join-room", matchId: gameId, playerName,
      reconnectToken: asSpectator ? undefined : sessionStorage.getItem(tokenKey(gameId)) ?? undefined,
    });
  };

  if (historyRecord) return <HistoryReview record={historyRecord} onBack={() => { setHistoryRecord(null); history.replaceState(null, "", "/multiplayer"); }} />;

  if (!nameConfirmed && !matchId) return <main className="mp-name-gate">
    <form onSubmit={event => {
      event.preventDefault();
      const name = playerName.trim();
      if (!name) return;
      localStorage.setItem("stigsim-player-name", name);
      setPlayerName(name);
      setNameConfirmed(true);
    }}>
      <span className="mp-name-ant">🐜</span>
      <h1>What should we call you?</h1>
      <p>This name will identify your colony in multiplayer games.</p>
      <input autoFocus maxLength={24} aria-label="Your multiplayer name" placeholder="Enter your name" value={playerName} onChange={event => setPlayerName(event.target.value)} />
      <button type="submit" disabled={!playerName.trim()}>Continue to multiplayer</button>
      <a href="/">← Back to local mode</a>
    </form>
  </main>;

  if (!matchId) {
    const waitingGames = activeMatches.filter(game => game.phase === "waiting");
    const runningGames = activeMatches.filter(game => game.phase === "running");
    return <main className="mp-page mp-room-page">
      <div className="mp-directory-shell">
        <header className="mp-directory-header">
          <div><a href="/">← Local mode</a><h1>War mode · Multiplayer</h1><p>Find a match, watch one in progress, or create a new challenge.</p></div>
          <div className="mp-directory-actions">
            <div className="mp-saved-identity"><span>Playing as</span><strong>{playerName}</strong><button onClick={() => { localStorage.removeItem("stigsim-player-name"); setPlayerName(""); setNameConfirmed(false); }}>Change</button></div>
            <button className="mp-create-room" disabled={connection !== "Connected"} onClick={() => setSetupMode("human")}>New game</button>
            <button className="mp-random-room" disabled={connection !== "Connected"} onClick={() => setSetupMode("random")}>Play against random</button>
          </div>
          {initialMatchId && <div className="mp-invite-join"><span>Invited to room <strong>{initialMatchId}</strong></span><button disabled={!playerName.trim()} onClick={() => enterRoom(initialMatchId)}>Join invite</button></div>}
          {error && <div className="mp-error">{error}</div>}
        </header>
        <div className="mp-directory-sections">
          <section className="mp-directory-section mp-waiting-section">
            <div className="mp-section-title"><div><span>1</span><h2>Waiting for opponent</h2><p>Take the open colony and start a match.</p></div><strong>{waitingGames.length}</strong></div>
            <div className="mp-match-rows">{waitingGames.length === 0 ? <div className="mp-section-empty">No one is waiting yet. Start a new game above.</div> : waitingGames.map(game => {
              const ownRoom = Boolean(sessionStorage.getItem(tokenKey(game.id)));
              return <article className="mp-match-row" key={game.id}>
                <div className="mp-row-mode"><span>🐜</span><strong>{game.id}</strong><small>War match</small></div>
                <div className="mp-row-players"><div><i className="blue" /><strong>{game.playerNames[0] || "Open colony"}</strong></div><div><i className="red" /><strong className={!game.playerNames[1] ? "is-open" : ""}>{game.playerNames[1] || "Open colony"}</strong></div></div>
                <div className="mp-row-stat"><small>Ants</small><strong>{game.settings.startingAnts}</strong><span>per colony</span></div>
                <div className="mp-row-stat"><small>Food</small><strong>{game.settings.foodSources}</strong><span>{game.settings.foodPerSource}/source</span></div>
                <div className="mp-row-stat"><small>Speed</small><strong>{game.settings.stepsPerSecond}</strong><span>steps/sec</span></div>
                <div className="mp-row-stat"><small>Maze</small><strong>{Math.round(game.settings.loopRate * 100)}%</strong><span>loops</span></div>
                <button className="mp-row-action join" disabled={!playerName.trim()} onClick={() => enterRoom(game.id, Boolean(game.playerNames[1]) && !ownRoom)}>
                  {ownRoom ? "Enter your game" : !game.playerNames[1] ? "Join and take Colony 2" : "View waiting room"}
                </button>
              </article>;
            })}</div>
          </section>
          <section className="mp-directory-section mp-active-section">
            <div className="mp-section-title"><div><span>2</span><h2>Active games</h2><p>Drop into a live match as a spectator.</p></div><strong>{runningGames.length}</strong></div>
            <div className="mp-match-rows">{runningGames.length === 0 ? <div className="mp-section-empty">No matches are live right now.</div> : runningGames.map(game => <article className="mp-match-row" key={game.id}>
              <div className="mp-row-mode live"><span>●</span><strong>{game.id}</strong><small>Live now</small></div>
              <div className="mp-row-players"><div><i className="blue" /><strong>{game.playerNames[0]}</strong></div><div><i className="red" /><strong>{game.playerNames[1]}</strong></div></div>
              <div className="mp-row-stat"><small>Ants</small><strong>{game.settings.startingAnts}</strong><span>per colony</span></div>
              <div className="mp-row-stat"><small>Food</small><strong>{game.settings.foodSources}</strong><span>{game.settings.foodPerSource}/source</span></div>
              <div className="mp-row-stat"><small>Speed</small><strong>{game.settings.stepsPerSecond}</strong><span>steps/sec</span></div>
              <div className="mp-row-stat"><small>Maze</small><strong>{Math.round(game.settings.loopRate * 100)}%</strong><span>loops</span></div>
              <button className="mp-row-action watch" disabled={!playerName.trim()} onClick={() => enterRoom(game.id, true)}>Watch game</button>
            </article>)}</div>
          </section>
          <section className="mp-directory-section mp-past-section">
            <div className="mp-section-title"><div><span>3</span><h2>Past games</h2><p>Recent winners and match configurations.</p></div><strong>{matchHistory.length}</strong></div>
            <div className="mp-match-rows">{matchHistory.length === 0 ? <div className="mp-section-empty">Completed matches will appear here.</div> : matchHistory.map((game, index) => <article className="mp-match-row past" key={`${game.id}-${game.endedAt}-${index}`}>
              <div className="mp-row-mode"><span>✓</span><strong>{game.id}</strong><small>{game.endedAt ? new Date(game.endedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Finished"}</small></div>
              <div className="mp-row-players"><div><i className="blue" /><strong>{game.playerNames[0] || "Unknown"}</strong><b>{game.winner === 0 ? "1" : "0"}</b></div><div><i className="red" /><strong>{game.playerNames[1] || "Unknown"}</strong><b>{game.winner === 1 ? "1" : "0"}</b></div></div>
              <div className="mp-row-stat"><small>Ants</small><strong>{game.settings.startingAnts}</strong><span>per colony</span></div>
              <div className="mp-row-stat"><small>Food</small><strong>{game.settings.foodSources}</strong><span>{game.settings.foodPerSource}/source</span></div>
              <div className="mp-row-stat"><small>Speed</small><strong>{game.settings.stepsPerSecond}</strong><span>steps/sec</span></div>
              <div className="mp-row-result"><small>Result</small><strong>{game.winner === "draw" ? "Draw" : `${game.playerNames[Number(game.winner)] || `Colony ${Number(game.winner) + 1}`} won`}</strong><button className="mp-review-action" onClick={() => { history.replaceState(null, "", `/multiplayer?review=${game.id}&created=${game.createdAt}`); send({ type: "get-history", matchId: game.id, createdAt: game.createdAt }); }}>Review</button></div>
            </article>)}</div>
          </section>
        </div>
        <small className="mp-directory-connection">{connection}</small>
      </div>
      {setupMode && <MatchSetupModal mode={setupMode} settings={draftSettings}
        onChange={(key, value) => setDraftSettings(current => ({ ...current, [key]: value }))}
        onClose={() => setSetupMode(null)} onStart={() => {
          localStorage.setItem("stigsim-player-name", playerName.trim());
          send({ type: setupMode === "random" ? "create-random-room" : "create-room", playerName, settings: draftSettings });
          setSetupMode(null);
        }} />}
    </main>;
  }

  const inviteUrl = `${location.origin}/multiplayer?match=${matchId}`;
  return <main className="mp-page">
    <header className="mp-header">
      <div><a href="/multiplayer">← Match rooms</a><h1>War mode · Multiplayer</h1><p>{status} · {connection} · Room <strong>{matchId}</strong></p></div>
      {colonyId !== null && snapshot?.phase === "waiting" && <button className="mp-ready" disabled={ready[colonyId]} onClick={() => send({ type: "ready" })}>{ready[colonyId] ? "Ready — waiting" : "Ready up"}</button>}
      {snapshot?.phase === "finished" && colonyId !== null && <button className="mp-ready" onClick={() => send({ type: "reset" })}>New match</button>}
    </header>
    <div className="mp-invite"><span>Invite link</span><input readOnly value={inviteUrl} /><button onClick={() => navigator.clipboard.writeText(inviteUrl)}>Copy</button></div>
    {error && <div className="mp-error">{error}</div>}
    <div className="mp-lobby-status">
      <div className="mp-players">{[0, 1].map(id => <span key={id} style={{ color: COLONY_COLORS[id].primary }}>{names[id] || `Colony ${id + 1}`}: {connected[id] ? ready[id] ? "ready" : "connected" : "open"}</span>)}</div>
      {colonyId === null && <div className="mp-seat-actions">
        {[0, 1].filter(id => !connected[id]).map(id => <button key={id} onClick={() => send({ type: "claim-seat", colonyId: id })}
          style={{ borderColor: `${COLONY_COLORS[id].primary}88`, color: COLONY_COLORS[id].primary }}>
          Join Colony {id + 1}
        </button>)}
      </div>}
      {snapshot?.phase === "waiting" && <p className="mp-lobby-help">
        {colonyId === null
          ? connected.every(Boolean)
            ? "Both seats are currently occupied. You’re watching as a spectator."
            : "Choose an open colony seat. Then invite another player—or open this page in a separate browser session—to claim the other seat."
          : connected.every(Boolean)
            ? "Both seats are filled. Each player must click Ready up to start."
            : "You’ve joined. Invite another player—or open this page in a separate browser session—to claim the other seat."}
      </p>}
    </div>
    <MatchSettingsPanel settings={snapshot?.settings ?? DEFAULT_MATCH_SETTINGS} />
    <div className="war-arena">
      <aside className="war-side war-side-left"><ColonyPanel colonyId={0} playerName={names[0]} metrics={snapshot?.colonies[0]?.metrics ?? emptyMetrics} doctrine={snapshot?.colonies[0]?.doctrine ?? DEFAULT_PARAMS} editable={colonyId === 0} onChange={(key, value) => changeDoctrine(0, key, value)} /></aside>
      <canvas className="war-maze mp-canvas" ref={canvasRef} width={W} height={H} />
      <aside className="war-side war-side-right"><ColonyPanel colonyId={1} playerName={names[1]} metrics={snapshot?.colonies[1]?.metrics ?? emptyMetrics} doctrine={snapshot?.colonies[1]?.doctrine ?? DEFAULT_PARAMS} editable={colonyId === 1} onChange={(key, value) => changeDoctrine(1, key, value)} /></aside>
    </div>
    {colonyId === null && connected.every(Boolean) && <p className="mp-spectator">Both colony seats are occupied. You’re watching as a spectator.</p>}
  </main>;
}
