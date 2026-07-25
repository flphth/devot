/**
 * A stimulus in a devot's *immediate* environment — the thing the reactive
 * layer (PerceptionSystem) surfaces when something is close enough that the
 * devot can no longer just stand and wait.
 *
 *  - "threat"  : a hostile entity (e.g. a monster) is upon it → fight or flee.
 *  - "food"    : edible matter is within reach → seize it (or move to it).
 *  - "none"    : nothing pressing → the devot may idle and conserve life.
 */
export type StimulusKind = "threat" | "food" | "none";

export interface Stimulus {
  kind: StimulusKind;
  /** The world id of the monster / food the stimulus refers to. */
  targetId?: string;
  /** Human-readable description, injected into the mind's event. */
  description: string;
  /** Grid/space distance; a stimulus is "immediate" when close enough. */
  distance?: number;
}

export const NO_STIMULUS: Stimulus = { kind: "none", description: "" };

export function threat(targetId: string, description: string, distance = 0): Stimulus {
  return { kind: "threat", targetId, description, distance };
}

export function food(targetId: string, description: string, distance = 0): Stimulus {
  return { kind: "food", targetId, description, distance };
}
