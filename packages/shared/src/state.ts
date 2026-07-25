import { defineTypes, MapSchema, Schema } from "@colyseus/schema";

/**
 * État autoritaire synchronisé (delta) vers les clients.
 * Le serveur est seul juge ; le client ne fait que rendre.
 *
 * API defineTypes (sans décorateurs) : les champs sont `declare` + initialisés
 * dans le constructeur pour passer par les accesseurs installés sur le
 * prototype, quel que soit le réglage useDefineForClassFields du bundler.
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
   * Identité complète en JSON compact : apparence, stats, âme, signature.
   * Un seul champ parce qu'elle ne change JAMAIS après la naissance — dix
   * champs synchronisés à chaque tick pour une valeur figée seraient du gâchis.
   */
  declare identity: string;

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
    this.state = "vivant";
    this.profile = "frugal";
    this.thinking = false;
    this.utterance = "";
    this.emotion = "";
    this.thought = "";
    this.age = 0;
    this.identity = "";
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
});

export class FoodState extends Schema {
  declare id: string;
  declare x: number;
  declare z: number;
  declare kind: string;
  declare hpValue: number;
  declare source: string;

  constructor() {
    super();
    this.id = "";
    this.x = 0;
    this.z = 0;
    this.kind = "grain";
    this.hpValue = 0;
    this.source = "spawn";
  }
}
defineTypes(FoodState, {
  id: "string",
  x: "number",
  z: "number",
  kind: "string",
  hpValue: "number",
  source: "string",
});

export class GodState extends Schema {
  declare id: string;
  declare name: string;
  declare color: string;
  /** Autoritaire : le client n'affiche que le minuteur. */
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
  declare food: MapSchema<FoodState>;
  declare gods: MapSchema<GodState>;

  constructor() {
    super();
    this.devots = new MapSchema<DevotState>();
    this.food = new MapSchema<FoodState>();
    this.gods = new MapSchema<GodState>();
  }
}
defineTypes(WorldState, {
  devots: { map: DevotState },
  food: { map: FoodState },
  gods: { map: GodState },
});

// ── DTO des intentions client → serveur ─────────────────────────────────────

export interface CreateFounderMsg {
  name?: string;
  /** 2 à 3 traits choisis dans TRAIT_POOL (validés côté serveur). */
  traits?: string[];
  /** Apparence choisie à l'écran de création (validée côté serveur). */
  appearance?: unknown;
  /** Répartition des stats sur le budget (validée côté serveur). */
  stats?: unknown;
  /** Texte libre : ce que le devot croit être. Entre dans son prompt. */
  soul?: string;
}

/**
 * Un vol de vie qui vient d'avoir lieu. Diffusé à tous : le combat est le
 * moment le plus lisible du jeu, il ne doit pas rester une ligne de journal.
 */
export interface CombatFxMsg {
  attackerId: string;
  victimId: string;
  /** PV réellement transférés ce tick. */
  drained: number;
  /** Position de la victime : c'est de là que jaillissent les chiffres. */
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

// ── Mode god (debug/créatif, hors règles du jeu) ────────────────────────────

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

/** Réponse serveur aux intentions rejetées. */
export interface ActionRejectedMsg {
  action: "createFounder" | "speak" | "feed" | "smite";
  reason: string;
}

export const ROOM_NAME = "world";
export const SERVER_PORT = 2567;
