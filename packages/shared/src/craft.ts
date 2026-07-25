import type { StatKey, Stats } from "./appearance.js";

/**
 * CRAFTING — thought becomes matter.
 *
 * Forging costs HP. And HP are the thinking budget: a devot who forges chooses
 * to think for less time in order to act more forcefully. It is the same
 * trade-off as the creation budget, but taken MID-LIFE, by the devot itself, and
 * paid out of what it has left to live.
 *
 * No resources to gather, no ore inventory: the raw material is life. That is
 * what keeps the game coherent with its founding principle instead of grafting a
 * parallel economy onto it.
 */

export const ITEM_KINDS = ["spear", "shield", "boots", "scope"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface Recipe {
  kind: ItemKind;
  /** HP taken at the forge. */
  cost: number;
  /** Stat strengthened, and by how many points. */
  stat: StatKey;
  bonus: number;
  /** What the devot understands of it, in its prompt. */
  description: string;
}

/**
 * Four recipes, one per stat.
 *
 * These costs were calibrated against a 50,000 HP pool, where a shield cut away
 * an eighth of a whole life. The pool having been TRIPLED to 150,000, the same
 * shield now costs only 4%, and two items 6.7% instead of 20%. Forging has
 * therefore become markedly easier — the "power for lifespan" bargain still
 * exists, but it is no longer cruel.
 *
 * This is a call to make, not an oversight: tripling them in turn would restore
 * the original difficulty, leaving them as they are makes items an everyday
 * decision rather than a sacrifice.
 */
export const RECIPES: Record<ItemKind, Recipe> = {
  spear: {
    kind: "spear",
    cost: 4_000,
    stat: "power",
    bonus: 1,
    description: "a spear: you strike harder, but you paid with your life to carve it",
  },
  shield: {
    kind: "shield",
    cost: 6_000,
    stat: "vitality",
    bonus: 1,
    description: "a shield: you endure more, at the cost of part of your existence",
  },
  boots: {
    kind: "boots",
    cost: 3_000,
    stat: "speed",
    bonus: 1,
    description: "boots: you move faster, and you sold thinking time for it",
  },
  scope: {
    kind: "scope",
    cost: 3_500,
    stat: "sight",
    bonus: 1,
    description: "a scope: you see further, so you have more to think about — and less life to do it",
  },
};

/**
 * Two items carried at most. Beyond that, forging would mean dropping one: the
 * limit forces a choice rather than an accumulation, and keeps a devot's body
 * readable at a glance.
 */
export const MAX_CARRIED = 2;

/**
 * A devot must SURVIVE its forging, with room to spare. Forging to exhaustion
 * would be suicide in disguise, and a model that does not yet grasp this world's
 * economy would do exactly that.
 */
export const CRAFT_HP_FLOOR = 8_000;

export interface CraftRejection {
  reason: string;
}

/** The requested recipe, or null if the name is unknown. */
export function recipeOf(kind: unknown): Recipe | null {
  return typeof kind === "string" && (ITEM_KINDS as readonly string[]).includes(kind)
    ? RECIPES[kind as ItemKind]
    : null;
}

/**
 * Can this be forged? Checked SERVER-SIDE: that is where the real cost is paid.
 */
export function canCraft(
  kind: unknown,
  hp: number,
  carried: readonly ItemKind[],
): CraftRejection | null {
  const recipe = recipeOf(kind);
  if (!recipe) return { reason: "No such item." };
  if (carried.length >= MAX_CARRIED) {
    return { reason: `You already carry ${MAX_CARRIED} items; you would have to drop one.` };
  }
  if (carried.includes(recipe.kind)) {
    return { reason: `You already carry a ${recipe.kind}.` };
  }
  if (hp - recipe.cost < CRAFT_HP_FLOOR) {
    return {
      reason: `Forging a ${recipe.kind} costs ${recipe.cost} HP, and too little would remain to live on.`,
    };
  }
  return null;
}

/** Effective stats: those of the body, raised by what it carries. */
export function statsWithItems(base: Stats, carried: readonly ItemKind[]): Stats {
  const out = { ...base };
  for (const kind of carried) {
    const recipe = RECIPES[kind];
    if (!recipe) continue;
    out[recipe.stat] = out[recipe.stat] + recipe.bonus;
  }
  return out;
}

/** What the devot carries, in plain words, for its prompt and for others. */
export function describeItems(carried: readonly ItemKind[]): string {
  if (carried.length === 0) return "empty-handed";
  return carried.join(" and ");
}

/** The recipes as explained to the model. Without this, it will never forge. */
export function craftRulesForPrompt(): string {
  const lines = ITEM_KINDS.map((k) => {
    const r = RECIPES[k];
    return `- ${r.kind} (${r.cost} HP): ${r.description}`;
  });
  return [
    'You can FORGE an item with the "craft" action. There is no raw material in',
    "this world: the material is your life. Forging takes HP, so it takes thinking time.",
    ...lines,
    `You may carry only ${MAX_CARRIED} items, and you must stay above ${CRAFT_HP_FLOOR} HP.`,
  ].join("\n");
}
