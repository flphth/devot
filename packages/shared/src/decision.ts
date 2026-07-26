import { UTTERANCE_MAX_CHARS } from "./constants.js";
import type { Decision, DecisionAction } from "./types.js";

/** JSON schema of a thought's structured output (output_config.format). */
export const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "thought"],
  properties: {
    action: {
      type: "string",
      enum: ["idle", "move", "eat", "attack", "reproduce", "speak", "flee"],
      description: "The action chosen for this thought.",
    },
    thought: {
      type: "string",
      description:
        "Your inner monologue: one intimate first-person sentence, 140 characters maximum. It costs you life too.",
    },
    targetId: {
      type: "string",
      description: "Id of the targeted devot, monster or food (eat/attack/reproduce).",
    },
    direction: {
      type: "object",
      additionalProperties: false,
      required: ["x", "z"],
      properties: { x: { type: "number" }, z: { type: "number" } },
      description: "Movement direction (move/flee), roughly a unit vector.",
    },
    utterance: {
      type: "string",
      description: `Words spoken if action=speak, ${UTTERANCE_MAX_CHARS} characters max.`,
    },
    emotion: {
      type: "string",
      description: "Dominant emotion, in a single word.",
    },
  },
} as const;

const ACTIONS: DecisionAction[] = [
  "idle",
  "move",
  "eat",
  "attack",
  "reproduce",
  "speak",
  "flee",
];

/** Validates and normalises a raw decision (parsed JSON); throws if invalid. */
export function parseDecision(raw: unknown): Decision {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("decision: not an object");
  }
  const d = raw as Record<string, unknown>;
  if (typeof d.action !== "string" || !ACTIONS.includes(d.action as DecisionAction)) {
    throw new Error(`decision: invalid action ${String(d.action)}`);
  }
  const decision: Decision = { action: d.action as DecisionAction };
  if (typeof d.targetId === "string") decision.targetId = d.targetId;
  if (
    typeof d.direction === "object" &&
    d.direction !== null &&
    typeof (d.direction as Record<string, unknown>).x === "number" &&
    typeof (d.direction as Record<string, unknown>).z === "number"
  ) {
    const dir = d.direction as { x: number; z: number };
    decision.direction = { x: dir.x, z: dir.z };
  }
  if (typeof d.utterance === "string") {
    decision.utterance = d.utterance.slice(0, UTTERANCE_MAX_CHARS);
  }
  if (typeof d.emotion === "string") decision.emotion = d.emotion;
  if (typeof d.thought === "string") {
    decision.thought = d.thought.slice(0, UTTERANCE_MAX_CHARS);
  }
  return decision;
}
