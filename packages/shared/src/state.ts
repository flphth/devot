import { defineTypes, MapSchema, Schema } from "@colyseus/schema";

/**
 * Authoritative state, synchronised (delta) to the clients.
 * The server is the sole judge; the client only renders.
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
  /**
   * Full identity as compact JSON: appearance, stats, soul, signature.
   * A single field because it NEVER changes after birth — ten fields
   * synchronised every tick for a frozen value would be a waste.
   */
  declare identity: string;
  /** Forged items, comma-separated. Rarely changes. */
  declare items: string;

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
    this.identity = "";
    this.items = "";
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
  identity: "string",
  items: "string",
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

export class GodState extends Schema {
  declare id: string;
  declare name: string;
  declare color: string;
  /** Authoritative: the client only renders the countdown. */
  declare lastSpeakAt: number;
  declare connected: boolean;
  /**
   * THE SCORE. How long this line has endured, in world cycles since its
   * founder opened its eyes. It stops when the last of them dies.
   */
  declare lineageCycles: number;
  /** How deep the line has gone. A founder alone is 1. */
  declare generations: number;
  /** Everyone ever born into it, and everyone it has lost. */
  declare born: number;
  declare lost: number;
  /** The most cycles any single one of them managed. */
  declare eldest: number;
  /** False once the last of them is dead: the run is over. */
  declare lineageAlive: boolean;

  constructor() {
    super();
    this.id = "";
    this.name = "";
    this.color = "#ffffff";
    this.lastSpeakAt = 0;
    this.connected = true;
    this.lineageCycles = 0;
    this.generations = 0;
    this.born = 0;
    this.lost = 0;
    this.eldest = 0;
    this.lineageAlive = false;
  }
}
defineTypes(GodState, {
  id: "string",
  name: "string",
  color: "string",
  lastSpeakAt: "number",
  connected: "boolean",
  lineageCycles: "number",
  generations: "number",
  born: "number",
  lost: "number",
  eldest: "number",
  lineageAlive: "boolean",
});

/**
 * A MONSTER, as the client needs to see it.
 *
 * No mind, no god, no identity. What it does carry is a HOARD: everything it
 * has drained from the devots it killed. That hoard is the whole point — it is
 * visible, it grows, and whoever brings the monster down takes it.
 */
export class MonsterState extends Schema {
  declare id: string;
  declare name: string;
  declare x: number;
  declare z: number;
  declare hp: number;
  declare hpMax: number;
  /** What it has taken from the dead. A fat monster is a visible wager. */
  declare hoard: number;
  declare state: string;
  /** Id of the devot it is currently hunting, empty if none. */
  declare targetId: string;

  constructor() {
    super();
    this.id = "";
    this.name = "";
    this.x = 0;
    this.z = 0;
    this.hp = 0;
    this.hpMax = 0;
    this.hoard = 0;
    this.state = "alive";
    this.targetId = "";
  }
}
defineTypes(MonsterState, {
  id: "string",
  name: "string",
  x: "number",
  z: "number",
  hp: "number",
  hpMax: "number",
  hoard: "number",
  state: "string",
  targetId: "string",
});

export class WorldState extends Schema {
  /**
   * Milliseconds of world time since this world began. One number, from which
   * both sides derive the same hour, the same season and the same sky.
   */
  declare worldMs: number;
  declare devots: MapSchema<DevotState>;
  declare food: MapSchema<FoodState>;
  declare gods: MapSchema<GodState>;
  declare monsters: MapSchema<MonsterState>;

  constructor() {
    super();
    this.worldMs = 0;
    this.devots = new MapSchema<DevotState>();
    this.food = new MapSchema<FoodState>();
    this.gods = new MapSchema<GodState>();
    this.monsters = new MapSchema<MonsterState>();
  }
}
defineTypes(WorldState, {
  worldMs: "number",
  devots: { map: DevotState },
  food: { map: FoodState },
  gods: { map: GodState },
  monsters: { map: MonsterState },
});

// ── DTO des intentions client → serveur ─────────────────────────────────────

export interface CreateFounderMsg {
  name?: string;
  /** 2 to 3 traits picked from TRAIT_POOL (validated server-side). */
  traits?: string[];
  /** Appearance chosen on the creation screen (validated server-side). */
  appearance?: unknown;
  /** Stat spread over the budget (validated server-side). */
  stats?: unknown;
  /** Free text: what the devot believes itself to be. Enters its prompt. */
  soul?: string;
}

/**
 * A theft of life that just happened. Broadcast to everyone: combat is the most
 * legible moment of the game, it must not stay a line in a log.
 */
export interface CombatFxMsg {
  attackerId: string;
  victimId: string;
  /** HP actually transferred this tick. */
  drained: number;
  /** The victim's position: that is where the numbers spring from. */
  x: number;
  z: number;
  /** La victime en meurt-elle ? */
  lethal: boolean;
}

export interface SmiteMsg {
  devotId: string;
}

/** Journal d'un devot (panneau « Esprit »). */
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

/** God mode: what the next click brings into the world. */
export type SpawnKind = "devot" | "monster";

export interface DebugSpawnMonsterMsg {
  x?: number;
  z?: number;
}

export interface DebugSpawnDevotMsg {
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

/**
 * A line has died out. Broadcast because it is the end of a run: the score is
 * final, and nothing that god had left is alive to change it.
 */
export interface LineageEndedMsg {
  godId: string;
  cycles: number;
  generations: number;
  born: number;
  eldest: number;
}

/** Server response to rejected intents. */
export interface ActionRejectedMsg {
  action: "createFounder" | "speak" | "feed" | "smite";
  reason: string;
}

export const ROOM_NAME = "world";
export const SERVER_PORT = 2567;
