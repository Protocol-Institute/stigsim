import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import express from "express";
import { Pool } from "pg";
import { WebSocketServer, WebSocket } from "ws";
import { DEFAULT_PARAMS, Simulation } from "../src/AntSim";
import type { SimParams } from "../src/AntSim";
import type { ClientMessage, MatchEvent, MatchHistoryRecord, MatchPhase, MatchSettings, MatchSnapshot, MatchSummary, ServerMessage } from "../src/multiplayerProtocol";

const PORT = Number(process.env.WS_PORT ?? 3001);
const CLOCK_RATE = 60;
const SNAPSHOT_RATE = 10;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const EMPTY_ROOM_TTL = 30 * 60 * 1000;
const DEFAULT_SETTINGS: MatchSettings = { stepsPerSecond: 15, startingAnts: 20, foodSources: 1, foodPerSource: 500, loopRate: 0.1 };

interface PlayerSlot { token: string; socket: WebSocket | null; ready: boolean; name: string; isBot?: boolean }
interface Match {
  id: string;
  settings: MatchSettings;
  simulation: Simulation;
  phase: MatchPhase;
  winner: number | "draw" | null;
  tick: number;
  players: Array<PlayerSlot | null>;
  spectators: Set<WebSocket>;
  simulationAccumulator: number;
  snapshotAccumulator: number;
  emptySince: number | null;
  createdAt: number;
  endedAt: number | null;
  historyRecorded: boolean;
  events: MatchEvent[];
  checkpoints: MatchSnapshot[];
  lastBirths: number[];
  lastDeaths: number[];
  nextCheckpointTick: number;
}

const matches = new Map<string, Match>();
const socketMatches = new Map<WebSocket, Match>();
const socketNames = new Map<WebSocket, string>();
const completedGames: MatchSummary[] = [];
const historyRecords = new Map<string, MatchHistoryRecord>();
const historyKey = (id: string, createdAt: number) => `${id}:${createdAt}`;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 3 }) : null;

async function initializeHistory() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS war_match_history (
    record_key text PRIMARY KEY,
    match_id text NOT NULL,
    created_at bigint NOT NULL,
    ended_at bigint NOT NULL,
    summary jsonb NOT NULL,
    record jsonb NOT NULL
  )`);
  const result = await pool.query<{ summary: MatchSummary }>("SELECT summary FROM war_match_history ORDER BY ended_at DESC LIMIT 50");
  completedGames.push(...result.rows.map(row => row.summary));
}

async function persistHistory(record: MatchHistoryRecord) {
  historyRecords.set(historyKey(record.summary.id, record.summary.createdAt), record);
  if (!pool) return;
  await pool.query(
    `INSERT INTO war_match_history (record_key, match_id, created_at, ended_at, summary, record)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     ON CONFLICT (record_key) DO UPDATE SET summary = EXCLUDED.summary, record = EXCLUDED.record, ended_at = EXCLUDED.ended_at`,
    [historyKey(record.summary.id, record.summary.createdAt), record.summary.id, record.summary.createdAt, record.summary.endedAt, JSON.stringify(record.summary), JSON.stringify(record)],
  );
}

async function fetchHistory(matchId: string, createdAt: number) {
  const key = historyKey(matchId, createdAt);
  const cached = historyRecords.get(key);
  if (cached || !pool) return cached;
  const result = await pool.query<{ record: MatchHistoryRecord }>("SELECT record FROM war_match_history WHERE record_key = $1", [key]);
  if (result.rows[0]) historyRecords.set(key, result.rows[0].record);
  return result.rows[0]?.record;
}

function roomCode() {
  do {
    let code = "";
    for (let i = 0; i < 5; i++) code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    if (!matches.has(code)) return code;
  } while (true);
}

function makeSimulation(settings: MatchSettings) {
  return new Simulation(settings.startingAnts, DEFAULT_PARAMS, settings.loopRate, 2, settings.foodSources, settings.foodPerSource);
}

function createMatch(requestedSettings: MatchSettings = DEFAULT_SETTINGS): Match {
  const settings = { ...requestedSettings };
  const match: Match = {
    id: roomCode(), settings, simulation: makeSimulation(settings), phase: "waiting", winner: null, tick: 0,
    players: [null, null], spectators: new Set(), simulationAccumulator: 0, snapshotAccumulator: 0, emptySince: null,
    createdAt: Date.now(), endedAt: null, historyRecorded: false, events: [], checkpoints: [],
    lastBirths: [0, 0], lastDeaths: [0, 0], nextCheckpointTick: settings.stepsPerSecond,
  };
  matches.set(match.id, match);
  return match;
}

function createWaitingMatch(playerName: string, settings: MatchSettings) {
  const match = createMatch(settings);
  const token = randomUUID();
  match.players[0] = { token, socket: null, ready: false, name: playerName };
  match.emptySince = Date.now();
  return { match, token };
}

function validSettings(value: unknown): value is MatchSettings {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<MatchSettings>;
  return Number.isInteger(s.stepsPerSecond) && s.stepsPerSecond! >= 1 && s.stepsPerSecond! <= 30
    && Number.isInteger(s.startingAnts) && s.startingAnts! >= 1 && s.startingAnts! <= 100
    && Number.isInteger(s.foodSources) && s.foodSources! >= 1 && s.foodSources! <= 8
    && Number.isInteger(s.foodPerSource) && s.foodPerSource! >= 50 && s.foodPerSource! <= 10000 && s.foodPerSource! % 50 === 0
    && typeof s.loopRate === "number" && s.loopRate >= 0 && s.loopRate <= 0.5;
}

function validDoctrine(value: unknown): value is SimParams {
  if (!value || typeof value !== "object") return false;
  const d = value as Partial<SimParams>;
  return typeof d.evapRate === "number" && d.evapRate >= 0.001 && d.evapRate <= 0.02
    && typeof d.trailPower === "number" && d.trailPower >= 1 && d.trailPower <= 10
    && typeof d.tankMax === "number" && d.tankMax >= 1600 && d.tankMax <= 16000
    && typeof d.cautionary === "boolean";
}

function cleanName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ").slice(0, 24);
  return name.length >= 1 ? name : null;
}

function randomDoctrine(): SimParams {
  return {
    evapRate: (1 + Math.floor(Math.random() * 20)) / 1000,
    trailPower: 1 + Math.floor(Math.random() * 19) * 0.5,
    tankMax: 1600 + Math.floor(Math.random() * 19) * 800,
    cautionary: Math.random() >= 0.5,
  };
}

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function sockets(match: Match) {
  return [...match.players.flatMap(p => p?.socket ? [p.socket] : []), ...match.spectators];
}

function broadcast(match: Match, message: ServerMessage) {
  const encoded = JSON.stringify(message);
  for (const socket of sockets(match)) if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 2_000_000) socket.send(encoded);
}

function broadcastPlayers(match: Match) {
  broadcast(match, {
    type: "player-state",
    connected: match.players.map(p => Boolean(p?.isBot || (p?.socket && p.socket.readyState === WebSocket.OPEN))),
    ready: match.players.map(p => Boolean(p?.ready)),
    names: match.players.map(p => p?.name ?? null),
  });
}

function summary(match: Match): MatchSummary {
  return {
    id: match.id, phase: match.phase, playerNames: match.players.map(p => p?.name ?? null),
    connected: match.players.map(p => Boolean(p?.isBot || (p?.socket && p.socket.readyState === WebSocket.OPEN))),
    winner: match.winner, createdAt: match.createdAt, endedAt: match.endedAt, settings: { ...match.settings },
  };
}

function lobbyMessage(): ServerMessage {
  return {
    type: "lobby-state",
    active: [...matches.values()].filter(match => match.phase !== "finished").map(summary).sort((a, b) => b.createdAt - a.createdAt),
    history: completedGames.slice(0, 30),
  };
}

function broadcastLobby() {
  const encoded = JSON.stringify(lobbyMessage());
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(encoded);
}

function snapshot(match: Match): MatchSnapshot {
  const sim = match.simulation;
  return {
    tick: match.tick, phase: match.phase, winner: match.winner, settings: { ...match.settings }, grid: sim.grid,
    foodSources: sim.foodSources.map(source => ({ ...source })),
    colonies: sim.colonies.map(colony => ({
      id: colony.id, nestX: colony.nestX, nestY: colony.nestY,
      homePhero: Array.from(colony.homePhero), foodPhero: Array.from(colony.foodPhero), cautPhero: Array.from(colony.cautPhero),
      ants: colony.ants.map(ant => ({ id: ant.id, colonyId: ant.colonyId, x: ant.x, y: ant.y, tx: ant.tx, ty: ant.ty, state: ant.state, hasFood: ant.hasFood, energy: ant.energy })),
      metrics: sim.getColonyMetrics(colony), doctrine: { ...colony.pendingDoctrine }, doctrineVersion: colony.doctrineVersion,
    })),
  };
}

function broadcastSnapshot(match: Match) { broadcast(match, { type: "snapshot", snapshot: snapshot(match) }) }
function beginRecording(match: Match) {
  if (match.events.some(event => event.type === "match-started")) return;
  match.events.push({ type: "match-started", tick: match.tick, at: Date.now() });
  match.checkpoints.push(snapshot(match));
}
function recordProgress(match: Match) {
  for (const colony of match.simulation.colonies) {
    const metrics = match.simulation.getColonyMetrics(colony);
    const births = metrics.births - match.lastBirths[colony.id];
    const deaths = metrics.deaths - match.lastDeaths[colony.id];
    if (births > 0) match.events.push({ type: "ants-born", tick: match.tick, at: Date.now(), colonyId: colony.id, count: births });
    if (deaths > 0) match.events.push({ type: "ants-died", tick: match.tick, at: Date.now(), colonyId: colony.id, count: deaths });
    match.lastBirths[colony.id] = metrics.births;
    match.lastDeaths[colony.id] = metrics.deaths;
  }
  if (match.tick >= match.nextCheckpointTick) {
    match.checkpoints.push(snapshot(match));
    match.nextCheckpointTick += match.settings.stepsPerSecond;
  }
}
function findPlayer(match: Match, socket: WebSocket) { return match.players.findIndex(p => p?.socket === socket) }

function enterMatch(socket: WebSocket, match: Match, playerName: string, reconnectToken?: string) {
  const old = socketMatches.get(socket);
  if (old && old !== match) leaveMatch(socket, old);
  socketMatches.set(socket, match);
  socketNames.set(socket, playerName);
  let colonyId = reconnectToken ? match.players.findIndex(p => p?.token === reconnectToken) : -1;
  if (colonyId >= 0) {
    match.players[colonyId]!.socket?.close(4001, "Reconnected elsewhere");
    match.players[colonyId]!.socket = socket;
    match.players[colonyId]!.name = playerName;
  } else {
    colonyId = match.players.findIndex(p => p === null);
    if (colonyId >= 0) match.players[colonyId] = { token: randomUUID(), socket, ready: false, name: playerName };
    else { match.spectators.add(socket); colonyId = -1; }
  }
  match.emptySince = null;
  const token = colonyId >= 0 ? match.players[colonyId]!.token : randomUUID();
  send(socket, { type: "joined", matchId: match.id, colonyId: colonyId >= 0 ? colonyId : null, reconnectToken: token, phase: match.phase });
  send(socket, { type: "snapshot", snapshot: snapshot(match) });
  broadcastPlayers(match);
  broadcastLobby();
}

function claimSeat(socket: WebSocket, match: Match, colonyId: number) {
  if ((colonyId !== 0 && colonyId !== 1) || findPlayer(match, socket) >= 0) return send(socket, { type: "error", message: "That seat cannot be claimed" });
  if (match.players[colonyId]?.isBot) return send(socket, { type: "error", message: "That colony is controlled by the random opponent" });
  if (match.players[colonyId]?.socket?.readyState === WebSocket.OPEN) return send(socket, { type: "error", message: `Colony ${colonyId + 1} is already occupied` });
  match.spectators.delete(socket);
  match.players[colonyId] = { token: randomUUID(), socket, ready: false, name: socketNames.get(socket) ?? `Player ${colonyId + 1}` };
  send(socket, { type: "joined", matchId: match.id, colonyId, reconnectToken: match.players[colonyId]!.token, phase: match.phase });
  send(socket, { type: "snapshot", snapshot: snapshot(match) });
  broadcastPlayers(match);
  broadcastLobby();
}

function resetMatch(match: Match) {
  match.simulation = makeSimulation(match.settings); match.phase = "waiting"; match.winner = null; match.tick = 0; match.simulationAccumulator = 0;
  match.createdAt = Date.now(); match.endedAt = null; match.historyRecorded = false;
  match.events = []; match.checkpoints = []; match.lastBirths = [0, 0]; match.lastDeaths = [0, 0]; match.nextCheckpointTick = match.settings.stepsPerSecond;
  for (const player of match.players) if (player) player.ready = Boolean(player.isBot);
  broadcastPlayers(match); broadcastSnapshot(match);
  broadcastLobby();
}

function leaveMatch(socket: WebSocket, match: Match) {
  match.spectators.delete(socket);
  const colonyId = findPlayer(match, socket);
  if (colonyId >= 0) match.players[colonyId]!.socket = null;
  socketMatches.delete(socket);
  socketNames.delete(socket);
  broadcastPlayers(match);
  if (!sockets(match).some(s => s.readyState === WebSocket.OPEN)) match.emptySince = Date.now();
  broadcastLobby();
}

const app = express();
app.get("/api/healthz", (_request, response) => response.json({ ok: true, matches: matches.size, activeConnections: socketMatches.size }));
const distPath = resolve(process.cwd(), "../dist");
app.use(express.static(distPath));
app.use((_request, response) => response.sendFile(resolve(distPath, "index.html")));
const httpServer = createServer(app);

const wss = new WebSocketServer({ server: httpServer });
wss.on("connection", socket => {
  send(socket, lobbyMessage());
  socket.on("message", async raw => {
    let message: ClientMessage;
    try { message = JSON.parse(raw.toString()) as ClientMessage; }
    catch { return send(socket, { type: "error", message: "Invalid JSON message" }); }

    if (message.type === "create-room") {
      const name = cleanName(message.playerName);
      if (!name) return send(socket, { type: "error", message: "Enter a player name" });
      if (!validSettings(message.settings)) return send(socket, { type: "error", message: "Match settings are outside the allowed range" });
      const { match, token } = createWaitingMatch(name, message.settings);
      send(socket, { type: "room-created", matchId: match.id, reconnectToken: token });
      broadcastLobby();
      return;
    }
    if (message.type === "create-random-room") {
      const name = cleanName(message.playerName);
      if (!name) return send(socket, { type: "error", message: "Enter a player name" });
      if (!validSettings(message.settings)) return send(socket, { type: "error", message: "Match settings are outside the allowed range" });
      const match = createMatch(message.settings);
      match.players[1] = { token: randomUUID(), socket: null, ready: true, name: "Random Colony", isBot: true };
      match.simulation.setColonyDoctrine(1, randomDoctrine(), true);
      match.phase = "running";
      beginRecording(match);
      enterMatch(socket, match, name);
      match.players[0]!.ready = true;
      broadcastPlayers(match);
      broadcastSnapshot(match);
      broadcastLobby();
      return;
    }
    if (message.type === "join-room") {
      const name = cleanName(message.playerName);
      if (!name) return send(socket, { type: "error", message: "Enter a player name" });
      const match = matches.get(message.matchId.trim().toUpperCase());
      if (!match) return send(socket, { type: "error", message: "Match not found. Check the room code." });
      return enterMatch(socket, match, name, message.reconnectToken);
    }
    if (message.type === "get-history") {
      const record = await fetchHistory(message.matchId, message.createdAt);
      return record ? send(socket, { type: "history-record", record }) : send(socket, { type: "error", message: "That replay is no longer available" });
    }

    const match = socketMatches.get(socket);
    if (!match) return send(socket, { type: "error", message: "Create or join a match first" });
    if (message.type === "claim-seat") return claimSeat(socket, match, message.colonyId);
    const colonyId = findPlayer(match, socket);
    if (colonyId < 0) return send(socket, { type: "error", message: "Only players can control a colony" });

    if (message.type === "ready") {
      match.players[colonyId]!.ready = true;
      if (match.players.every(p => p?.ready)) { match.phase = "running"; beginRecording(match); }
      broadcastPlayers(match); broadcastSnapshot(match);
      broadcastLobby();
    } else if (message.type === "set-doctrine") {
      if (!validDoctrine(message.doctrine)) return send(socket, { type: "error", message: "Doctrine values are outside the allowed range" });
      match.simulation.setColonyDoctrine(colonyId, message.doctrine);
      match.events.push({ type: "doctrine-changed", tick: match.tick, at: Date.now(), colonyId, doctrine: { ...message.doctrine } });
    } else if (message.type === "reset" && match.phase === "finished") resetMatch(match);
  });
  socket.on("close", () => { const match = socketMatches.get(socket); if (match) leaveMatch(socket, match) });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, match] of matches) {
    if (match.emptySince && now - match.emptySince > EMPTY_ROOM_TTL) { matches.delete(id); continue; }
    if (match.phase === "running") {
      match.simulationAccumulator += match.settings.stepsPerSecond / CLOCK_RATE;
      while (match.simulationAccumulator >= 1) { match.simulation.step(); match.tick++; match.simulationAccumulator--; }
      recordProgress(match);
      const survivors = match.simulation.colonies.filter(c => c.ants.length > 0 || c.developingAnts.length > 0);
      if (survivors.length <= 1) {
        match.phase = "finished"; match.winner = survivors.length === 1 ? survivors[0].id : "draw"; match.endedAt = Date.now();
        match.events.push({ type: "match-ended", tick: match.tick, at: match.endedAt, winner: match.winner });
        match.checkpoints.push(snapshot(match));
        if (!match.historyRecorded) {
          match.historyRecorded = true; completedGames.unshift(summary(match));
          void persistHistory({ summary: summary(match), events: match.events.map(event => ({ ...event })), checkpoints: match.checkpoints }).catch(error => console.error("[war-history] Failed to persist match", error));
          if (completedGames.length > 50) completedGames.length = 50;
          broadcastLobby();
        }
      }
    }
    match.snapshotAccumulator += SNAPSHOT_RATE / CLOCK_RATE;
    if (match.snapshotAccumulator >= 1) { match.snapshotAccumulator--; broadcastSnapshot(match); }
  }
}, 1000 / CLOCK_RATE);

await initializeHistory();
httpServer.listen(PORT, "0.0.0.0", () => console.log(`Authoritative War Mode server listening on port ${PORT}`));
