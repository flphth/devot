import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type DevotDb = BetterSQLite3Database<typeof schema>;

const DDL = `
CREATE TABLE IF NOT EXISTS gods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  founder_devot_id TEXT,
  color TEXT NOT NULL DEFAULT '#ffffff',
  last_speak_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devots (
  id TEXT PRIMARY KEY,
  god_id TEXT NOT NULL,
  is_founder INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  hp REAL NOT NULL,
  hp_max REAL NOT NULL,
  cognition_profile TEXT NOT NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  z REAL NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'vivant',
  current_goal_json TEXT,
  age INTEGER NOT NULL DEFAULT 0,
  traits_json TEXT NOT NULL DEFAULT '[]',
  parent_a TEXT,
  parent_b TEXT,
  born_at INTEGER NOT NULL,
  died_at INTEGER,
  last_action_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  devot_id TEXT NOT NULL REFERENCES devots(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content_json TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_devot ON messages(devot_id);
CREATE TABLE IF NOT EXISTS world_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  actor_ids_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS food (
  id TEXT PRIMARY KEY,
  x REAL NOT NULL,
  y REAL NOT NULL DEFAULT 0,
  z REAL NOT NULL,
  type TEXT NOT NULL,
  hp_value REAL NOT NULL,
  source TEXT NOT NULL,
  spawned_at INTEGER NOT NULL,
  consumed_by TEXT
);
CREATE TABLE IF NOT EXISTS divine_msgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  god_id TEXT NOT NULL,
  devot_id TEXT NOT NULL,
  text TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS voxel_lineages (
  id TEXT PRIMARY KEY,
  god_id TEXT NOT NULL,
  name TEXT NOT NULL,
  released_at INTEGER NOT NULL,
  released_tick INTEGER NOT NULL,
  born INTEGER NOT NULL DEFAULT 1,
  died INTEGER NOT NULL DEFAULT 0,
  max_generation INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS voxel_tombstones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organism_id INTEGER NOT NULL,
  lineage_id TEXT NOT NULL DEFAULT '',
  god_id TEXT NOT NULL DEFAULT '',
  generation INTEGER NOT NULL DEFAULT 0,
  born_tick INTEGER NOT NULL DEFAULT 0,
  died_tick INTEGER NOT NULL DEFAULT 0,
  body_voxels INTEGER NOT NULL DEFAULT 0,
  eaten INTEGER NOT NULL DEFAULT 0,
  bites INTEGER NOT NULL DEFAULT 0,
  bitten INTEGER NOT NULL DEFAULT 0,
  crossbred INTEGER NOT NULL DEFAULT 0,
  cause TEXT NOT NULL DEFAULT 'famine'
);
`;

/** Ouvre (ou crée) la base. `:memory:` pour les tests. */
export function openDb(path: string): DevotDb {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON"); // requis pour le CASCADE
  sqlite.exec(DDL);
  return drizzle(sqlite, { schema });
}
