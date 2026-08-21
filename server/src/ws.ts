// WebSocket layer + world persistence for infinite mode.
//
// Persistence modes:
// - DATABASE_URL set   → world snapshot auto-saves to Postgres every 60s and
//                        on shutdown; colony deaths are recorded for the
//                        all-time leaderboard. This is the deployed
//                        shared-world configuration.
// - DATABASE_URL unset → state lives in memory for the session. The seed
//                        file (seeds/infinite-world.json) is still loaded on
//                        boot so there is a maze to look at.

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { eq, desc } from "drizzle-orm";
import { db, worldStateTable, colonyRecordsTable } from "./db";
import { InfiniteSimulation, type PersistedColony, type PersistedWorld } from "./sim";
import { isAllowedWebSocketOrigin } from "./security";
import {
  foodUpsertMessage,
  makeIdempotentCleanup,
  removeFoodAndCreateMessage,
  shouldSendVolatileFrame,
  TokenBucket,
} from "./transport";
import { calculateFixedSteps } from "./fixed-step";
import { ThrottledFailureReporter } from "./degraded-status";
import { performance } from "node:perf_hooks";
import { TICKS_PER_SEC } from "../../shared/infinite-contract";
import type { LeaderboardEntry } from "../../shared/infinite-contract";

export const sim = new InfiniteSimulation();

const WORLD_KEY = "infinite";
const __dirname_ = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname_, "../seeds/infinite-world.json");
const MAX_COORD = 100_000;
const MAX_COLONIES = 100;
const MAX_FOOD_SOURCES = 2_000;
const MAX_WALLS = 100_000;
const MAX_MESSAGES_PER_SECOND = 30;
const FOOD_EDIT_BURST = 10;
const FOOD_EDITS_PER_SECOND = 5;
const MAX_VOLATILE_BUFFER_BYTES = 512 * 1024;
const SIM_STEP_MS = 1_000 / TICKS_PER_SEC;
const MAX_CATCH_UP_STEPS = 5;

type WorldData = {
  version?: number;
  nextColonyId?: number;
  walls?: string[];
  colonies?: (Partial<PersistedColony> & {
    nestX: number;
    nestY: number;
    params: Record<string, unknown>;
  })[];
  foodSources?: { x: number; y: number; remaining: number; total: number }[];
};

function applyWorldData(data: WorldData) {
  if (data.version === 1 && Number.isSafeInteger(data.nextColonyId)) {
    sim.restorePersistence(data as PersistedWorld);
    return;
  }

  // Backward compatibility for seeds and snapshots created before v1.
  for (const w of data.walls ?? []) sim.walls.add(w);
  for (const c of data.colonies ?? []) {
    if (Number.isSafeInteger(c.id) && c.id! >= 0) {
      sim.restoreColony({
        id: c.id!,
        nestX: c.nestX,
        nestY: c.nestY,
        params: c.params as never,
        foodCollected: Number.isFinite(c.foodCollected) ? Math.max(0, c.foodCollected!) : 0,
        ageTicks: Number.isFinite(c.ageTicks) ? Math.max(0, c.ageTicks!) : 0,
      });
    } else {
      sim.addColony(c.nestX, c.nestY, c.params as never);
    }
  }
  if (Number.isSafeInteger(data.nextColonyId) && data.nextColonyId! >= 0) {
    sim.restoreNextColonyId(data.nextColonyId!);
  }
  for (const f of data.foodSources ?? []) {
    if (f.remaining <= 0) continue;
    const source = sim.addFood(f.x, f.y, f.remaining);
    source.total = Math.max(source.remaining, f.total);
  }
}

async function loadWorld() {
  // 1. Try DB first — persists across all restarts and redeployments
  if (db) {
    try {
      const [row] = await db
        .select()
        .from(worldStateTable)
        .where(eq(worldStateTable.key, WORLD_KEY))
        .limit(1);
      if (row) {
        const data = JSON.parse(row.data) as WorldData;
        applyWorldData(data);
        console.log(
          `[world] Loaded from database: ${sim.walls.size} walls, ${sim.colonies.length} colonies, ${sim.foodSources.length} food sources`
        );
        return;
      }
    } catch (e) {
      console.warn("[world] DB load failed — falling back to seed file", e);
    }
  }

  // 2. No DB row yet (or no DB at all) — load seed file
  if (existsSync(SEED_PATH)) {
    try {
      const data = JSON.parse(readFileSync(SEED_PATH, "utf8")) as WorldData;
      applyWorldData(data);
      console.log(
        `[world] Loaded from seed file: ${sim.walls.size} walls, ${sim.colonies.length} colonies, ${sim.foodSources.length} food sources`
      );
      await saveWorld(); // no-op without DB; persists immediately with DB
    } catch (e) {
      console.warn("[world] Failed to load seed file — starting blank", e);
    }
  } else {
    console.log("[world] No saved state or seed file — starting blank infinite world");
  }
}

async function saveWorld() {
  if (!db) return; // in-memory mode: nothing to do
  try {
    const data = JSON.stringify(sim.serializePersistence());
    await db
      .insert(worldStateTable)
      .values({ key: WORLD_KEY, data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: worldStateTable.key,
        set: { data, updatedAt: new Date() },
      });
  } catch (e) {
    console.warn("[world] Failed to save world state to DB", e);
  }
}

// ── Broadcast infrastructure ──────────────────────────────────────────────────

const clients = new Set<WebSocket>();
const liveClients = new WeakSet<WebSocket>();

async function handleColonyDeath(colony: { id: number; name: string; lifespanTicks: number }) {
  if (db) {
    try {
      await db.insert(colonyRecordsTable).values({
        name: colony.name,
        lifespanTicks: colony.lifespanTicks,
      });
      console.log(`[world] Colony death recorded: ${colony.name} (${colony.lifespanTicks} ticks)`);
    } catch (e) {
      console.warn("[world] Failed to write colony death record to DB", e);
    }
  }
  broadcast({ type: "colonyDied", colonyId: colony.id, name: colony.name, lifespanTicks: colony.lifespanTicks });
}

// Run the simulation against elapsed monotonic time. A capped accumulator
// catches up ordinary timer delays without allowing an unbounded spiral after
// a long process pause.
let lastSimTimeMs = performance.now();
let simRemainderMs = 0;
const simInterval = setInterval(() => {
  const nowMs = performance.now();
  const elapsedMs = nowMs - lastSimTimeMs;
  lastSimTimeMs = nowMs;
  const fixedStep = calculateFixedSteps(
    simRemainderMs,
    elapsedMs,
    SIM_STEP_MS,
    MAX_CATCH_UP_STEPS,
  );
  simRemainderMs = fixedStep.remainderMs;

  for (let i = 0; i < fixedStep.steps; i++) {
    const dead = sim.step();
    for (const colony of dead) void handleColonyDeath(colony);
  }
}, 10);

// Broadcast tick at 10 fps
const tickInterval = setInterval(() => {
  if (clients.size === 0) return;
  const msg = JSON.stringify({ type: "tick", ...sim.serializeTick() });
  for (const ws of clients) {
    if (
      ws.readyState === WebSocket.OPEN &&
      shouldSendVolatileFrame(ws.bufferedAmount, MAX_VOLATILE_BUFFER_BYTES)
    ) ws.send(msg);
  }
}, 100);

// Broadcast pheromones at ~2 fps
const pheroInterval = setInterval(() => {
  if (clients.size === 0) return;
  const pheroData = sim.serializePhero();
  if (!pheroData.some(c => c.chunks.length > 0)) return;
  const msg = JSON.stringify({ type: "phero", colonies: pheroData });
  for (const ws of clients) {
    if (
      ws.readyState === WebSocket.OPEN &&
      shouldSendVolatileFrame(ws.bufferedAmount, MAX_VOLATILE_BUFFER_BYTES)
    ) ws.send(msg);
  }
}, 500);

// Auto-save to DB every 60 seconds (no-op without DATABASE_URL)
const saveInterval = setInterval(() => { void saveWorld(); }, 60_000);
const heartbeatInterval = setInterval(() => {
  for (const ws of clients) {
    if (!liveClients.has(ws)) {
      ws.terminate();
      continue;
    }
    liveClients.delete(ws);
    ws.ping();
  }
}, 30_000);

function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function integer(value: unknown): number | null {
  return Number.isSafeInteger(value) ? value as number : null;
}

function coordinate(value: unknown): number | null {
  const result = integer(value);
  return result !== null && Math.abs(result) <= MAX_COORD ? result : null;
}

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function handleMessage(
  ws: WebSocket,
  ownedColonies: Set<number>,
  foodEditLimiter: TokenBucket,
  msg: Record<string, unknown>,
) {
  const x = coordinate(msg["x"]), y = coordinate(msg["y"]);
  switch (msg["type"]) {
    case "toggleWall": {
      if (x === null || y === null || (!sim.walls.has(`${x},${y}`) && sim.walls.size >= MAX_WALLS)) return;
      sim.toggleWall(x, y);
      const isWall = !sim.isOpen(x, y);
      broadcast({ type: "wallUpdate", x, y, v: isWall ? 0 : 1 });
      break;
    }
    case "placeFood": {
      if (x === null || y === null || !foodEditLimiter.tryTake()) return;
      const existing = sim.foodSources.find(source => source.x === x && source.y === y);
      if (!existing && sim.foodSources.length >= MAX_FOOD_SOURCES) return;
      const units = Math.round(numberInRange(msg["units"], 500, 1, 10_000));
      const removedWall = sim.walls.has(`${x},${y}`);
      const foodSource = sim.addFood(x, y, units);
      if (removedWall) broadcast({ type: "wallUpdate", x, y, v: 1 });
      broadcast(foodUpsertMessage(foodSource));
      break;
    }
    case "removeFood": {
      if (x === null || y === null || !foodEditLimiter.tryTake()) return;
      const delta = removeFoodAndCreateMessage(sim, x, y);
      if (!delta) return;
      broadcast(delta);
      break;
    }
    case "placeColony": {
      if (x === null || y === null || sim.colonies.length >= MAX_COLONIES) return;
      const removedWall = sim.walls.has(`${x},${y}`);
      const p = record(msg["params"]);
      const rawName = typeof p["name"] === "string" ? p["name"].trim() : "Colony";
      const colony = sim.addColony(x, y, {
        numAnts: Math.round(numberInRange(p["numAnts"], 20, 1, 100)),
        evapRate: numberInRange(p["evapRate"], 0.005, 0.0001, 0.1),
        trailPower: numberInRange(p["trailPower"], 5, 0.1, 10),
        tankMax: Math.round(numberInRange(p["tankMax"], 6400, 100, 20_000)),
        cautionary: typeof p["cautionary"] === "boolean" ? p["cautionary"] : false,
        name: (rawName || "Colony").slice(0, 40),
      });
      const colonyInfo = colony.info();
      ownedColonies.add(colony.id);
      if (removedWall) broadcast({ type: "wallUpdate", x, y, v: 1 });
      broadcast({ type: "colonyAdded", colony: colonyInfo });
      ws.send(JSON.stringify({ type: "colonyAssigned", colony: colonyInfo }));
      break;
    }
    case "removeColony": {
      const id = integer(msg["id"]);
      if (id === null || !ownedColonies.has(id)) return;
      sim.removeColony(id);
      ownedColonies.delete(id);
      broadcast({ type: "colonyRemoved", id });
      break;
    }
  }
}

let activeWss: WebSocketServer | null = null;

export async function attachInfiniteWs(
  server: Server,
  allowedOrigins: string[],
  requireOrigin = false,
) {
  await loadWorld();

  const wss = new WebSocketServer({ server, path: "/api/infinite/ws", maxPayload: 16 * 1024 });
  activeWss = wss;

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const origin = req.headers.origin;
    if (!isAllowedWebSocketOrigin(origin, allowedOrigins, requireOrigin)) {
      ws.close(1008, "Origin not allowed");
      return;
    }
    console.log(`[ws] Client connected: ${req.url}`);
    clients.add(ws);
    liveClients.add(ws);
    let messageCount = 0;
    const ownedColonies = new Set<number>();
    const foodEditLimiter = new TokenBucket(FOOD_EDIT_BURST, FOOD_EDITS_PER_SECOND);
    const rateWindow = setInterval(() => { messageCount = 0; }, 1_000);
    const cleanup = makeIdempotentCleanup(() => {
      clearInterval(rateWindow);
      clients.delete(ws);
      liveClients.delete(ws);
    });
    ws.on("pong", () => liveClients.add(ws));

    ws.send(JSON.stringify({ type: "init", ...sim.serializeInit() }));

    ws.on("message", (raw) => {
      if (++messageCount > MAX_MESSAGES_PER_SECOND) {
        ws.close(1008, "Rate limit exceeded");
        return;
      }
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        handleMessage(ws, ownedColonies, foodEditLimiter, msg);
      } catch (e) {
        console.warn("[ws] Message parse error", e);
      }
    });

    ws.on("close", () => {
      cleanup();
      console.log("[ws] Client disconnected");
    });

    ws.on("error", (e) => {
      console.error("[ws] Error", e);
      cleanup();
    });
  });

  console.log("[ws] Infinite WebSocket server attached at /api/infinite/ws");
}

export async function shutdownInfinite() {
  clearInterval(simInterval);
  clearInterval(tickInterval);
  clearInterval(pheroInterval);
  clearInterval(saveInterval);
  clearInterval(heartbeatInterval);
  await saveWorld();
  for (const ws of clients) ws.close(1001, "Server restarting");
  activeWss?.close();
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

const leaderboardDbStatus = new ThrottledFailureReporter(
  60_000,
  error => console.warn(
    "[leaderboard] Failed to load historical records — returning live colonies only",
    error,
  ),
  () => console.info("[leaderboard] Historical database records available again"),
);

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  let dead: (typeof colonyRecordsTable.$inferSelect)[] = [];
  if (db) {
    try {
      dead = await db
        .select()
        .from(colonyRecordsTable)
        .orderBy(desc(colonyRecordsTable.lifespanTicks))
        .limit(50);
      leaderboardDbStatus.reportSuccess();
    } catch (error) {
      leaderboardDbStatus.reportFailure(error);
    }
  }

  const live: LeaderboardEntry[] = sim.colonies.map(c => ({
    name: c.params.name,
    lifespanTicks: sim.tick - c.bornAtTick,
    alive: true,
  }));

  const deadEntries: LeaderboardEntry[] = dead.map(d => ({
    name: d.name,
    lifespanTicks: d.lifespanTicks,
    alive: false,
  }));

  return [...live, ...deadEntries]
    .sort((a, b) => b.lifespanTicks - a.lifespanTicks)
    .slice(0, 20);
}
