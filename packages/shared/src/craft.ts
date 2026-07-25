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

export const ITEM_KINDS = ["lance", "bouclier", "bottes", "lunette"] as const;
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
 * Quatre recettes, une par stat. Les coûts sont volontairement LOURDS : à
 * 6 000 PV sur une réserve de 50 000, forger un bouclier ampute un huitième
 * d'une vie entière. Un devot chargé de deux objets a sacrifié un quart de son
 * existence — il frappe mieux et meurt plus tôt, ce qui est exactement le
 * marché qu'on veut lui proposer.
 */
export const RECIPES: Record<ItemKind, Recipe> = {
  lance: {
    kind: "lance",
    cost: 4_000,
    stat: "power",
    bonus: 1,
    description: "une lance : tu frappes plus fort, mais tu as payé de ta vie pour la tailler",
  },
  bouclier: {
    kind: "bouclier",
    cost: 6_000,
    stat: "vitality",
    bonus: 1,
    description: "un bouclier : tu encaisses davantage, au prix d'une part de ton existence",
  },
  bottes: {
    kind: "bottes",
    cost: 3_000,
    stat: "speed",
    bonus: 1,
    description: "des bottes : tu vas plus vite, et tu as vendu du temps de pensée pour cela",
  },
  lunette: {
    kind: "lunette",
    cost: 3_500,
    stat: "sight",
    bonus: 1,
    description: "une lunette : tu vois plus loin, donc tu as plus à penser — et moins pour le faire",
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
  if (!recipe) return { reason: "Cet objet n'existe pas." };
  if (carried.length >= MAX_CARRIED) {
    return { reason: `Tu portes déjà ${MAX_CARRIED} objets ; il faudrait en abandonner un.` };
  }
  if (carried.includes(recipe.kind)) {
    return { reason: `Tu portes déjà ${recipe.kind === "bottes" ? "des" : "un"} ${recipe.kind}.` };
  }
  if (hp - recipe.cost < CRAFT_HP_FLOOR) {
    return {
      reason: `Forger ${recipe.kind} coûte ${recipe.cost} PV, et il t'en resterait trop peu pour vivre.`,
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
  if (carried.length === 0) return "les mains nues";
  return carried.join(" et ");
}

/** Les recettes telles qu'on les explique au modèle. Sans cela, il ne forgera jamais. */
export function craftRulesForPrompt(): string {
  const lines = ITEM_KINDS.map((k) => {
    const r = RECIPES[k];
    return `- ${r.kind} (${r.cost} PV) : ${r.description}`;
  });
  return [
    "Tu peux FORGER un objet avec l'action \"craft\". Il n'y a pas de matière première :",
    "la matière, c'est ta vie. Forger prélève des PV, donc du temps de pensée.",
    ...lines,
    `Tu ne peux porter que ${MAX_CARRIED} objets, et tu dois rester au-dessus de ${CRAFT_HP_FLOOR} PV.`,
  ].join("\n");
}
