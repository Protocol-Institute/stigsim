import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import WebSocket from "ws";
import { DEFAULT_ONLINE_WAR_SETTINGS } from "../../shared/war-contract";

type Message = Record<string, unknown>;
const TEST_ORIGIN = "http://test.local";

class MessageInbox {
  readonly messages: Message[] = [];

  constructor(readonly ws: WebSocket) {
    ws.on("message", raw => this.messages.push(JSON.parse(raw.toString()) as Message));
  }

  async waitFor(predicate: (message: Message) => boolean, startAt = 0, timeoutMs = 3_000): Promise<Message> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.messages.slice(startAt).find(predicate);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for War message; received ${JSON.stringify(this.messages.slice(startAt))}`);
  }
}

async function connect(url: string): Promise<MessageInbox> {
  const ws = new WebSocket(url, { origin: TEST_ORIGIN });
  const inbox = new MessageInbox(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  await inbox.waitFor(message => message.type === "lobby-state");
  return inbox;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test("two players and a spectator can complete the authoritative lobby flow", async t => {
  const { attachWarWs, shutdownWar } = await import("./war");
  const server = createServer();
  await attachWarWs(server, [TEST_ORIGIN], true);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  assert(address && typeof address === "object");
  const url = `ws://127.0.0.1:${address.port}/api/war/ws`;
  const first = await connect(url);
  const second = await connect(url);
  const spectator = await connect(url);

  t.after(async () => {
    first.ws.close();
    second.ws.close();
    spectator.ws.close();
    shutdownWar();
    await closeServer(server);
  });

  const firstStart = first.messages.length;
  first.ws.send(JSON.stringify({
    type: "create-room",
    playerName: "Alpha",
    settings: { ...DEFAULT_ONLINE_WAR_SETTINGS, stepsPerSecond: 60 },
  }));
  const created = await first.waitFor(message => message.type === "room-created", firstStart);
  const matchId = created.matchId as string;
  assert.equal(first.messages.slice(firstStart).some(message => message.type === "joined"), false);
  const listed = await first.waitFor(message => message.type === "lobby-state" && ((message.matches as Array<{ id: string }>).some(match => match.id === matchId)), firstStart);
  assert(listed);
  first.ws.send(JSON.stringify({ type: "join-room", matchId, playerName: "Alpha", reconnectToken: created.reconnectToken }));
  const firstJoined = await first.waitFor(message => message.type === "joined", firstStart);
  assert.equal(firstJoined.colonyId, 0);
  assert.equal(typeof firstJoined.reconnectToken, "string");

  const secondStart = second.messages.length;
  second.ws.send(JSON.stringify({ type: "join-room", matchId, playerName: "Beta" }));
  const secondEntered = await second.waitFor(message => message.type === "joined", secondStart);
  assert.equal(secondEntered.colonyId, null);
  second.ws.send(JSON.stringify({ type: "claim-seat", colonyId: 1 }));
  const secondJoined = await second.waitFor(message => message.type === "joined" && message.colonyId === 1, secondStart);
  assert.equal(secondJoined.colonyId, 1);

  const spectatorStart = spectator.messages.length;
  spectator.ws.send(JSON.stringify({ type: "join-room", matchId, playerName: "Observer" }));
  const spectatorJoined = await spectator.waitFor(message => message.type === "joined", spectatorStart);
  assert.equal(spectatorJoined.colonyId, null);

  const deniedStart = spectator.messages.length;
  spectator.ws.send(JSON.stringify({
    type: "set-doctrine",
    doctrine: { evapRate: 0.005, trailPower: 2.5, tankMax: 8_000, cautionary: false },
  }));
  const denied = await spectator.waitFor(message => message.type === "error", deniedStart);
  assert.match(denied.message as string, /Only players/);

  first.ws.send(JSON.stringify({ type: "ready" }));
  second.ws.send(JSON.stringify({ type: "ready" }));
  const running = await first.waitFor(
    message => message.type === "snapshot" && (message.snapshot as { phase?: string }).phase === "running",
    firstStart,
  );
  const runningTick = (running.snapshot as { tick: number }).tick;
  const advanced = await first.waitFor(
    message => message.type === "snapshot" && (message.snapshot as { tick?: number }).tick! > runningTick,
    firstStart,
  );
  assert.equal((advanced.snapshot as { phase: string }).phase, "running");

  const malformedStart = first.messages.length;
  first.ws.send(JSON.stringify({ type: "join-room", matchId: null, playerName: "Oops" }));
  const malformed = await first.waitFor(message => message.type === "error", malformedStart);
  assert.equal(malformed.message, "Malformed message");
  assert.equal(first.ws.readyState, WebSocket.OPEN);

  const disconnectStart = first.messages.length;
  second.ws.close();
  const disconnectedPlayers = await first.waitFor(message => message.type === "player-state" && (message.connected as boolean[])[1] === false, disconnectStart);
  assert.deepEqual(disconnectedPlayers.names, ["Alpha", "Beta"]);
  const disconnectedLobby = await first.waitFor(message => {
    if (message.type !== "lobby-state") return false;
    const match = (message.matches as Array<{ id: string; connected: boolean[] }>).find(item => item.id === matchId);
    return match?.connected[1] === false;
  }, disconnectStart);
  const activeMatch = (disconnectedLobby.matches as Array<{ id: string; playerNames: Array<string | null> }>).find(match => match.id === matchId);
  assert.deepEqual(activeMatch?.playerNames, ["Alpha", "Beta"]);
});

test("a creator holds their lobby seat until disconnecting before ready", async t => {
  const { attachWarWs, shutdownWar } = await import("./war");
  const server = createServer();
  await attachWarWs(server, [TEST_ORIGIN], true);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  assert(address && typeof address === "object");
  const url = `ws://127.0.0.1:${address.port}/api/war/ws`;
  const creator = await connect(url);
  const replacement = await connect(url);

  t.after(async () => {
    creator.ws.close();
    replacement.ws.close();
    shutdownWar();
    await closeServer(server);
  });

  const createStart = creator.messages.length;
  creator.ws.send(JSON.stringify({
    type: "create-room",
    playerName: "Alpha",
    settings: DEFAULT_ONLINE_WAR_SETTINGS,
  }));
  const created = await creator.waitFor(message => message.type === "room-created", createStart);
  const matchId = created.matchId as string;
  const reserved = await replacement.waitFor(message => {
    if (message.type !== "lobby-state") return false;
    const match = (message.matches as Array<{ id: string; connected: boolean[]; playerNames: Array<string | null> }>).find(item => item.id === matchId);
    return match?.connected[0] === true;
  });
  const reservedMatch = (reserved.matches as Array<{ id: string; connected: boolean[]; playerNames: Array<string | null> }>).find(match => match.id === matchId);
  assert.deepEqual(reservedMatch?.playerNames, ["Alpha", null]);

  const lobbyStart = replacement.messages.length;
  creator.ws.close();
  const released = await replacement.waitFor(message => {
    if (message.type !== "lobby-state") return false;
    const match = (message.matches as Array<{ id: string; connected: boolean[]; playerNames: Array<string | null> }>).find(item => item.id === matchId);
    return match?.connected[0] === false;
  }, lobbyStart);
  const releasedMatch = (released.matches as Array<{ id: string; connected: boolean[]; playerNames: Array<string | null> }>).find(match => match.id === matchId);
  assert.deepEqual(releasedMatch?.playerNames, [null, null]);

  const joinStart = replacement.messages.length;
  replacement.ws.send(JSON.stringify({ type: "join-room", matchId, playerName: "Beta" }));
  const entered = await replacement.waitFor(message => message.type === "joined", joinStart);
  assert.equal(entered.colonyId, null);
  replacement.ws.send(JSON.stringify({ type: "claim-seat", colonyId: 0 }));
  const joined = await replacement.waitFor(message => message.type === "joined" && message.colonyId === 0, joinStart);
  assert.equal(joined.colonyId, 0);
});

test("entering is spectator-only and a player can stand up before starting", async t => {
  const { attachWarWs, shutdownWar } = await import("./war");
  const server = createServer();
  await attachWarWs(server, [TEST_ORIGIN], true);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  assert(address && typeof address === "object");
  const url = `ws://127.0.0.1:${address.port}/api/war/ws`;
  const creator = await connect(url);
  const visitor = await connect(url);

  t.after(async () => {
    creator.ws.close();
    visitor.ws.close();
    shutdownWar();
    await closeServer(server);
  });

  const createStart = creator.messages.length;
  creator.ws.send(JSON.stringify({ type: "create-room", playerName: "Alpha", settings: DEFAULT_ONLINE_WAR_SETTINGS }));
  const created = await creator.waitFor(message => message.type === "room-created", createStart);
  const matchId = created.matchId as string;

  const enterStart = visitor.messages.length;
  visitor.ws.send(JSON.stringify({ type: "join-room", matchId, playerName: "Observer" }));
  const entered = await visitor.waitFor(message => message.type === "joined", enterStart);
  assert.equal(entered.colonyId, null);

  visitor.ws.send(JSON.stringify({ type: "claim-seat", colonyId: 1 }));
  const seated = await visitor.waitFor(message => message.type === "joined" && message.colonyId === 1, enterStart);
  assert.equal(typeof seated.reconnectToken, "string");
  const seatedState = await visitor.waitFor(message => message.type === "player-state" && (message.connected as boolean[])[1] === true, enterStart);
  assert.deepEqual(seatedState.spectators, []);

  const standStart = visitor.messages.length;
  visitor.ws.send(JSON.stringify({ type: "stand-up" }));
  const stoodUp = await visitor.waitFor(message => message.type === "joined", standStart);
  assert.equal(stoodUp.colonyId, null);
  assert.equal("reconnectToken" in stoodUp, false);

  const playerState = await visitor.waitFor(message => message.type === "player-state", standStart);
  assert.deepEqual(playerState.connected, [true, false]);
  assert.deepEqual(playerState.spectators, ["Observer"]);
});

test("a burst of doctrine updates is dropped without disconnecting the player", async t => {
  const { attachWarWs, shutdownWar } = await import("./war");
  const server = createServer();
  await attachWarWs(server, [TEST_ORIGIN], true);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  assert(address && typeof address === "object");
  const player = await connect(`ws://127.0.0.1:${address.port}/api/war/ws`);
  t.after(async () => {
    player.ws.close();
    shutdownWar();
    await closeServer(server);
  });

  const start = player.messages.length;
  player.ws.send(JSON.stringify({ type: "create-room", playerName: "Alpha", settings: DEFAULT_ONLINE_WAR_SETTINGS }));
  const created = await player.waitFor(message => message.type === "room-created", start);
  player.ws.send(JSON.stringify({ type: "join-room", matchId: created.matchId, playerName: "Alpha", reconnectToken: created.reconnectToken }));
  await player.waitFor(message => message.type === "joined", start);

  const doctrine = { evapRate: 0.005, trailPower: 5, tankMax: 6_400, cautionary: false };
  for (let index = 0; index < 40; index++) player.ws.send(JSON.stringify({ type: "set-doctrine", doctrine }));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(player.ws.readyState, WebSocket.OPEN);
});
