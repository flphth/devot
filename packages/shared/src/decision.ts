import { UTTERANCE_MAX_CHARS } from "./constants.js";
import type { Decision, DecisionAction } from "./types.js";

/** JSON schema for the structured output of a thought (output_config.format). */
export const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "thought"],
  properties: {
    action: {
      type: "string",
      enum: ["idle", "move", "eat", "attack", "reproduce", "speak", "flee", "craft"],
      description: "The action chosen for this thought.",
    },
    thought: {
      type: "string",
      description:
        "Your inner monologue: one intimate first-person sentence, 140 characters maximum. It costs you life too.",
    },
    targetId: {
      type: "string",
      description: "Id of the targeted devot or food (eat/attack/reproduce).",
    },
    item: {
      type: "string",
      enum: ["spear", "shield", "boots", "scope"],
      description: "Item to forge if action=craft. Its HP cost is taken from your life.",
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
      description: "Émotion dominante en un mot.",
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
  "craft",
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
  // The requested item is not validated here: the SERVER decides whether the
  // forge is possible, knowing the HP and what the devot already carries.
  if (typeof d.item === "string") decision.item = d.item as Decision["item"];
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
