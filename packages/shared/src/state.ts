import { defineTypes, MapSchema, Schema } from "@colyseus/schema";

/**
 * Authoritative state, delta-synced to the clients.
 * The server is the only judge; the client merely renders.
 *
 * defineTypes API (no decorators): fields are `declare` + initialised in the
 * constructor so they go through the accessors installed on the prototype,
 * whatever the bundler's useDefineForClassFields setting.
 */
export class DevotState extends Schema {
  declare id: string;
  declare godId: string;
  declare name: string;
  declare isFounder: boolean;
  declare x: number;
  declare y: number;
  declare z: number;
  declare hp: number;
  declare hpMax: number;
  declare state: string;
  declare profile: string;
  declare thinking: boolean;
  declare utterance: string;
  declare emotion: string;
  declare thought: string;
  declare age: number;
  /** DevotIdentity as JSON — nested schemas would buy nothing here. */
  declare identityJson: string;

  constructor() {
    super();
    this.id = "";
    this.godId = "";
    this.name = "";
    this.isFounder = false;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.hp = 0;
    this.hpMax = 0;
    this.state = "alive";
    this.profile = "frugal";
    this.thinking = false;
    this.utterance = "";
    this.emotion = "";
    this.thought = "";
    this.age = 0;
    this.identityJson = "";
  }
}
defineTypes(DevotState, {
  id: "string",
  godId: "string",
  name: "string",
  isFounder: "boolean",
  x: "number",
  y: "number",
  z: "number",
  hp: "number",
  hpMax: "number",
  state: "string",
  profile: "string",
  thinking: "boolean",
  utterance: "string",
  emotion: "string",
  thought: "string",
  age: "number",
  identityJson: "string",
});

export class FoodState extends Schema {
  declare id: string;
  declare x: number;
  declare z: number;
  declare kind: string;
  declare hpValue: number;
  declare source: string;
  /** Sent so the client can wilt the food as its end approaches. */
  declare spawnedAt: number;
  declare ttlMs: number;

  constructor() {
    super();
    this.id = "";
    this.x = 0;
    this.z = 0;
    this.kind = "grain";
    this.hpValue = 0;
    this.source = "spawn";
    this.spawnedAt = 0;
    this.ttlMs = 0;
  }
}
defineTypes(FoodState, {
  id: "string",
  x: "number",
  z: "number",
  kind: "string",
  hpValue: "number",
  source: "string",
  spawnedAt: "number",
  ttlMs: "number",
});

export class MonsterState extends Schema {
  declare id: string;
  declare name: string;
  declare x: number;
  declare y: number;
  declare z: number;
  declare hp: number;
  declare hpMax: number;
  declare state: string;
  declare thinking: boolean;
  declare utterance: string;
  declare thought: string;
  declare age: number;

  constructor() {
    super();
    this.id = "";
    this.name = "";
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.hp = 0;
    this.hpMax = 0;
    this.state = "alive";
    this.thinking = false;
    this.utterance = "";
    this.thought = "";
    this.age = 0;
  }
}
defineTypes(MonsterState, {
  id: "string",
  name: "string",
  x: "number",
  y: "number",
  z: "number",
  hp: "number",
  hpMax: "number",
  state: "string",
  thinking: "boolean",
  utterance: "string",
  thought: "string",
  age: "number",
});

export class GodState extends Schema {
  declare id: string;
  declare name: string;
  declare color: string;
  /** Authoritative: the client only renders the countdown. */
  declare lastSpeakAt: number;
  declare connected: boolean;

  constructor() {
    super();
    this.id = "";
    this.name = "";
    this.color = "#ffffff";
    this.lastSpeakAt = 0;
    this.connected = true;
  }
}
defineTypes(GodState, {
  id: "string",
  name: "string",
  color: "string",
  lastSpeakAt: "number",
  connected: "boolean",
});

export class WorldState extends Schema {
  declare devots: MapSchema<DevotState>;
  declare monsters: MapSchema<MonsterState>;
  declare food: MapSchema<FoodState>;
  declare gods: MapSchema<GodState>;

  constructor() {
    super();
    this.devots = new MapSchema<DevotState>();
    this.monsters = new MapSchema<MonsterState>();
    this.food = new MapSchema<FoodState>();
    this.gods = new MapSchema<GodState>();
  }
}
defineTypes(WorldState, {
  devots: { map: DevotState },
  monsters: { map: MonsterState },
  food: { map: FoodState },
  gods: { map: GodState },
});

// ── DTOs for client → server intents ────────────────────────────────────────

export interface CreateFounderMsg {
  name?: string;
  /** 2 to 3 traits picked from TRAIT_POOL (validated server-side). */
  traits?: string[];
  /** Appearance and stats from the creation screen. Validated server-side. */
  appearance?: unknown;
  stats?: unknown;
}

export interface SmiteMsg {
  devotId: string;
}

/** A devot's journal (the "Mind" panel). */
export interface JournalRequestMsg {
  devotId: string;
}

export interface JournalEntry {
  kind: "event" | "decision";
  text: string;
  action?: string;
  emotion?: string;
  thought?: string;
  at: number;
}

export interface JournalMsg {
  devotId: string;
  entries: JournalEntry[];
}

// ── God mode (debug/creative, outside the rules of the game) ────────────────

export interface DebugSpawnDevotMsg {
  x: number;
  z: number;
}

export interface DebugSpawnMonsterMsg {
  x: number;
  z: number;
}

export interface DebugMoveFoodMsg {
  foodId: string;
  x: number;
  z: number;
}

export interface SpeakMsg {
  devotId: string;
  text: string;
}

export interface FeedMsg {
  devotId?: string;
  x?: number;
  z?: number;
}

/** Server response to rejected intents. */
export interface ActionRejectedMsg {
  action: "createFounder" | "speak" | "feed" | "smite";
  reason: string;
}

export const ROOM_NAME = "world";
export const SERVER_PORT = 2567;
