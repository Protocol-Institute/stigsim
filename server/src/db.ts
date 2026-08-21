// Optional Postgres connection.
//
// - DATABASE_URL set   → full persistence: world snapshots + leaderboard
//                        records survive restarts. This is the mode the
//                        deployed shared-world server runs in.
// - DATABASE_URL unset → db is null; the server runs entirely in memory for
//                        the session (local development / verification).
//
// Callers must check `db` for null before using it.

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export type Db = NodePgDatabase<typeof schema>;

let _db: Db | null = null;
let _pool: pg.Pool | null = null;

if (process.env.DATABASE_URL) {
  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  _db = drizzle(_pool, { schema });
  console.log("[db] DATABASE_URL set — Postgres persistence enabled");
} else {
  console.log("[db] DATABASE_URL not set — running in-memory (state is session-lived)");
}

export const db: Db | null = _db;
export async function closeDb() {
  await _pool?.end();
}
export * from "./schema";
