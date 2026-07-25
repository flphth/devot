import { DEVOT_ACTIONS, type Decision, type DevotAction } from "@devot/shared";

/**
 * Turning a model's text into a validated {@link Decision}.
 *
 * The G1 "porte": 0G providers do not reliably support native `json_schema`
 * structured output, so we cannot trust the model to return clean JSON. This
 * module is the portable path — it (a) describes the schema in the prompt,
 * (b) extracts the JSON object even when wrapped in prose or ``` fences, and
 * (c) validates it. When validation fails, the caller runs the repair path
 * (re-ask once with the parse error) — see `zgMind.ts`.
 */

export type ParseResult =
  | { ok: true; decision: Decision }
  | { ok: false; error: string };

/**
 * The instruction appended to the prompt so a model without native schema
 * support still emits the right shape. Kept close to DECISION_SCHEMA.
 */
export function buildSchemaInstruction(): string {
  return [
    "Respond with a SINGLE JSON object and nothing else — no prose, no markdown fences.",
    "Shape:",
    '{"action": <one of ' +
      DEVOT_ACTIONS.map((a) => `"${a}"`).join(", ") +
      ">,",
    ' "reflection": string,       // ALWAYS: one short sentence of your inner thought right now',
    ' "targetId"?: string,        // devot or food id, for move/eat/attack/reproduce',
    ' "direction"?: {"x": number, "z": number},  // for move',
    ' "utterance"?: string,       // what you SAY ALOUD — set this with action "speak" whenever addressed or wishing to reply',
    ' "emotion"?: string}         // one felt word',
    'Always include "reflection". When a voice from the sky (your god) speaks to you, reflect on it and, if you have something to say, answer with action "speak" and an "utterance".',
  ].join("\n");
}

/**
 * Extract the first balanced JSON object from arbitrary model text. Handles
 * ```json fences and leading/trailing prose (common with reasoning models in
 * plain json_object mode). Returns the raw JSON slice or null.
 */
export function extractJsonObject(text: string): string | null {
  if (!text) return null;
  // Prefer a fenced block if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const haystack = fence?.[1] ?? text;

  const start = haystack.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < haystack.length; i++) {
    const ch = haystack[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return haystack.slice(start, i + 1);
    }
  }
  return null;
}

function isAction(v: unknown): v is DevotAction {
  return typeof v === "string" && (DEVOT_ACTIONS as readonly string[]).includes(v);
}

/**
 * Parse + validate a decision from model text. Lenient about surrounding prose
 * and unknown extra fields; strict about the fields we actually apply.
 */
export function parseDecision(text: string): ParseResult {
  const slice = extractJsonObject(text);
  if (!slice) return { ok: false, error: "no JSON object found in output" };

  let obj: unknown;
  try {
    obj = JSON.parse(slice);
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return { ok: false, error: "output is not a JSON object" };
  }

  const o = obj as Record<string, unknown>;
  if (!isAction(o.action)) {
    return {
      ok: false,
      error: `"action" must be one of ${DEVOT_ACTIONS.join("|")}, got ${JSON.stringify(o.action)}`,
    };
  }

  const decision: Decision = { action: o.action };

  if (o.reflection !== undefined) {
    if (typeof o.reflection !== "string") return { ok: false, error: `"reflection" must be a string` };
    decision.reflection = o.reflection;
  }
  if (o.targetId !== undefined) {
    if (typeof o.targetId !== "string") return { ok: false, error: `"targetId" must be a string` };
    decision.targetId = o.targetId;
  }
  if (o.direction !== undefined) {
    const d = o.direction as Record<string, unknown>;
    if (typeof d !== "object" || d === null || typeof d.x !== "number" || typeof d.z !== "number") {
      return { ok: false, error: `"direction" must be {x:number,z:number}` };
    }
    decision.direction = { x: d.x, z: d.z };
  }
  if (o.utterance !== undefined) {
    if (typeof o.utterance !== "string") return { ok: false, error: `"utterance" must be a string` };
    decision.utterance = o.utterance;
  }
  if (o.emotion !== undefined) {
    if (typeof o.emotion !== "string") return { ok: false, error: `"emotion" must be a string` };
    decision.emotion = o.emotion;
  }

  return { ok: true, decision };
}
