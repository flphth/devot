import type { Micro } from "@devot/shared";

/**
 * A residue — what a devot leaves on the ground when it dies.
 *
 * A dead devot's remaining balance does not vanish: it drops to the ground as
 * food. The living pick it up and recharge from it. This closes the economy —
 * no money is created or destroyed at death, it merely changes hands. It is the
 * sim-level primitive behind G4's "la nourriture = ce qui est mort" and the
 * conservation invariant G3 will enforce on-chain (Σ soldes + brûlé == Σ déposé).
 */
export interface Residue {
  id: string;
  /** The devot whose death produced this residue. */
  fromDevotId: string;
  /** The leftover life, in µ$ (same denomination as a devot's balance). */
  balance: Micro;
}

/**
 * Produce the residue a dying devot drops. Returns null when there is nothing
 * left (a devot that starved to 0 leaves no food) — so no zero-value residue
 * litters the ground and conservation stays exact.
 */
export function dropResidue(id: string, fromDevotId: string, leftover: Micro): Residue | null {
  if (leftover <= 0) return null;
  return { id, fromDevotId, balance: leftover };
}

/** The amount a devot gains by consuming a residue (pure; the caller credits it). */
export function residueValue(r: Residue): Micro {
  return r.balance;
}
