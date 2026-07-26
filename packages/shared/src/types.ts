import type { ItemKind } from "./craft.js";
import type { ModelId } from "./constants.js";

export type DevotLifeState = "alive" | "starving" | "dying" | "dead";

export type CognitionProfileName = "frugal" | "balanced" | "prophet";

export interface CognitionProfile {
  name: CognitionProfileName;
  model: ModelId;
  /** Passed straight to the API; undefined = no thinking (Haiku). */
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
  /** Item to forge when action="craft". */
  item?: ItemKind;
  direction?: { x: number; z: number };
  utterance?: string;
  emotion?: string;
  /** Inner monologue: one intimate sentence (<=140 chars). */
  thought?: string;
}

export type TriggerKind =
  | "divine_message" // top priority
  | "threat" // combat / danger
  | "survival" // low HP
  | "encounter" // meaningful encounter
  | "utterance_heard" // words received from another devot
  | "idle_reflection"; // idle musing

export interface Trigger {
  kind: TriggerKind;
  devotId: string;
  /** Description of the event, injected into the user turn. */
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

/** The "hot" state of a devot in the simulation (in memory). */
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
   * Identity frozen at birth: appearance, stats, soul, signature, as JSON.
   * Carried by the entity so that the simulation AND persistence can reach it
   * without going back to the database on every tick.
   */
  identityJson: string;
  /** Items forged and carried. Two at most (MAX_CARRIED). */
  items: ItemKind[];
  age: number; // cycles lived
  thinking: boolean; // an inference is in flight
  utterance: string; // last utterance (speech bubble)
  /** The body's current goal (deterministic movement between two thoughts). */
  currentGoal:
    | { kind: "wander" }
    | { kind: "seek_food"; foodId: string }
    | { kind: "move_to"; target: Vec3 }
    | { kind: "flee"; from: Vec3 }
    | { kind: "attack"; targetId: string }
    | { kind: "idle" };
  /** Set by a "reproduce" decision; consumed by the server. */
  pendingReproduction?: { partnerId?: string };
  /** Id of the last reported attacker (avoids re-triggering every tick). */
  underAttackBy?: string;
  /** HP at the end of its previous thought, so it can feel a trend. */
  hpAtLastThought?: number;
  /** Everyone who has ever drawn its life. Capped; survives between thoughts. */
  attackedBy?: string[];
  /** Devots already met (one encounter = a single trigger). */
  metDevots?: string[];
}

/**
 * A MONSTER. The world's own predator: no god, no mind, no inference cost.
 *
 * It exists to make the world dangerous without making it expensive. Because it
 * never thinks, it never pays — so it MUST pay some other way, or it would be a
 * one-way drain that ends up holding everything. Hence a metabolism: a monster
 * that stops hunting starves and dies, and its hoard returns to the world.
 */
export interface MonsterEntity {
  id: string;
  name: string;
  pos: Vec3;
  hp: number;
  hpMax: number;
  /** Everything drained from the devots it has killed. Its death releases it. */
  hoard: number;
  state: "alive" | "dead";
  /** The devot it is hunting, if any. */
  targetId?: string;
}

export type FoodType = "grain" | "fruit" | "manna" | "tainted" | "carrion";

export interface FoodEntity {
  id: string;
  pos: Vec3;
  type: FoodType;
  hpValue: number;
  source: "spawn" | "god";
  /** When it appeared. Food that is not eaten rots away. */
  spawnedAt: number;
  /** How long it lasts, in ms, before it is gone for good. */
  ttlMs: number;
}

export interface InferenceUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}
