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
  hp: real("hp").notNull(),
  hpMax: real("hp_max").notNull(),
  cognitionProfile: text("cognition_profile").notNull(),
  x: real("x").notNull().default(0),
  y: real("y").notNull().default(0),
  z: real("z").notNull().default(0),
  state: text("state").notNull().default("vivant"),
  currentGoal: text("current_goal_json"),
  age: integer("age").notNull().default(0),
  traitsJson: text("traits_json").notNull().default("[]"),
  parentA: text("parent_a"),
  parentB: text("parent_b"),
  bornAt: integer("born_at").notNull(),
  diedAt: integer("died_at"),
  lastActionAt: integer("last_action_at").notNull().default(0),
});

// L'historique LLM du devot. Mort = DELETE CASCADE de ces lignes.
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

// Mémoire du monde : ce qui survit aux morts (pierres tombales incluses).
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
  hpValue: real("hp_value").notNull(),
  source: text("source").notNull(), // spawn | god
  spawnedAt: integer("spawned_at").notNull(),
  consumedBy: text("consumed_by"),
});

export const divineMsgs = sqliteTable("divine_msgs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  godId: text("god_id").notNull(),
  devotId: text("devot_id").notNull(),
  text: text("text").notNull(),
  sentAt: integer("sent_at").notNull(),
});
