// Drizzle schema for the persisted shared world.
// This is the source of truth for the eventual deployed server + Postgres.
// Apply with: npx drizzle-kit push   (requires DATABASE_URL)

import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

/** Snapshot of the whole world (walls, colonies, food), keyed by world name. */
export const worldStateTable = pgTable("world_state", {
  key: text("key").primaryKey(),
  data: text("data").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WorldStateRow = typeof worldStateTable.$inferSelect;

/** All-time leaderboard: one row per dead colony. */
export const colonyRecordsTable = pgTable("colony_records", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  lifespanTicks: integer("lifespan_ticks").notNull(),
  diedAt: timestamp("died_at").notNull().defaultNow(),
});

export type ColonyRecord = typeof colonyRecordsTable.$inferSelect;
export type NewColonyRecord = typeof colonyRecordsTable.$inferInsert;
