import type { ModelId } from "./constants.js";

export type DevotLifeState = "alive" | "starving" | "dying" | "dead";

export type CognitionProfileName = "frugal" | "balanced" | "prophet";

export interface CognitionProfile {
  name: CognitionProfileName;
  model: ModelId;
  /** Passed through to the API as-is; undefined = no thinking (Haiku). */
  thinking?: { type: "adaptive" };
  effort?: "low" | "medium" | "high";
  maxTokens: number;
}

export type DecisionAction =
  | "idle"
  | "move"
  | "eat"
  | "attack"
  | "reproduce"
  | "speak"
  | "flee";

export interface Decision {
  action: DecisionAction;
  targetId?: string;
  direction?: { x: number; z: number };
  utterance?: string;
  emotion?: string;
  /** Inner monologue: one intimate sentence (≤140 chars). */
  thought?: string;
}

export type TriggerKind =
  | "divine_message" // highest priority
  | "threat" // combat / danger
  | "survival" // low HP
  | "encounter" // meaningful encounter
  | "utterance_heard" // words from another devot
  | "idle_reflection"; // idle musing

export interface Trigger {
  kind: TriggerKind;
  /** Devot or monster — anything that owns a mind. */
  creatureId: string;
  /** Description of the event, injected into the user turn. */
  eventText: string;
  createdAt: number;
}

/** What kind of creature a mind belongs to. They do not read the same rules. */
export type CreatureKind = "devot" | "monster";

/**
 * The read-only view of a creature that its mind is given. Built fresh for
 * every thought — position and HP change between two of them.
 *
 * This is what makes the cognition layer polymorphic: devots and monsters are
 * very different entities in the simulation, but a thought only ever needs
 * this much.
 */
export interface ThoughtSubject {
  id: string;
  kind: CreatureKind;
  name: string;
  pos: Vec3;
  hp: number;
  hpMax: number;
  state: string;
  age: number;
  traits: string[];
  isFounder: boolean;
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

/** A devot's "hot" state inside the simulation (in memory). */
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
  age: number; // cycles lived
  thinking: boolean; // an inference is in flight
  utterance: string; // last spoken words (bubble)
  /** Current goal of the body (deterministic movement between two thoughts). */
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

export type MonsterLifeState = "alive" | "dead";

/**
 * A predator. Unlike a devot it has no god, no lineage and no reproduction —
 * it hunts, it feeds, and it starves if it stops. Its mind runs on a much
 * slower clock than a devot's, which is what keeps a pack of them affordable.
 */
export interface MonsterEntity {
  id: string;
  name: string;
  pos: Vec3;
  hp: number;
  hpMax: number;
  state: MonsterLifeState;
  age: number;
  thinking: boolean;
  /** Growls and threats — monsters do speak, and devots hear them. */
  utterance: string;
  currentGoal:
    | { kind: "prowl" }
    | { kind: "hunt"; targetId: string }
    | { kind: "move_to"; target: Vec3 }
    | { kind: "flee"; from: Vec3 }
    | { kind: "idle" };
  /** Id of the last reported attacker (avoids re-triggering every tick). */
  underAttackBy?: string;
  /** When its mind last ran. The cadence guard lives on this field. */
  lastThoughtAt: number;
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
