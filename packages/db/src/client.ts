import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type DevotDb = BetterSQLite3Database<typeof schema>;

/**
 * Schema for a FRESH database. `CREATE TABLE IF NOT EXISTS` is a no-op on a file
 * that already exists, so this DDL alone can never evolve an old database: every
 * change made after the first release also needs a MIGRATIONS entry below.
 */
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
  state TEXT NOT NULL DEFAULT 'alive',
  current_goal_json TEXT,
  age INTEGER NOT NULL DEFAULT 0,
  traits_json TEXT NOT NULL DEFAULT '[]',
  identity_json TEXT NOT NULL DEFAULT '',
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
`;

type Sqlite = Database.Database;

/** Adds a column only when it is missing — safe to re-run on any database. */
function addColumnIfMissing(db: Sqlite, table: string, column: string, ddl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

function renameValues(db: Sqlite, column: string, pairs: Array<[string, string]>): void {
  const stmt = db.prepare(`UPDATE devots SET ${column} = ? WHERE ${column} = ?`);
  for (const [from, to] of pairs) stmt.run(to, from);
}

/**
 * Ordered, append-only migrations. An entry's index IS the schema version, kept
 * in `PRAGMA user_version` — never reorder or delete one, only append. Each must
 * be idempotent: a database may already carry the change from a manual patch.
 */
const MIGRATIONS: Array<(db: Sqlite) => void> = [
  // 1 — Identity chosen on the creation screen, frozen at birth.
  (db) => addColumnIfMissing(db, "devots", "identity_json", "TEXT NOT NULL DEFAULT ''"),

  // 2 — The world speaks English: life states used to be stored in French.
  (db) =>
    renameValues(db, "state", [
      ["vivant", "alive"],
      ["affame", "starving"],
      ["agonisant", "dying"],
      ["mort", "dead"],
    ]),

  // 3 — Cognition profiles were French too.
  (db) =>
    renameValues(db, "cognition_profile", [
      ["equilibre", "balanced"],
      ["prophete", "prophet"],
    ]),
];

function migrate(db: Sqlite): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      MIGRATIONS[i]!(db);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

/** Opens (or creates) the database. `:memory:` for tests. */
export function openDb(path: string): DevotDb {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON"); // required for CASCADE
  sqlite.exec(DDL);
  migrate(sqlite);
  return drizzle(sqlite, { schema });
}
