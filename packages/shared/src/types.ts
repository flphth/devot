import type { ItemKind } from "./craft.js";
import type { ModelId } from "./constants.js";

export type DevotLifeState = "alive" | "starving" | "dying" | "dead";

export type CognitionProfileName = "frugal" | "equilibre" | "prophete";

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
  /** Devots already met (one encounter = a single trigger). */
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
