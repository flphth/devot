import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const gods = sqliteTable("gods", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  founderDevotId: text("founder_devot_id"),
  color: text("color").notNull().default("#ffffff"),
  lastSpeakAt: integer("last_speak_at").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const devots = sqliteTable("devots", {
  id: text("id").primaryKey(),
  godId: text("god_id").notNull(),
  isFounder: integer("is_founder", { mode: "boolean" }).notNull().default(false),
  name: text("name").notNull(),
  balance: real("balance").notNull(),
  capacity: real("capacity").notNull(),
  /** What it was given at birth. Its relic is worth exactly this. */
  bornWith: real("born_with").notNull().default(0),
  cognitionProfile: text("cognition_profile").notNull(),
  x: real("x").notNull().default(0),
  y: real("y").notNull().default(0),
  z: real("z").notNull().default(0),
  state: text("state").notNull().default("alive"),
  currentGoal: text("current_goal_json"),
  age: integer("age").notNull().default(0),
  traitsJson: text("traits_json").notNull().default("[]"),
  /** Appearance, stats, soul and signature, as JSON. Frozen at birth. */
  identityJson: text("identity_json").notNull().default(""),
  /** The devot's wallet address. Derived at birth, never a key. */
  wallet: text("wallet").notNull().default(""),
  parentA: text("parent_a"),
  parentB: text("parent_b"),
  bornAt: integer("born_at").notNull(),
  diedAt: integer("died_at"),
  lastActionAt: integer("last_action_at").notNull().default(0),
});

// The devot's LLM history. Death = DELETE CASCADE on these rows.
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  devotId: text("devot_id")
    .notNull()
    .references(() => devots.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant
  contentJson: text("content_json").notNull(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

// The world's memory: what outlives the dead (gravestones included).
export const worldEvents = sqliteTable("world_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  actorIdsJson: text("actor_ids_json").notNull().default("[]"),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
});

export const food = sqliteTable("food", {
  id: text("id").primaryKey(),
  x: real("x").notNull(),
  y: real("y").notNull().default(0),
  z: real("z").notNull(),
  type: text("type").notNull(),
  worth: real("hp_value").notNull(),
  source: text("source").notNull(), // spawn | god
  spawnedAt: integer("spawned_at").notNull(),
  consumedBy: text("consumed_by"),
});

/**
 * Deposits already honoured. A transaction hash is a bearer token until it is
 * spent, so "spent" has to outlive the process — an in-memory set forgets every
 * payment on restart, and the same deposit mints a second devot for free.
 *
 * tokenId and deposit are TEXT: they are uint256, and a REAL would round them.
 */
export const mintReceipts = sqliteTable("mint_receipts", {
  txHash: text("tx_hash").primaryKey(),
  tokenId: text("token_id").notNull(),
  god: text("god").notNull(),
  deposit: text("deposit").notNull(),
  usedAt: integer("used_at").notNull(),
});

export const divineMsgs = sqliteTable("divine_msgs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  godId: text("god_id").notNull(),
  devotId: text("devot_id").notNull(),
  text: text("text").notNull(),
  sentAt: integer("sent_at").notNull(),
});
