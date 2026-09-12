import { createServer } from "http";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import router from "./routes";
import { attachInfiniteWs, shutdownInfinite } from "./ws";
import { attachWarWs, shutdownWar } from "./war";
import { closeDb } from "./db";

const port = Number(process.env.PORT ?? 3001);
const isProduction = process.env.NODE_ENV === "production";

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

if (isProduction && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in production");
}

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://localhost:5173")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

if (isProduction && !process.env.ALLOWED_ORIGINS) {
  throw new Error("ALLOWED_ORIGINS must be set in production");
}

app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.includes(origin));
  },
}));
app.use(express.json({ limit: "16kb" }));
app.use("/api", router);

// Preview-only hosting: keep API misses as API misses, then serve the built SPA.
const staticDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist");
app.use("/api", (_request, response) => {
  response.status(404).json({ error: "Not found" });
});
app.use(express.static(staticDir));
app.use((request, response, next) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    next();
    return;
  }
  response.sendFile(resolve(staticDir, "index.html"));
});

const server = createServer(app);

attachInfiniteWs(server, allowedOrigins, isProduction).then(() => {
  return attachWarWs(server, allowedOrigins, isProduction);
}).then(() => {
  server.listen(port, () => {
    console.log(`[server] Listening on port ${port}`);
  });
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received — saving world and shutting down`);
  server.close();
  await shutdownInfinite();
  shutdownWar();
  await closeDb();
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });
