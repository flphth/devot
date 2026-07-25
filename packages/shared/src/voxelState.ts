import { defineTypes, MapSchema, Schema, view } from "@colyseus/schema";

/**
 * État autoritaire du MONDE COMMUN voxel.
 *
 * Ce qui passe par `@colyseus/schema` ici, ce sont les ENTITÉS : elles ont un
 * cycle de vie (naître, bouger, mourir) et le moteur n'envoie que les deltas.
 * Le terrain, lui, ne passe pas par là — il voyage en binaire brut, chunk par
 * chunk, et seulement s'il a changé (voir `wire.ts` du noyau).
 *
 * `view()` marque les champs soumis au BROUILLARD : un client ne reçoit que les
 * organismes que le serveur a explicitement ajoutés à sa vue. Ce n'est pas un
 * effet visuel qu'on pourrait désactiver côté client — c'est de la donnée qui
 * n'arrive jamais.
 */

/** Un organisme, tel que le client a besoin de le connaître pour l'afficher. */
export class VoxelOrganismState extends Schema {
  declare id: number;
  /** Position du germe, en voxels. Le corps se déduit du descripteur binaire. */
  declare x: number;
  declare y: number;
  declare z: number;
  /** Énergie en pour mille de la capacité : une teinte, pas une valeur exacte. */
  declare energy: number;
  /** Lignée d'origine — l'identifiant du dieu qui a relâché l'ancêtre. */
  declare lineage: string;
  declare generation: number;
  /**
   * Version de la morphologie. Quand elle change, le client sait que son
   * descripteur de corps est périmé et en redemande un.
   */
  declare shape: number;

  constructor() {
    super();
    this.id = 0;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.energy = 0;
    this.lineage = "";
    this.generation = 0;
    this.shape = 0;
  }
}
defineTypes(VoxelOrganismState, {
  id: "uint16",
  x: "uint8",
  y: "uint8",
  z: "uint8",
  energy: "uint16",
  lineage: "string",
  generation: "uint16",
  shape: "uint16",
});

/** Un dieu connecté. Public : savoir qui partage le monde fait partie du jeu. */
export class VoxelGodState extends Schema {
  declare id: string;
  declare name: string;
  declare color: string;
  /** Nombre d'organismes vivants issus de ses lâchers. */
  declare living: number;
  declare released: number;

  constructor() {
    super();
    this.id = "";
    this.name = "";
    this.color = "#ffffff";
    this.living = 0;
    this.released = 0;
  }
}
defineTypes(VoxelGodState, {
  id: "string",
  name: "string",
  color: "string",
  living: "uint16",
  released: "uint16",
});

/**
 * Agrégats du monde. Publics et minuscules : ils alimentent les courbes sans
 * rien révéler de ce qui se passe hors de vue.
 */
export class VoxelWorldState extends Schema {
  declare tick: number;
  declare population: number;
  declare maxGeneration: number;
  declare biomass: number;
  declare avgBodyVoxels: number;
  declare avgNeurons: number;
  /** Organismes, soumis au brouillard : voir `view()` plus bas. */
  declare organisms: MapSchema<VoxelOrganismState>;
  declare gods: MapSchema<VoxelGodState>;

  constructor() {
    super();
    this.tick = 0;
    this.population = 0;
    this.maxGeneration = 0;
    this.biomass = 0;
    this.avgBodyVoxels = 0;
    this.avgNeurons = 0;
    this.organisms = new MapSchema<VoxelOrganismState>();
    this.gods = new MapSchema<VoxelGodState>();
  }
}
defineTypes(VoxelWorldState, {
  tick: "uint32",
  population: "uint16",
  maxGeneration: "uint16",
  biomass: "uint32",
  avgBodyVoxels: "float32",
  avgNeurons: "float32",
  organisms: { map: VoxelOrganismState },
  gods: { map: VoxelGodState },
});

/**
 * LE BROUILLARD. `view()` est écrit pour la syntaxe à décorateurs ; le projet
 * utilise `defineTypes` (les décorateurs cassent à l'exécution avec cette
 * version), on l'applique donc à la main sur le prototype, APRÈS `defineTypes`
 * puisqu'il annote un champ déjà déclaré.
 *
 * Effet : la carte des organismes n'est pas diffusée. Chaque client reçoit
 * exactement ce que le serveur a mis dans sa `StateView`, et rien d'autre — un
 * client modifié ne peut pas voir plus loin, faute de données à voir.
 */
view()(VoxelWorldState.prototype, "organisms");

// ── Messages ────────────────────────────────────────────────────────────────

export const VOXEL_ROOM_NAME = "voxelworld";

/** Le client dit où il regarde ; le serveur en déduit ce qu'il a le droit de voir. */
export interface LookAtMsg {
  x: number;
  z: number;
}

/** Relâcher un génome issu du laboratoire. Le serveur valide et facture. */
export interface ReleaseGenomeMsg {
  /** Octets du génome exporté, en base64 (JSON only sur ce canal). */
  genome: string;
  name?: string;
}

export interface ReleaseResultMsg {
  ok: boolean;
  /** Motif de refus, en clair : un génome illégal doit être compréhensible. */
  reason?: string;
  organismId?: number;
  receipt?: string;
}

// ── Pouvoirs divins (P5.4) ──────────────────────────────────────────────────

/**
 * Les trois gestes d'un dieu. Chacun a un COOLDOWN tenu par le serveur : le
 * client peut afficher un compte à rebours, il ne peut pas s'en affranchir.
 */
export type DivinePower = "feed" | "protect" | "smite";

export const DIVINE_COOLDOWN_MS: Record<DivinePower, number> = {
  // Nourrir est le geste doux : on en abuserait pour rendre une lignée immortelle.
  feed: 8_000,
  // Protéger suspend la mort : plus rare encore.
  protect: 20_000,
  // Foudroyer détruit ; c'est le plus contraint, parce qu'il touche autrui.
  smite: 12_000,
};

/** Durée d'une protection divine, en ticks du monde. */
export const PROTECT_TICKS = 240;

export interface DivineActMsg {
  power: DivinePower;
  /** Cible : un point du monde, ou un organisme. */
  x?: number;
  z?: number;
  organismId?: number;
}

export interface DivineResultMsg {
  ok: boolean;
  power: DivinePower;
  reason?: string;
  /** Millisecondes restantes avant de pouvoir refaire ce geste. */
  cooldownMs?: number;
}

/** Mode god : modifier le monde lui-même. Réservé, et tracé. */
export interface GodModeMsg {
  action: "terrain" | "biomass" | "spawn";
  x: number;
  y: number;
  z: number;
}

/** Registre des lignées et cimetière, poussés à la demande. */
export const MSG_REGISTRY = "registry";
export interface RegistryMsg {
  lineages: Array<{
    id: string;
    godId: string;
    name: string;
    born: number;
    died: number;
    maxGeneration: number;
  }>;
  tombstones: Array<{
    organismId: number;
    lineageId: string;
    generation: number;
    bornTick: number;
    diedTick: number;
    bodyVoxels: number;
    eaten: number;
    bites: number;
    bitten: number;
    crossbred: boolean;
    cause: string;
  }>;
}

// ── L'éveil (P5.5) ──────────────────────────────────────────────────────────

/** Le dieu réveille un de ses organismes. Peu d'éveillés : c'est un coût. */
export interface AwakenMsg {
  organismId: number;
  name?: string;
}

/** Le verbe divin : 140 caractères, une fois par minute. Comme dans Devot. */
export const DIVINE_WORD_MAX_CHARS = 140;
export const DIVINE_WORD_COOLDOWN_MS = 60_000;

export interface DivineWordMsg {
  organismId: number;
  text: string;
}

/** Une pensée d'éveillé, poussée aux clients qui la voient. */
export const MSG_THOUGHT = "thought";
export interface ThoughtMsg {
  organismId: number;
  tick: number;
  monologue: string;
  intent: string;
  /** Énergie prélevée par cette pensée. Penser coûte la vie. */
  energyCost: number;
  inputTokens: number;
  outputTokens: number;
}

/** Le journal d'un éveillé, à la demande. (Le jeu LLM a le sien, d'où le nom.) */
export const MSG_JOURNAL = "voxelJournal";
export interface VoxelJournalMsg {
  organismId: number;
  entries: ThoughtMsg[];
  alive: boolean;
  mind: string;
}

/** Un chunk de terrain, en binaire brut (hors schéma). */
export const MSG_CHUNK = "chunk";
/** Un descripteur de corps, en binaire brut. */
export const MSG_BODY = "body";
/** Le client redemande un corps dont il n'a pas la forme. */
export const MSG_WANT_BODY = "wantBody";

/** Cadence du monde commun. Il tourne 24/7, sans spectateur. */
export const VOXEL_TICK_MS = 250;
