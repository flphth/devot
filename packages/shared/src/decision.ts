/**
 * The structured decision a devot's mind must return each time it thinks.
 * Mirrors `DECISION_SCHEMA` (kept in lock-step below) so both the runtime
 * validator and any provider-native structured-output call agree.
 */
export type DevotAction =
  | "idle"
  | "move"
  | "eat"
  | "attack"
  | "reproduce"
  | "speak"
  | "flee";

export const DEVOT_ACTIONS: readonly DevotAction[] = [
  "idle",
  "move",
  "eat",
  "attack",
  "reproduce",
  "speak",
  "flee",
] as const;

export interface Decision {
  action: DevotAction;
  /** Devot or food targeted (for move/eat/attack/reproduce). */
  targetId?: string;
  /** Movement direction when action === "move". */
  direction?: { x: number; z: number };
  /** What the devot says when action === "speak". */
  utterance?: string;
  /** A one-word felt emotion, surfaced in the Esprit panel. */
  emotion?: string;
}

/**
 * JSON Schema for a decision. Used two ways:
 *  1. injected into the prompt (the portable path — see parseDecision), and
 *  2. as a provider-native `response_format`/`output_config` schema *when* a
 *     provider supports it (Anthropic does; 0G providers generally do not).
 */
export const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: { type: "string", enum: DEVOT_ACTIONS },
    targetId: { type: "string" },
    direction: {
      type: "object",
      additionalProperties: false,
      required: ["x", "z"],
      properties: { x: { type: "number" }, z: { type: "number" } },
    },
    utterance: { type: "string" },
    emotion: { type: "string" },
  },
} as const;
