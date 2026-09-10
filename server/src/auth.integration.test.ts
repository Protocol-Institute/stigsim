import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import authRouter, { requireOnlineAuth } from "./auth-router";
import { resetAuthForTests } from "./auth";

test("email code flow creates a session accepted by the API", async t => {
  resetAuthForTests();
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.get("/api/protected", requireOnlineAuth, (_req, res) => res.json({ ok: true }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;

  assert.equal((await fetch(`${base}/api/protected`)).status, 401);

  const requested = await fetch(`${base}/api/auth/request-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "Person@example.com" }),
  });
  assert.equal(requested.status, 200);
  const { developmentCode } = await requested.json() as { developmentCode?: string };
  assert.match(developmentCode ?? "", /^\d{6}$/);

  const verified = await fetch(`${base}/api/auth/verify-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "person@example.com", code: developmentCode }),
  });
  assert.equal(verified.status, 200);
  const { token } = await verified.json() as { token: string };

  const session = await fetch(`${base}/api/auth/session`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(session.status, 200);
  assert.equal((await session.json() as { email: string }).email, "person@example.com");
  assert.equal((await fetch(`${base}/api/protected`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
});
