import { UTTERANCE_MAX_CHARS } from "./constants.js";
import type { Decision, DecisionAction } from "./types.js";

/** Schéma JSON de la sortie structurée d'une pensée (output_config.format). */
export const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "thought"],
  properties: {
    action: {
      type: "string",
      enum: ["idle", "move", "eat", "attack", "reproduce", "speak", "flee"],
      description: "L'action choisie pour cette pensée.",
    },
    thought: {
      type: "string",
      description:
        "Ton monologue intérieur : une pensée intime à la première personne, une phrase, 140 caractères maximum. Elle aussi te coûte de la vie.",
    },
    targetId: {
      type: "string",
      description: "Id du devot ou de la nourriture visé (eat/attack/reproduce).",
    },
    direction: {
      type: "object",
      additionalProperties: false,
      required: ["x", "z"],
      properties: { x: { type: "number" }, z: { type: "number" } },
      description: "Direction de déplacement (move/flee), vecteur unitaire approximatif.",
    },
    utterance: {
      type: "string",
      description: `Parole prononcée si action=speak, ${UTTERANCE_MAX_CHARS} caractères max.`,
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
];

/** Valide et normalise une décision brute (JSON parsé) ; jette si invalide. */
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
