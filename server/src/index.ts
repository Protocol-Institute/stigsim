import { createServer } from "http";
import express from "express";
import cors from "cors";
import router from "./routes";
import { attachInfiniteWs, shutdownInfinite } from "./ws";
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

const server = createServer(app);

attachInfiniteWs(server, allowedOrigins, isProduction).then(() => {
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
  await closeDb();
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });
