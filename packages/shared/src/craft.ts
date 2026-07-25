import type { StatKey, Stats } from "./appearance.js";

/**
 * LE CRAFT — la pensée devient matière.
 *
 * Forger coûte des PV. Or les PV sont le budget de pensée : un devot qui forge
 * décide de penser moins longtemps pour agir plus fort. C'est le même
 * arbitrage que le budget de la création, mais pris EN COURS DE VIE, par le
 * devot lui-même, et payé sur ce qui lui reste à vivre.
 *
 * Aucune ressource à ramasser, aucun inventaire de minerai : la matière
 * première est la vie. C'est ce qui garde le jeu cohérent avec son principe
 * fondateur au lieu d'y greffer une économie parallèle.
 */

export const ITEM_KINDS = ["spear", "shield", "boots", "scope"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface Recipe {
  kind: ItemKind;
  /** PV prélevés à la forge. */
  cost: number;
  /** Stat renforcée, et de combien de points. */
  stat: StatKey;
  bonus: number;
  /** Ce que le devot en comprend, dans son prompt. */
  description: string;
}

/**
 * Quatre recettes, une par stat.
 *
 * Ces coûts ont été calibrés sur une réserve de 50 000 PV, où un bouclier
 * amputait un huitième d'une vie entière. La réserve ayant été TRIPLÉE à
 * 150 000, le même bouclier n'en coûte plus que 4 %, et deux objets 6,7 % au
 * lieu de 20 %. Forger est donc devenu nettement plus facile — le marché
 * « puissance contre durée » existe encore, mais il n'est plus cruel.
 *
 * C'est un arbitrage à trancher, pas un oubli : les tripler à leur tour
 * rétablirait la difficulté d'origine, les laisser tels quels fait des objets
 * une décision courante plutôt qu'un sacrifice.
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
 * Deux objets portés au plus. Au-delà, forger obligerait à en abandonner un :
 * la limite force un choix plutôt qu'une accumulation, et garde le corps d'un
 * devot lisible d'un coup d'œil.
 */
export const MAX_CARRIED = 2;

/**
 * Un devot doit SURVIVRE à sa forge, et avec de la marge. Forger jusqu'à
 * l'épuisement serait un suicide déguisé, et un modèle qui ne comprend pas
 * encore l'économie du monde le ferait.
 */
export const CRAFT_HP_FLOOR = 8_000;

export interface CraftRejection {
  reason: string;
}

/** Recette demandée, ou null si le nom est inconnu. */
export function recipeOf(kind: unknown): Recipe | null {
  return typeof kind === "string" && (ITEM_KINDS as readonly string[]).includes(kind)
    ? RECIPES[kind as ItemKind]
    : null;
}

/**
 * Peut-on forger ? Vérifié CÔTÉ SERVEUR : c'est là que se joue le coût réel.
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

/** Stats effectives : celles du corps, augmentées par ce qu'il porte. */
export function statsWithItems(base: Stats, carried: readonly ItemKind[]): Stats {
  const out = { ...base };
  for (const kind of carried) {
    const recipe = RECIPES[kind];
    if (!recipe) continue;
    out[recipe.stat] = out[recipe.stat] + recipe.bonus;
  }
  return out;
}

/** Ce que le devot porte, en français, pour son prompt et pour les autres. */
export function describeItems(carried: readonly ItemKind[]): string {
  if (carried.length === 0) return "empty-handed";
  return carried.join(" and ");
}

/** Les recettes telles qu'on les explique au modèle. Sans cela, il ne forgera jamais. */
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
