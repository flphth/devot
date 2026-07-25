import type { ItemKind } from "./craft.js";
import type { ModelId } from "./constants.js";

export type DevotLifeState = "alive" | "starving" | "dying" | "dead";

export type CognitionProfileName = "frugal" | "equilibre" | "prophete";

export interface CognitionProfile {
  name: CognitionProfileName;
  model: ModelId;
  /** Passé tel quel à l'API ; undefined = pas de thinking (Haiku). */
  thinking?: { type: "adaptive" };
  effort?: "low" | "medium" | "high";
  maxTokens: number;
}

export type DecisionAction =
  | "idle"
  | "move"
  | "eat"
  | "attack"
  | "craft"
  | "reproduce"
  | "speak"
  | "flee";

export interface Decision {
  action: DecisionAction;
  targetId?: string;
  /** Objet à forger si action="craft". */
  item?: ItemKind;
  direction?: { x: number; z: number };
  utterance?: string;
  emotion?: string;
  /** Monologue intérieur : pensée intime, une phrase (≤140c). */
  thought?: string;
}

export type TriggerKind =
  | "divine_message" // priorité max
  | "threat" // combat / menace
  | "survival" // HP bas
  | "encounter" // rencontre significative
  | "utterance_heard" // parole reçue d'un autre devot
  | "idle_reflection"; // réflexion oisive

export interface Trigger {
  kind: TriggerKind;
  devotId: string;
  /** Description de l'événement, injectée dans le tour utilisateur. */
  eventText: string;
  createdAt: number;
}

export const TRIGGER_PRIORITY: Record<TriggerKind, number> = {
  divine_message: 0,
  threat: 1,
  survival: 2,
  encounter: 3,
  utterance_heard: 3,
  idle_reflection: 4,
};

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** État "chaud" d'un devot dans la simulation (en mémoire). */
export interface DevotEntity {
  id: string;
  godId: string;
  isFounder: boolean;
  name: string;
  pos: Vec3;
  hp: number;
  hpMax: number;
  state: DevotLifeState;
  profile: CognitionProfileName;
  traits: string[];
  /**
   * Identité figée à la naissance : apparence, stats, âme, signature, en JSON.
   * Portée par l'entité pour que la simulation ET la persistance y accèdent
   * sans repasser par la base à chaque tick.
   */
  identityJson: string;
  /** Objets forgés et portés. Deux au plus (MAX_CARRIED). */
  items: ItemKind[];
  age: number; // cycles vécus
  thinking: boolean; // une inférence est en vol
  utterance: string; // dernière parole (bulle)
  /** But courant du corps (mouvement déterministe entre deux pensées). */
  currentGoal:
    | { kind: "wander" }
    | { kind: "seek_food"; foodId: string }
    | { kind: "move_to"; target: Vec3 }
    | { kind: "flee"; from: Vec3 }
    | { kind: "attack"; targetId: string }
    | { kind: "idle" };
  /** Posée par une décision "reproduce" ; consommée par le serveur. */
  pendingReproduction?: { partnerId?: string };
  /** Id du dernier agresseur signalé (évite de re-déclencher chaque tick). */
  underAttackBy?: string;
  /** Devots déjà rencontrés (une rencontre = un seul déclencheur). */
  metDevots?: string[];
}

export interface FoodEntity {
  id: string;
  pos: Vec3;
  type: "grain" | "fruit" | "manna" | "tainted";
  hpValue: number;
  source: "spawn" | "god";
}

export interface InferenceUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}
