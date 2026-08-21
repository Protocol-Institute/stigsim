import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import WebSocket from "ws";

type Message = Record<string, unknown>;

const TEST_ORIGIN = "http://test.local";

class MessageInbox {
  readonly messages: Message[] = [];

  constructor(readonly ws: WebSocket) {
    ws.on("message", raw => {
      this.messages.push(JSON.parse(raw.toString()) as Message);
    });
  }

  async waitFor(
    predicate: (message: Message) => boolean,
    startAt = 0,
    timeoutMs = 2_000,
  ): Promise<Message> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.messages.slice(startAt).find(predicate);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for WebSocket message; received ${JSON.stringify(this.messages.slice(startAt))}`);
  }
}

async function connect(url: string): Promise<MessageInbox> {
  const ws = new WebSocket(url, { origin: TEST_ORIGIN });
  const inbox = new MessageInbox(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  await inbox.waitFor(message => message.type === "init");
  return inbox;
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

test("two clients share edits without claiming or deleting each other's colony", async t => {
  // The integration test must never read or write a developer's configured DB.
  delete process.env.DATABASE_URL;
  const { attachInfiniteWs, shutdownInfinite } = await import("./ws");
  const server = createServer();
  await attachInfiniteWs(server, [TEST_ORIGIN], true);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  assert(address && typeof address === "object");
  const url = `ws://127.0.0.1:${address.port}/api/infinite/ws`;
  const owner = await connect(url);
  const observer = await connect(url);

  t.after(async () => {
    owner.ws.close();
    observer.ws.close();
    await shutdownInfinite();
    await closeServer(server);
  });

  const ownerStart = owner.messages.length;
  const observerStart = observer.messages.length;
  owner.ws.send(JSON.stringify({
    type: "placeColony",
    x: 90_001,
    y: 90_001,
    params: { name: "Integration colony", numAnts: 1 },
  }));

  const added = await observer.waitFor(
    message => message.type === "colonyAdded",
    observerStart,
  );
  const colony = added.colony as { id: number };
  await owner.waitFor(
    message => message.type === "colonyAssigned" && (message.colony as { id: number }).id === colony.id,
    ownerStart,
  );
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(
    observer.messages.slice(observerStart).some(message => message.type === "colonyAssigned"),
    false,
  );

  const unauthorizedStart = observer.messages.length;
  observer.ws.send(JSON.stringify({ type: "removeColony", id: colony.id }));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(
    observer.messages.slice(unauthorizedStart).some(
      message => message.type === "colonyRemoved" && message.id === colony.id,
    ),
    false,
  );

  const removalStart = observer.messages.length;
  owner.ws.send(JSON.stringify({ type: "removeColony", id: colony.id }));
  await observer.waitFor(
    message => message.type === "colonyRemoved" && message.id === colony.id,
    removalStart,
  );

  const foodX = 90_002, foodY = 90_002;
  observer.ws.send(JSON.stringify({ type: "toggleWall", x: foodX, y: foodY }));
  await owner.waitFor(
    message => message.type === "wallUpdate" && message.x === foodX && message.y === foodY && message.v === 0,
  );

  const foodStart = owner.messages.length;
  observer.ws.send(JSON.stringify({ type: "placeFood", x: foodX, y: foodY, units: 250 }));
  await owner.waitFor(
    message => message.type === "wallUpdate" && message.x === foodX && message.y === foodY && message.v === 1,
    foodStart,
  );
  const upsert = await owner.waitFor(
    message => message.type === "foodUpsert" &&
      (message.foodSource as { x: number; y: number }).x === foodX &&
      (message.foodSource as { x: number; y: number }).y === foodY,
    foodStart,
  );
  assert.equal("foodSources" in upsert, false);

  const noOpStart = owner.messages.length;
  observer.ws.send(JSON.stringify({ type: "removeFood", x: foodX + 1, y: foodY + 1 }));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(
    owner.messages.slice(noOpStart).some(message => message.type === "foodRemoved"),
    false,
  );

  const foodRemovalStart = owner.messages.length;
  observer.ws.send(JSON.stringify({ type: "removeFood", x: foodX, y: foodY }));
  await owner.waitFor(
    message => message.type === "foodRemoved" && message.x === foodX && message.y === foodY,
    foodRemovalStart,
  );
});
