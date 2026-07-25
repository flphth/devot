import type { Decision, DevotAction } from "@devot/shared";
import type { Stimulus } from "./stimulus.ts";

/**
 * The "must react" rule.
 *
 * A devot may idle and conserve its life ONLY when nothing is happening. The
 * moment its immediate environment presents a stimulus — a monster on it, food
 * at its feet — standing still and waiting is no longer an allowed choice. It
 * still decides *how* to react (fight, flee, eat, reposition); it just cannot
 * choose to do nothing. The server enforces this (authority), so a mind that
 * returns `idle` under a stimulus is overridden with a default reaction.
 */

/** Actions that count as genuinely reacting to a given stimulus kind. */
const REACTIONS: Record<Exclude<Stimulus["kind"], "none">, readonly DevotAction[]> = {
  threat: ["flee", "attack", "move"],
  food: ["eat", "move"],
};

export function demandsReaction(s: Stimulus): boolean {
  return s.kind !== "none";
}

/** Does this decision actually react to the stimulus? (idle/wait never does.) */
export function isReaction(decision: Decision, s: Stimulus): boolean {
  if (s.kind === "none") return true;
  if (decision.action === "idle") return false;
  return REACTIONS[s.kind].includes(decision.action);
}

/** The default reaction the server imposes when the devot fails to react. */
export function fallbackReaction(s: Stimulus): Decision {
  switch (s.kind) {
    case "threat":
      return { action: "flee", targetId: s.targetId, emotion: "peur" };
    case "food":
      return { action: "eat", targetId: s.targetId, emotion: "faim" };
    case "none":
      return { action: "idle" };
  }
}

export interface EnforcedReaction {
  decision: Decision;
  /** True when the devot tried to wait and the server forced a reaction. */
  coerced: boolean;
}

/**
 * Enforce the rule. If the environment demands a reaction and the devot's
 * decision isn't one, replace it with {@link fallbackReaction} and flag it.
 */
export function enforceReaction(decision: Decision, s: Stimulus): EnforcedReaction {
  if (!demandsReaction(s) || isReaction(decision, s)) return { decision, coerced: false };
  return { decision: fallbackReaction(s), coerced: true };
}

/** The urgent instruction folded into the mind's event when a stimulus is present. */
export function reactionInstruction(s: Stimulus): string {
  switch (s.kind) {
    case "threat":
      return "DANGER IMMÉDIAT : tu ne peux pas rester immobile. Réagis maintenant — fuis ou attaque.";
    case "food":
      return "OPPORTUNITÉ IMMÉDIATE : de la nourriture est à ta portée. Ne reste pas à attendre — agis (mange ou approche).";
    case "none":
      return "";
  }
}
