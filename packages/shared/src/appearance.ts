/**
 * L'APPARENCE ET LES STATS D'UN DEVOT.
 *
 * Ce module est la source unique de vérité : le client s'en sert pour dessiner
 * l'écran de création et l'aperçu, le serveur pour VALIDER ce qu'il reçoit, et
 * la simulation pour en tirer les effets de jeu. Une seule définition, donc
 * aucune divergence possible entre ce que le joueur croit choisir, ce que le
 * serveur accepte, et ce qui se produit dans le monde.
 *
 * Rien de ce qui vient du client n'est cru sur parole. `validateAppearance`
 * est appelée côté serveur avant toute naissance.
 */

// ── Emplacements d'apparence ────────────────────────────────────────────────

export const HATS = ["aucun", "bonnet", "large", "casque", "couronne"] as const;
export const CAPES = ["aucune", "courte", "longue"] as const;
export const FACES = ["aucun", "lunettes", "masque", "bandeau"] as const;
export const BUILDS = ["fluet", "normal", "massif"] as const;

export type Hat = (typeof HATS)[number];
export type Cape = (typeof CAPES)[number];
export type Face = (typeof FACES)[number];
export type Build = (typeof BUILDS)[number];

/**
 * Palettes fermées plutôt que couleurs libres. Deux raisons : le serveur peut
 * valider ce qu'il reçoit (une couleur arbitraire serait un vecteur d'injection
 * dans le rendu et dans les prompts), et un monde à palette limitée reste
 * lisible — on distingue les devots au lieu de nager dans un dégradé.
 */
export const SHIRT_COLORS = [
  "#e0634c",
  "#e0b34c",
  "#7dbc5e",
  "#4ca6e0",
  "#9c4ce0",
  "#e04c8f",
  "#e8e4d8",
  "#3a4150",
] as const;

export const PANTS_COLORS = [
  "#2f3542",
  "#4a4f57",
  "#6b5844",
  "#3a5a40",
  "#5a3a4a",
  "#8a8f98",
] as const;

export const SKIN_COLORS = [
  "#f0c9a4",
  "#d9a46f",
  "#a9704a",
  "#7a4a2f",
  "#4a3324",
  "#c9d4e0",
] as const;

export interface Appearance {
  hat: Hat;
  shirt: string;
  pants: string;
  cape: Cape;
  face: Face;
  skin: string;
  build: Build;
}

// ── Stats, réparties sur un budget ──────────────────────────────────────────

/**
 * Quatre stats, chacune entre 1 et 5, dont la somme vaut EXACTEMENT le budget.
 *
 * Le budget est ce qui empêche la création d'être une simple liste de courses :
 * on ne choisit pas « le meilleur casque », on répartit une enveloppe. Chaque
 * point donné à la vigueur est un point retiré à la vue.
 */
export interface Stats {
  /** Points de vie maximaux — donc durée de vie ET budget de pensée. */
  vitality: number;
  /** Dégâts infligés en attaquant. */
  power: number;
  /** Vitesse de déplacement. */
  speed: number;
  /** Rayon de perception, donc ce qui entre dans son prompt. */
  sight: number;
}

export const STAT_MIN = 1;
export const STAT_MAX = 5;
export const STAT_BUDGET = 12;
export const STAT_KEYS = ["vitality", "power", "speed", "sight"] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export const STAT_LABELS: Record<StatKey, string> = {
  vitality: "vigueur",
  power: "force",
  speed: "vivacité",
  sight: "vue",
};

/**
 * Multiplicateur appliqué à la grandeur de base d'une stat.
 *
 * 3 est le point neutre (multiplicateur 1). Chaque point vaut 20 % : de 0,6 à
 * 1,4. L'écart est net sans être écrasant — un devot de vigueur 5 vit presque
 * deux fois plus longtemps qu'un devot de vigueur 1, ce qui se voit, mais il
 * l'a payé sur ses trois autres stats.
 */
export function statMultiplier(value: number): number {
  return 0.4 + 0.2 * clampStat(value);
}

function clampStat(v: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return STAT_MIN;
  return n < STAT_MIN ? STAT_MIN : n > STAT_MAX ? STAT_MAX : n;
}

// ── Valeurs par défaut ──────────────────────────────────────────────────────

export const DEFAULT_STATS: Stats = { vitality: 3, power: 3, speed: 3, sight: 3 };

export const DEFAULT_APPEARANCE: Appearance = {
  hat: "aucun",
  shirt: SHIRT_COLORS[3]!,
  pants: PANTS_COLORS[0]!,
  cape: "aucune",
  face: "aucun",
  skin: SKIN_COLORS[0]!,
  build: "normal",
};

// ── Validation, côté serveur ────────────────────────────────────────────────

export interface Rejection {
  reason: string;
}

/**
 * Valide une apparence reçue d'un client. Renvoie null si elle est légale.
 * Tout est vérifié : chaque emplacement doit appartenir à sa liste fermée.
 */
export function validateAppearance(a: unknown): Rejection | null {
  if (!a || typeof a !== "object") return { reason: "Apparence absente." };
  const v = a as Record<string, unknown>;
  const inList = (value: unknown, list: readonly string[]): boolean =>
    typeof value === "string" && list.includes(value);

  if (!inList(v.hat, HATS)) return { reason: "Chapeau inconnu." };
  if (!inList(v.cape, CAPES)) return { reason: "Cape inconnue." };
  if (!inList(v.face, FACES)) return { reason: "Accessoire de visage inconnu." };
  if (!inList(v.build, BUILDS)) return { reason: "Corpulence inconnue." };
  if (!inList(v.shirt, SHIRT_COLORS)) return { reason: "Couleur de t-shirt hors palette." };
  if (!inList(v.pants, PANTS_COLORS)) return { reason: "Couleur de pantalon hors palette." };
  if (!inList(v.skin, SKIN_COLORS)) return { reason: "Teinte de peau hors palette." };
  return null;
}

/**
 * Valide une répartition de stats. C'est ICI que se joue l'anti-triche de la
 * création : un client modifié qui demanderait 5 partout serait refusé, parce
 * que la somme doit valoir exactement le budget.
 */
export function validateStats(s: unknown): Rejection | null {
  if (!s || typeof s !== "object") return { reason: "Stats absentes." };
  const v = s as Record<string, unknown>;
  let total = 0;
  for (const key of STAT_KEYS) {
    const raw = v[key];
    if (typeof raw !== "number" || !Number.isInteger(raw)) {
      return { reason: `La stat « ${STAT_LABELS[key]} » doit être un entier.` };
    }
    if (raw < STAT_MIN || raw > STAT_MAX) {
      return {
        reason: `« ${STAT_LABELS[key]} » doit être entre ${STAT_MIN} et ${STAT_MAX}.`,
      };
    }
    total += raw;
  }
  if (total !== STAT_BUDGET) {
    return { reason: `Le total des stats doit valoir exactement ${STAT_BUDGET} (reçu ${total}).` };
  }
  return null;
}

// ── Signature ───────────────────────────────────────────────────────────────

/**
 * Identifiant court dérivé de TOUS les choix : apparence, stats, traits, âme.
 *
 * Ce n'est pas un secret ni une preuve — c'est une référence, comme le numéro
 * d'une pièce dans une collection. Deux devots identiques auraient la même,
 * mais avec sept emplacements, quatre stats réparties et douze traits, l'espace
 * est assez vaste pour que cela n'arrive pas en pratique.
 */
export function signatureOf(
  appearance: Appearance,
  stats: Stats,
  traits: readonly string[],
  soul: string,
): string {
  const source = [
    appearance.hat,
    appearance.shirt,
    appearance.pants,
    appearance.cape,
    appearance.face,
    appearance.skin,
    appearance.build,
    STAT_KEYS.map((k) => stats[k]).join(""),
    [...traits].sort().join(","),
    soul,
  ].join("|");

  // FNV-1a 32 bits : court, sans dépendance, et suffisamment dispersé pour que
  // deux choix voisins donnent deux signatures franchement différentes.
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const body = h.toString(36).toUpperCase().padStart(7, "0").slice(-7);
  return `DVT-${body.slice(0, 3)}-${body.slice(3)}`;
}

// ── Sérialisation ───────────────────────────────────────────────────────────

/**
 * L'apparence voyage et se persiste en JSON compact. Elle ne change jamais
 * après la naissance : un seul champ, écrit une fois, plutôt qu'une dizaine de
 * champs synchronisés à chaque tick.
 */
export interface Identity {
  appearance: Appearance;
  stats: Stats;
  /** Le texte libre du joueur : ce que le devot croit être. */
  soul: string;
  signature: string;
}

export const SOUL_MAX_CHARS = 140;

export function encodeIdentity(identity: Identity): string {
  return JSON.stringify(identity);
}

/** Décode une identité persistée. Renvoie null si elle est illisible. */
export function decodeIdentity(raw: string | null | undefined): Identity | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Identity;
    if (validateAppearance(parsed?.appearance) || validateStats(parsed?.stats)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Identité par défaut : pour un devot né sans création (reproduction, mode god). */
export function defaultIdentity(traits: readonly string[] = []): Identity {
  return {
    appearance: { ...DEFAULT_APPEARANCE },
    stats: { ...DEFAULT_STATS },
    soul: "",
    signature: signatureOf(DEFAULT_APPEARANCE, DEFAULT_STATS, traits, ""),
  };
}

// ── Hérédité ────────────────────────────────────────────────────────────────

/**
 * L'identité d'un enfant, tirée de celle de ses parents.
 *
 * L'apparence se mélange emplacement par emplacement : le chapeau vient de
 * l'un, le t-shirt de l'autre, au hasard. On reconnaît donc une famille à
 * l'écran — c'est le pendant visible du mélange de traits qui existe déjà.
 *
 * Les stats se moyennent, puis sont RAMENÉES AU BUDGET. Sans cette
 * renormalisation, deux parents doués donneraient un enfant hors budget, et la
 * validation du serveur le refuserait dans les générations suivantes : une
 * lignée finirait par produire des enfants illégaux.
 */
export function inheritIdentity(
  a: Identity,
  b: Identity | undefined,
  traits: readonly string[],
  rng: () => number,
): Identity {
  const other = b ?? a;
  const pick = <T>(x: T, y: T): T => (rng() < 0.5 ? x : y);

  const appearance: Appearance = {
    hat: pick(a.appearance.hat, other.appearance.hat),
    shirt: pick(a.appearance.shirt, other.appearance.shirt),
    pants: pick(a.appearance.pants, other.appearance.pants),
    cape: pick(a.appearance.cape, other.appearance.cape),
    face: pick(a.appearance.face, other.appearance.face),
    skin: pick(a.appearance.skin, other.appearance.skin),
    build: pick(a.appearance.build, other.appearance.build),
  };

  const blended = STAT_KEYS.map((k) => (a.stats[k] + other.stats[k]) / 2);
  const stats = normalizeToBudget(blended);
  const soul = pick(a.soul, other.soul);
  return { appearance, stats, soul, signature: signatureOf(appearance, stats, traits, soul) };
}

/**
 * Ramène quatre valeurs quelconques à une répartition LÉGALE : entiers, chacun
 * entre STAT_MIN et STAT_MAX, de somme exactement STAT_BUDGET.
 *
 * On arrondit d'abord, puis on corrige le reste point par point en le donnant
 * (ou en le retirant) à la stat la plus éloignée de sa borne. La forme du
 * profil parental est ainsi conservée autant que le budget le permet.
 */
export function normalizeToBudget(values: readonly number[]): Stats {
  const n = STAT_KEYS.length;
  const out = values.slice(0, n).map((v) => {
    const r = Math.round(Number.isFinite(v) ? v : STAT_MIN);
    return r < STAT_MIN ? STAT_MIN : r > STAT_MAX ? STAT_MAX : r;
  });
  while (out.length < n) out.push(STAT_MIN);

  let total = out.reduce((s, v) => s + v, 0);
  let guard = 0;
  while (total !== STAT_BUDGET && guard++ < 64) {
    const up = total < STAT_BUDGET;
    // La stat la plus basse monte, la plus haute descend : on reste au plus
    // près du profil hérité.
    let best = -1;
    let bestValue = up ? STAT_MAX + 1 : STAT_MIN - 1;
    for (let i = 0; i < n; i++) {
      const v = out[i]!;
      if (up ? v < bestValue && v < STAT_MAX : v > bestValue && v > STAT_MIN) {
        best = i;
        bestValue = v;
      }
    }
    if (best < 0) break; // toutes aux bornes : le budget est inatteignable
    out[best] = out[best]! + (up ? 1 : -1);
    total += up ? 1 : -1;
  }

  const stats = {} as Stats;
  STAT_KEYS.forEach((k, i) => {
    stats[k] = out[i]!;
  });
  return stats;
}
