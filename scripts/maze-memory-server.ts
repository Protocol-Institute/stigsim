import { createServer, type IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";
import { PRACTICE_SEEDS } from "../src/modes/maze-memory/contract";
import {
  providerConfig,
  ready,
  type ProviderConfig,
} from "./maze-memory-provider";
import { MemoryRun } from "./maze-memory-run";
const local = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]";
async function json(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 100000) throw Error("Request exceeds 100 KB.");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function localMemoryServer(
  config: ProviderConfig = providerConfig(),
  request: typeof fetch = fetch,
) {
  const sessions = new Map<string, MemoryRun>();
  return createServer(async (req, res) => {
    const send = (status: number, value: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (
        !local(new URL(`http://${req.headers.host ?? "invalid"}`).hostname) ||
        (req.headers.origin &&
          (!local(new URL(req.headers.origin).hostname) ||
            new URL(req.headers.origin).protocol !== "http:"))
      ) {
        send(403, { error: "Local browser access only." });
        return;
      }
      const path = new URL(req.url!, "http://localhost").pathname.replace(
        /^\/local-maze-memory/,
        "",
      );
      if (req.method === "GET" && path === "/status") {
        send(200, {
          ready: ready(config),
          model: config.model,
          message: ready(config)
            ? "Local runner connected to configured inference endpoint."
            : "Start with ANT_MODEL and a model endpoint. See docs/maze-memory.md.",
        });
        return;
      }
      for (const [id, s] of sessions)
        if (!s.busy && Date.now() - s.touched > 3600000) sessions.delete(id);
      if (req.method === "POST" && path === "/runs") {
        if (!ready(config)) {
          send(503, { error: "Model endpoint is not configured." });
          return;
        }
        if (sessions.size >= 8) {
          send(429, {
            error:
              "Eight local runs are retained. Delete or export an earlier run.",
          });
          return;
        }
        const body = await json(req);
        const mode = body.mode;
        if (mode !== "practice" && mode !== "evaluation")
          throw new Error("Choose practice or evaluation.");
        if (
          mode === "practice" &&
          (!Number.isInteger(body.index) || body.index < 0 || body.index >= 20)
        )
          throw Error("Choose a practice maze.");
        const manifest =
          mode === "practice"
            ? { name: "Practice", seeds: [PRACTICE_SEEDS[body.index]] }
            : body.manifest;
        const run = new MemoryRun(
          body.strategy,
          body.limits,
          manifest,
          mode,
          config,
          request,
        );
        sessions.set(run.id, run);
        send(201, run.snapshot());
        return;
      }
      const match = path.match(
        /^\/runs\/([a-f0-9-]{36})(\/step|\/export|\/stop)?$/,
      );
      const run = match && sessions.get(match[1]);
      if (!run) {
        send(404, { error: "Run not found. Start a fresh local run." });
        return;
      }
      if (req.method === "DELETE") {
        run.cancel();
        sessions.delete(run.id);
        send(200, { cancelled: true });
        return;
      }
      if (req.method === "POST" && match![2] === "/stop") {
        run.cancel();
        send(200, run.snapshot());
        return;
      }
      if (req.method === "GET") {
        send(200, match![2] === "/export" ? run.record : run.snapshot());
        return;
      }
      if (req.method === "POST" && match![2] === "/step") {
        const b = await json(req);
        if (
          !Number.isInteger(b.maze) ||
          !Number.isInteger(b.step) ||
          !Number.isSafeInteger(b.revision) ||
          b.revision < 0
        )
          throw new Error("Expected maze, step and revision integers.");
        if ([...sessions.values()].some((s) => s.busy)) {
          send(409, { error: "A model decision is already in progress." });
          return;
        }
        const state = await run.step(b.maze, b.step, b.revision);
        send(200, state);
        return;
      }
      send(405, { error: "Method not allowed." });
    } catch (e) {
      if (!res.headersSent)
        send(400, {
          error: e instanceof Error ? e.message : "Local request failed.",
        });
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.env.NODE_ENV === "production")
    throw new Error("The maze-memory experiment is local-only.");
  const port = Number(process.env.MAZE_MEMORY_PORT || 3016);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid MAZE_MEMORY_PORT.");
  localMemoryServer().listen(port, "127.0.0.1", () =>
    console.log(
      `Local maze-memory runner: http://127.0.0.1:${port} (credentials stay on this server)`,
    ),
  );
}
