import { randomInt, randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { ADOPTION_MODES, DEFAULT_DOCTRINE, DEFAULT_TOPOLOGY, DOCTRINE_CHANNELS, MAZE_LAYOUTS, ROLES, STATES, DenseField, DenseGrid, cloneDoctrine, cloneTopology, deriveStreamSeed, generateMasterSeed, isDoctrine, isTopology, makeRng, type Doctrine, type Topology } from "@stigsim/sim-core";
import { WebSocket, WebSocketServer } from "ws";
import { desc } from "drizzle-orm";
import { WarSimulation } from "../../src/modes/war/war-simulation";
import { db } from "./db";
import { warMatchRecordsTable } from "./schema";
import { isAllowedWebSocketOrigin } from "./security";
import { registerWebSocketRoute } from "./upgrade-router";
import { WAR_MATCH_REMOVED_CODE, WAR_RECONNECTED_ELSEWHERE_CODE } from "../../shared/war-contract";
import { PRESETS } from "../../src/doctrine-presets";
import { conformDoctrine, isNamedTopology } from "../../src/topology-choices";
import type {
  OnlineWarSettings,
  WarClientMessage,
  WarMatchSummary,
  WarMatchRecord,
  WarServerMessage,
  WarSnapshot,
} from "../../shared/war-contract";

const CLOCK_RATE = 60;
const SNAPSHOT_RATE = 10;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1_000;
const MAX_MATCHES = 100;
const MAX_MESSAGES_PER_SECOND = 30;
const MAX_MESSAGES_HARD_LIMIT = MAX_MESSAGES_PER_SECOND * 10;
const MAX_BUFFERED_BYTES = 512 * 1_024;

interface PlayerSlot {
  token: string;
  socket: WebSocket | null;
  ready: boolean;
  name: string;
  isBot?: boolean;
}

interface WarMatch {
  id: string;
  settings: OnlineWarSettings;
  war: WarSimulation;
  phase: "waiting" | "running" | "finished";
  players: Array<PlayerSlot | null>;
  spectators: Set<WebSocket>;
  simulationAccumulator: number;
  snapshotAccumulator: number;
  emptySince: number | null;
  finishedAt: number | null;
  createdAt: number;
  resultRecorded: boolean;
}

const matches = new Map<string, WarMatch>();
const socketMatches = new Map<WebSocket, WarMatch>();
const socketNames = new Map<WebSocket, string>();
const roomCreatedBySocket = new WeakSet<WebSocket>();
const matchHistory: WarMatchRecord[] = [];
let activeWss: WebSocketServer | null = null;
let unregisterUpgradeRoute: (() => void) | null = null;
let clock: ReturnType<typeof setInterval> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

export function validOnlineWarSettings(value: unknown): value is OnlineWarSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<OnlineWarSettings>;
  return typeof settings.masterSeed === "string" && settings.masterSeed.length <= 200
    && Number.isInteger(settings.stepsPerSecond) && settings.stepsPerSecond! >= 2 && settings.stepsPerSecond! <= 60
    && Number.isInteger(settings.startingAnts) && settings.startingAnts! >= 1 && settings.startingAnts! <= 100
    && Number.isInteger(settings.foodSources) && settings.foodSources! >= 1 && settings.foodSources! <= 12
    && Number.isInteger(settings.foodPerSource) && settings.foodPerSource! >= 50 && settings.foodPerSource! <= 10_000
    && settings.foodPerSource! % 50 === 0
    && typeof settings.loopRate === "number" && Number.isFinite(settings.loopRate)
    && settings.loopRate >= 0 && settings.loopRate <= 0.5
    && Number.isInteger(settings.tankMax) && settings.tankMax! >= 1_600 && settings.tankMax! <= 16_000
    && settings.tankMax! % 800 === 0
    && isTopology(settings.topology) && isNamedTopology(settings.topology)
    && (MAZE_LAYOUTS as readonly unknown[]).includes(settings.layout)
    && (ADOPTION_MODES as readonly unknown[]).includes(settings.adoption);
}

export function validWarDoctrine(value: unknown): value is Doctrine {
  if (!isDoctrine(value)) return false;
  if (value.evapRate < 0.001 || value.evapRate > 0.02) return false;
  if (value.spoilerFraction > 0.5 || value.spoilerFraction * 20 !== Math.round(value.spoilerFraction * 20)) return false;
  if (value.mimicRate * 20 !== Math.round(value.mimicRate * 20)) return false;
  for (const role of ROLES) for (const state of STATES) for (const channel of DOCTRINE_CHANNELS) {
    const follow = value[role].follow[state][channel];
    if (Math.abs(follow.own) > 10 || Math.abs(follow.enemy) > 10) return false;
    const lay = value[role].lay[state][channel];
    if (lay.own > 1) return false;
  }
  return true;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ").slice(0, 24);
  return name || null;
}

function roomCode(): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < 5; i++) code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
    if (!matches.has(code)) return code;
  }
}

export function normalizeWarDoctrine(value: Doctrine, topology: Topology): Doctrine {
  return conformDoctrine(value, topology);
}

function onlineWarSettings(value: OnlineWarSettings): OnlineWarSettings {
  return {
    masterSeed: value.masterSeed.trim() || generateMasterSeed(),
    stepsPerSecond: value.stepsPerSecond,
    startingAnts: value.startingAnts,
    foodSources: value.foodSources,
    foodPerSource: value.foodPerSource,
    loopRate: value.loopRate,
    tankMax: value.tankMax,
    topology: cloneTopology(value.topology),
    layout: value.layout,
    adoption: value.adoption,
  };
}

function makeWar(settings: OnlineWarSettings, doctrines?: Doctrine[]): WarSimulation {
  return new WarSimulation({
    masterSeed: settings.masterSeed.trim() || generateMasterSeed(),
    startingAnts: settings.startingAnts,
    foodSources: settings.foodSources,
    foodPerSource: settings.foodPerSource,
    loopRate: settings.loopRate,
    tankMax: settings.tankMax,
    topology: settings.topology,
    layout: settings.layout,
    adoption: settings.adoption,
  }, doctrines);
}

export function randomOpponentDoctrine(masterSeed: string, topology: Topology = DEFAULT_TOPOLOGY): Doctrine {
  const rng = makeRng(deriveStreamSeed(masterSeed, "war-random-opponent-doctrine"));
  const available = PRESETS.filter(preset => preset.available(topology));
  const preset = available[Math.floor(rng() * available.length)] ?? PRESETS[0];
  return conformDoctrine(preset.doctrine, topology);
}

function createMatch(settings: OnlineWarSettings): WarMatch {
  const normalized = onlineWarSettings(settings);
  const match: WarMatch = {
    id: roomCode(),
    settings: normalized,
    war: makeWar(normalized),
    phase: "waiting",
    players: [null, null],
    spectators: new Set(),
    simulationAccumulator: 0,
    snapshotAccumulator: 0,
    emptySince: null,
    finishedAt: null,
    createdAt: Date.now(),
    resultRecorded: false,
  };
  matches.set(match.id, match);
  return match;
}

function createWaitingMatch(socket: WebSocket, playerName: string, settings: OnlineWarSettings): { match: WarMatch; token: string } {
  const match = createMatch(settings);
  const token = randomUUID();
  match.players[0] = { token, socket, ready: false, name: playerName };
  socketMatches.set(socket, match);
  socketNames.set(socket, playerName);
  return { match, token };
}

function sockets(match: WarMatch): WebSocket[] {
  return [...match.players.flatMap(player => player?.socket ? [player.socket] : []), ...match.spectators];
}

function evictMatch(match: WarMatch, closeReason = "Match room expired"): void {
  matches.delete(match.id);
  for (const socket of sockets(match)) {
    socketMatches.delete(socket);
    socketNames.delete(socket);
    socket.close(WAR_MATCH_REMOVED_CODE, closeReason);
  }
  match.spectators.clear();
  for (const player of match.players) if (player) player.socket = null;
}

function releaseRoomForCapacity(): void {
  if (matches.size < MAX_MATCHES) return;
  const emptyWaiting = [...matches.values()]
    .filter(match => match.phase === "waiting"
      && !sockets(match).some(socket => socket.readyState === WebSocket.OPEN))
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  const completed = [...matches.values()]
    .filter(match => match.phase === "finished")
    .sort((a, b) => (a.finishedAt ?? a.createdAt) - (b.finishedAt ?? b.createdAt))[0];
  const reclaimable = emptyWaiting ?? completed;
  if (reclaimable) evictMatch(reclaimable);
}

function send(socket: WebSocket, message: WarServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(match: WarMatch, message: WarServerMessage): void {
  const encoded = JSON.stringify(message);
  for (const socket of sockets(match)) {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < MAX_BUFFERED_BYTES) socket.send(encoded);
  }
}

function connected(player: PlayerSlot | null): boolean {
  return Boolean(player?.isBot || player?.socket?.readyState === WebSocket.OPEN);
}

function summary(match: WarMatch): WarMatchSummary {
  return {
    id: match.id,
    phase: match.phase,
    playerNames: match.players.map(player => player?.name ?? null),
    connected: match.players.map(connected),
    winner: match.war.result,
    createdAt: match.createdAt,
    settings: { ...match.settings },
  };
}

function lobbyMessage(): WarServerMessage {
  return {
    type: "lobby-state",
    matches: [...matches.values()]
      .filter(match => match.phase !== "finished")
      .map(summary)
      .sort((a, b) => b.createdAt - a.createdAt),
    history: matchHistory.slice(0, 50),
  };
}

export function completedWarRecord(match: Pick<WarMatch, "id" | "war" | "settings" | "players">): WarMatchRecord {
  if (match.war.result === null) throw new Error("Cannot record an unfinished War match");
  return {
    recordId: randomUUID(),
    matchId: match.id,
    completedAt: new Date().toISOString(),
    playerNames: match.players.map(player => player?.name ?? null),
    winner: match.war.result,
    settings: { ...match.settings },
    finalTick: match.war.simulation.tick,
    finalMetrics: match.war.simulation.colonies.map(colony => match.war.getMetrics(colony.id)),
    finalDoctrines: match.war.simulation.colonies.map(colony => match.war.getDoctrine(colony.id)),
  };
}

async function loadMatchHistory(): Promise<void> {
  if (!db) return;
  try {
    const rows = await db.select().from(warMatchRecordsTable).orderBy(desc(warMatchRecordsTable.completedAt)).limit(50);
    matchHistory.splice(0, matchHistory.length, ...rows.flatMap(row => {
      try { return [JSON.parse(row.data) as WarMatchRecord]; } catch { return []; }
    }));
  } catch (error) {
    console.warn("[war] Failed to load match history", error);
  }
}

async function recordCompletedMatch(match: WarMatch): Promise<void> {
  if (match.resultRecorded || match.war.result === null) return;
  match.resultRecorded = true;
  const record = completedWarRecord(match);
  matchHistory.unshift(record);
  matchHistory.splice(50);
  broadcastLobby();
  if (!db) return;
  try {
    await db.insert(warMatchRecordsTable).values({
      recordId: record.recordId,
      matchId: record.matchId,
      data: JSON.stringify(record),
      completedAt: new Date(record.completedAt),
    });
  } catch (error) {
    console.warn("[war] Failed to persist completed match", error);
  }
}

function broadcastLobby(): void {
  if (!activeWss) return;
  const encoded = JSON.stringify(lobbyMessage());
  for (const socket of activeWss.clients) {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < MAX_BUFFERED_BYTES) socket.send(encoded);
  }
}

function broadcastPlayers(match: WarMatch): void {
  const playerNames = new Set(match.players.flatMap(player => connected(player) ? [player!.name] : []));
  const spectatorNames = [...new Set([...match.spectators].flatMap(socket => {
    const name = socketNames.get(socket);
    return name && !playerNames.has(name) ? [name] : [];
  }))];
  broadcast(match, {
    type: "player-state",
    connected: match.players.map(connected),
    ready: match.players.map(player => Boolean(player?.ready)),
    names: match.players.map(player => player?.name ?? null),
    spectators: spectatorNames,
  });
}

function pheromoneWireValues(layer: Float32Array): number[] {
  return Array.from(layer, value => Math.round(value * 1_000) / 1_000);
}

export function snapshotWarMatch(match: Pick<WarMatch, "war" | "phase" | "settings">): WarSnapshot {
  const simulation = match.war.simulation;
  const grid = simulation.occupancy;
  if (!(grid instanceof DenseGrid)) throw new Error("Online War requires a bounded dense maze");
  return {
    tick: simulation.tick,
    phase: match.phase,
    winner: match.war.result,
    settings: { ...match.settings },
    grid: grid.cells.map(row => [...row]),
    foodSources: simulation.foodSources.map(source => ({ ...source })),
    colonies: simulation.colonies.map(colony => {
      if (!(colony.field instanceof DenseField)) throw new Error("Online War requires dense pheromone fields");
      return {
        id: colony.id,
        nestX: colony.nestX,
        nestY: colony.nestY,
        homePhero: pheromoneWireValues(colony.field.layer("home")),
        foodPhero: pheromoneWireValues(colony.field.layer("food")),
        receivedPhero: [...colony.received].map(([from, field]) => {
          if (!(field instanceof DenseField)) throw new Error("Online War requires dense provenance fields");
          return { from, home: pheromoneWireValues(field.layer("home")), food: pheromoneWireValues(field.layer("food")) };
        }),
        ants: colony.ants.map(ant => {
          const runtime = match.war.getAntSnapshot(ant);
          if (!runtime) throw new Error("War ant is missing runtime state");
          return {
            id: runtime.id,
            x: ant.x,
            y: ant.y,
            tx: ant.tx,
            ty: ant.ty,
            hasFood: ant.hasFood,
            phase: runtime.phase,
            energy: runtime.energy,
            role: runtime.role,
            doctrineVersion: runtime.doctrineVersion,
          };
        }),
        metrics: match.war.getMetrics(colony.id),
        doctrine: match.war.getDoctrine(colony.id),
      };
    }),
  };
}

function broadcastSnapshot(match: WarMatch): void {
  broadcast(match, { type: "snapshot", snapshot: snapshotWarMatch(match) });
}

function playerIndex(match: WarMatch, socket: WebSocket): number {
  return match.players.findIndex(player => player?.socket === socket);
}

function leaveMatch(socket: WebSocket): void {
  const match = socketMatches.get(socket);
  if (!match) return;
  match.spectators.delete(socket);
  const colonyId = playerIndex(match, socket);
  if (colonyId >= 0) {
    if (match.phase === "waiting") match.players[colonyId] = null;
    else match.players[colonyId]!.socket = null;
  }
  socketMatches.delete(socket);
  socketNames.delete(socket);
  broadcastPlayers(match);
  if (!sockets(match).some(client => client.readyState === WebSocket.OPEN)) match.emptySince = Date.now();
  broadcastLobby();
}

function enterMatch(socket: WebSocket, match: WarMatch, name: string, reconnectToken?: string): void {
  const previousMatch = socketMatches.get(socket);
  if (previousMatch && previousMatch !== match) leaveMatch(socket);
  else match.spectators.delete(socket);
  socketMatches.set(socket, match);
  socketNames.set(socket, name);
  match.emptySince = null;

  let colonyId = playerIndex(match, socket);
  if (colonyId < 0 && reconnectToken) {
    colonyId = match.players.findIndex(player => player?.token === reconnectToken && !player.isBot);
  }
  if (colonyId >= 0) {
    const previousSocket = match.players[colonyId]!.socket;
    if (previousSocket && previousSocket !== socket) previousSocket.close(WAR_RECONNECTED_ELSEWHERE_CODE, "Reconnected elsewhere");
    match.players[colonyId]!.socket = socket;
    match.players[colonyId]!.name = name;
  } else match.spectators.add(socket);

  send(socket, {
    type: "joined",
    matchId: match.id,
    colonyId: colonyId >= 0 ? colonyId : null,
    reconnectToken: colonyId >= 0 ? match.players[colonyId]!.token : undefined,
    phase: match.phase,
  });
  send(socket, { type: "snapshot", snapshot: snapshotWarMatch(match) });
  broadcastPlayers(match);
  broadcastLobby();
}

function claimSeat(socket: WebSocket, match: WarMatch, colonyId: number): void {
  if (match.phase !== "waiting" || (colonyId !== 0 && colonyId !== 1) || playerIndex(match, socket) >= 0) {
    send(socket, { type: "error", message: "That seat cannot be claimed" });
    return;
  }
  const existing = match.players[colonyId];
  if (existing) {
    send(socket, { type: "error", message: `Colony ${colonyId + 1} is already occupied` });
    return;
  }
  match.spectators.delete(socket);
  match.players[colonyId] = {
    token: randomUUID(),
    socket,
    ready: false,
    name: socketNames.get(socket) ?? `Player ${colonyId + 1}`,
  };
  send(socket, {
    type: "joined",
    matchId: match.id,
    colonyId,
    reconnectToken: match.players[colonyId]!.token,
    phase: match.phase,
  });
  broadcastPlayers(match);
  broadcastLobby();
}

function standUp(socket: WebSocket, match: WarMatch): void {
  const colonyId = playerIndex(match, socket);
  if (match.phase !== "waiting" || colonyId < 0 || match.players[colonyId]?.isBot) {
    send(socket, { type: "error", message: "You can only stand up before the match starts" });
    return;
  }
  match.players[colonyId] = null;
  match.spectators.add(socket);
  send(socket, { type: "joined", matchId: match.id, colonyId: null, phase: match.phase });
  broadcastPlayers(match);
  broadcastLobby();
}

function resetMatch(match: WarMatch): void {
  const doctrines = match.players.map(player => player?.isBot
    ? randomOpponentDoctrine(match.settings.masterSeed, match.settings.topology)
    : DEFAULT_DOCTRINE);
  match.war = makeWar(match.settings, doctrines);
  match.phase = "waiting";
  match.finishedAt = null;
  match.simulationAccumulator = 0;
  match.resultRecorded = false;
  for (const player of match.players) if (player) player.ready = Boolean(player.isBot);
  if (match.players.some(player => player?.isBot)) {
    for (const player of match.players) if (player) player.ready = true;
    match.phase = "running";
  }
  broadcastPlayers(match);
  broadcastSnapshot(match);
  broadcastLobby();
}

function parseMessage(raw: WebSocket.RawData): WarClientMessage | null {
  try {
    const value = JSON.parse(raw.toString()) as unknown;
    return value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string"
      ? value as WarClientMessage
      : null;
  } catch {
    return null;
  }
}

function handleMessage(socket: WebSocket, message: WarClientMessage): void {
  if (message.type === "create-room") {
    const name = cleanName(message.playerName);
    if (!name) return send(socket, { type: "error", message: "Enter a player name" });
    if (!validOnlineWarSettings(message.settings)) {
      return send(socket, { type: "error", message: "Match settings are outside the allowed range" });
    }
    if (roomCreatedBySocket.has(socket)) {
      return send(socket, { type: "error", message: "This connection has already created a match" });
    }
    releaseRoomForCapacity();
    if (matches.size >= MAX_MATCHES) return send(socket, { type: "error", message: "The server is at match capacity" });
    roomCreatedBySocket.add(socket);
    if (!message.randomOpponent) {
      leaveMatch(socket);
      const { match, token } = createWaitingMatch(socket, name, message.settings);
      send(socket, { type: "room-created", matchId: match.id, reconnectToken: token });
      broadcastLobby();
      return;
    }
    leaveMatch(socket);
    const { match, token } = createWaitingMatch(socket, name, message.settings);
    match.players[1] = { token: randomUUID(), socket: null, ready: true, name: "Random Colony", isBot: true };
    match.players[0]!.ready = true;
    match.war = makeWar(match.settings, [DEFAULT_DOCTRINE, randomOpponentDoctrine(match.settings.masterSeed, match.settings.topology)]);
    match.phase = "running";
    enterMatch(socket, match, name, token);
    return;
  }

  if (message.type === "join-room") {
    const name = cleanName(message.playerName);
    if (!name) return send(socket, { type: "error", message: "Enter a player name" });
    const match = matches.get(message.matchId.trim().toUpperCase());
    if (!match) return send(socket, { type: "error", message: "Match not found. Check the room code." });
    enterMatch(socket, match, name, message.reconnectToken);
    return;
  }

  const match = socketMatches.get(socket);
  if (!match) return send(socket, { type: "error", message: "Create or join a match first" });
  if (message.type === "claim-seat") return claimSeat(socket, match, message.colonyId);
  if (message.type === "stand-up") return standUp(socket, match);
  const colonyId = playerIndex(match, socket);
  if (colonyId < 0) return send(socket, { type: "error", message: "Only players can control a colony" });

  if (message.type === "ready") {
    if (match.phase !== "waiting") return;
    match.players[colonyId]!.ready = true;
    if (match.players.every(player => player?.ready && connected(player))) match.phase = "running";
    broadcastPlayers(match);
    broadcastSnapshot(match);
    broadcastLobby();
  } else if (message.type === "set-doctrine") {
    if (!validWarDoctrine(message.doctrine)) {
      return send(socket, { type: "error", message: "Doctrine values are outside the allowed range" });
    }
    match.war.setDoctrine(colonyId, normalizeWarDoctrine(message.doctrine, match.settings.topology));
    if (match.phase === "waiting") broadcastSnapshot(match);
  } else if (message.type === "reset" && match.phase === "finished") {
    resetMatch(match);
  }
}

function advanceMatches(): void {
  const now = Date.now();
  for (const match of matches.values()) {
    try {
      if ((match.finishedAt && now - match.finishedAt > EMPTY_ROOM_TTL_MS)
          || (match.emptySince && now - match.emptySince > EMPTY_ROOM_TTL_MS)) {
        evictMatch(match);
        continue;
      }
      if (match.phase !== "running") continue;
      match.simulationAccumulator += match.settings.stepsPerSecond / CLOCK_RATE;
      while (match.simulationAccumulator >= 1 && match.war.result === null) {
        match.war.step();
        match.simulationAccumulator--;
      }
      if (match.war.result !== null) {
        match.phase = "finished";
        match.finishedAt = now;
        broadcastPlayers(match);
        broadcastSnapshot(match);
        void recordCompletedMatch(match);
        continue;
      }
      match.snapshotAccumulator += SNAPSHOT_RATE / CLOCK_RATE;
      if (match.snapshotAccumulator >= 1) {
        match.snapshotAccumulator--;
        if (sockets(match).length > 0) broadcastSnapshot(match);
      }
    } catch (error) {
      console.error(`[war] Match ${match.id} failed and was removed`, error);
      try {
        broadcast(match, { type: "error", message: "This match stopped because of a server error" });
        evictMatch(match, "Match stopped because of a server error");
      } catch (cleanupError) {
        console.error(`[war] Failed to clean up match ${match.id}`, cleanupError);
        matches.delete(match.id);
      }
    }
  }
}

export async function attachWarWs(server: Server, allowedOrigins: string[], requireOrigin = false): Promise<void> {
  await loadMatchHistory();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1_024 });
  activeWss = wss;
  unregisterUpgradeRoute = registerWebSocketRoute(server, "/api/war/ws", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
  });
  clock = setInterval(advanceMatches, 1_000 / CLOCK_RATE);

  wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    if (!isAllowedWebSocketOrigin(request.headers.origin, allowedOrigins, requireOrigin)) {
      socket.close(1008, "Origin not allowed");
      return;
    }
    let messageCount = 0;
    const rateWindow = setInterval(() => { messageCount = 0; }, 1_000);
    send(socket, lobbyMessage());
    socket.on("message", raw => {
      messageCount++;
      if (messageCount > MAX_MESSAGES_HARD_LIMIT) {
        socket.close(1008, "Rate limit exceeded");
        return;
      }
      const overLimit = messageCount > MAX_MESSAGES_PER_SECOND;
      const message = parseMessage(raw);
      if (!message) {
        if (overLimit) socket.close(1008, "Rate limit exceeded");
        else send(socket, { type: "error", message: "Invalid JSON message" });
        return;
      }
      if (overLimit) {
        if (message.type === "set-doctrine") return;
        socket.close(1008, "Rate limit exceeded");
        return;
      }
      try {
        handleMessage(socket, message);
      } catch {
        send(socket, { type: "error", message: "Malformed message" });
      }
    });
    socket.on("close", () => {
      clearInterval(rateWindow);
      leaveMatch(socket);
    });
    socket.on("error", () => {
      clearInterval(rateWindow);
      leaveMatch(socket);
    });
  });
  heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }
  }, 25_000);
  console.log("[ws] War WebSocket server attached at /api/war/ws");
}

export function shutdownWar(): void {
  if (clock) clearInterval(clock);
  if (heartbeat) clearInterval(heartbeat);
  clock = null;
  heartbeat = null;
  for (const socket of activeWss?.clients ?? []) socket.close(1001, "Server restarting");
  unregisterUpgradeRoute?.();
  activeWss?.close();
  activeWss = null;
  unregisterUpgradeRoute = null;
  matches.clear();
  socketMatches.clear();
  socketNames.clear();
  matchHistory.splice(0);
}
