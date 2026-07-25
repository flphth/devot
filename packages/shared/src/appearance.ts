/**
 * A DEVOT'S APPEARANCE AND STATS.
 *
 * This module is the single source of truth: the client uses it to draw the
 * creation screen and the preview, the server to VALIDATE what it receives, and
 * the simulation to derive the game effects. One definition, so no possible
 * divergence between what the player believes they chose, what the server
 * accepts, and what actually happens in the world.
 *
 * Nothing coming from a client is taken on trust. `validateAppearance` is called
 * server-side before any birth.
 */
import { PERCEPTION_RADIUS } from "./constants.js";

// ── Appearance slots ────────────────────────────────────────────────────────

export const HATS = ["none", "cap", "widebrim", "helmet", "crown"] as const;
export const CAPES = ["none", "short", "long"] as const;
export const FACES = ["none", "glasses", "mask", "blindfold"] as const;
export const BUILDS = ["slim", "average", "heavy"] as const;

export type Hat = (typeof HATS)[number];
export type Cape = (typeof CAPES)[number];
export type Face = (typeof FACES)[number];
export type Build = (typeof BUILDS)[number];

/**
 * Closed palettes rather than free colours. Two reasons: the server can validate
 * what it receives (an arbitrary colour would be an injection vector into both
 * the rendering and the prompts), and a world with a limited palette stays
 * readable — you tell devots apart instead of swimming in a gradient.
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

// ── Stats, spread over a budget ─────────────────────────────────────────────

/**
 * Four stats, each between 1 and 5, summing to EXACTLY the budget.
 *
 * The budget is what stops creation from being a shopping list: you do not pick
 * "the best helmet", you spread a fixed allowance. Every point given to vigour
 * is a point taken from sight.
 */
export interface Stats {
  /** Maximum hit points — hence lifespan AND thinking budget. */
  vitality: number;
  /** Damage dealt when attacking. */
  power: number;
  /** Movement speed. */
  speed: number;
  /** Perception radius, hence what enters their prompt. */
  sight: number;
}

export const STAT_MIN = 1;
export const STAT_MAX = 5;
export const STAT_BUDGET = 12;
export const STAT_KEYS = ["vitality", "power", "speed", "sight"] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export const STAT_LABELS: Record<StatKey, string> = {
  vitality: "vigour",
  power: "power",
  speed: "swiftness",
  sight: "sight",
};

/**
 * Multiplier applied to a stat's base magnitude.
 *
 * 3 is the neutral point (multiplier 1). Each point is worth 20%: from 0.6 to
 * 1.4. The gap is clear without being crushing — a devot with vigour 5 lives
 * almost twice as long as one with vigour 1, which shows, but they paid for it
 * across their three other stats.
 */
export function statMultiplier(value: number): number {
  return 0.4 + 0.2 * clampStat(value);
}

function clampStat(v: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return STAT_MIN;
  return n < STAT_MIN ? STAT_MIN : n > STAT_MAX ? STAT_MAX : n;
}

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_STATS: Stats = { vitality: 3, power: 3, speed: 3, sight: 3 };

export const DEFAULT_APPEARANCE: Appearance = {
  hat: "none",
  shirt: SHIRT_COLORS[3]!,
  pants: PANTS_COLORS[0]!,
  cape: "none",
  face: "none",
  skin: SKIN_COLORS[0]!,
  build: "average",
};

// ── Validation, server-side ─────────────────────────────────────────────────

export interface Rejection {
  reason: string;
}

/**
 * Validates an appearance received from a client. Returns null if it is legal.
 * Everything is checked: each slot must belong to its closed list.
 */
export function validateAppearance(a: unknown): Rejection | null {
  if (!a || typeof a !== "object") return { reason: "Missing appearance." };
  const v = a as Record<string, unknown>;
  const inList = (value: unknown, list: readonly string[]): boolean =>
    typeof value === "string" && list.includes(value);

  if (!inList(v.hat, HATS)) return { reason: "Unknown hat." };
  if (!inList(v.cape, CAPES)) return { reason: "Unknown cape." };
  if (!inList(v.face, FACES)) return { reason: "Unknown face gear." };
  if (!inList(v.build, BUILDS)) return { reason: "Unknown build." };
  if (!inList(v.shirt, SHIRT_COLORS)) return { reason: "Shirt colour outside the palette." };
  if (!inList(v.pants, PANTS_COLORS)) return { reason: "Trouser colour outside the palette." };
  if (!inList(v.skin, SKIN_COLORS)) return { reason: "Skin tone outside the palette." };
  return null;
}

/**
 * Validates a stat spread. THIS is where creation's anti-cheat lives: a tampered
 * client asking for 5 everywhere is refused, because the total must equal the
 * budget exactly.
 */
export function validateStats(s: unknown): Rejection | null {
  if (!s || typeof s !== "object") return { reason: "Missing stats." };
  const v = s as Record<string, unknown>;
  let total = 0;
  for (const key of STAT_KEYS) {
    const raw = v[key];
    if (typeof raw !== "number" || !Number.isInteger(raw)) {
      return { reason: `Stat "${STAT_LABELS[key]}" must be a whole number.` };
    }
    if (raw < STAT_MIN || raw > STAT_MAX) {
      return {
        reason: `"${STAT_LABELS[key]}" must be between ${STAT_MIN} and ${STAT_MAX}.`,
      };
    }
    total += raw;
  }
  if (total !== STAT_BUDGET) {
    return { reason: `Stats must total exactly ${STAT_BUDGET} (received ${total}).` };
  }
  return null;
}

// ── Signature ───────────────────────────────────────────────────────────────

/**
 * A short identifier derived from ALL the choices: appearance, stats, traits,
 * soul.
 *
 * It is neither a secret nor a proof — it is a reference, like the number on a
 * piece in a collection. Two identical devots would share one, but with seven
 * slots, four spread stats and twelve traits, the space is wide enough that this
 * does not happen in practice.
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

  // FNV-1a 32-bit: short, dependency-free, and dispersed enough that two
  // neighbouring choices give two clearly different signatures.
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const body = h.toString(36).toUpperCase().padStart(7, "0").slice(-7);
  return `DVT-${body.slice(0, 3)}-${body.slice(3)}`;
}

// ── Serialisation ───────────────────────────────────────────────────────────

/**
 * The appearance travels and persists as compact JSON. It never changes after
 * birth: a single field, written once, rather than a dozen fields synchronised
 * on every tick.
 */
export interface Identity {
  appearance: Appearance;
  stats: Stats;
  /** The player's free text: what the devot believes itself to be. */
  soul: string;
  signature: string;
}

export const SOUL_MAX_CHARS = 140;

export function encodeIdentity(identity: Identity): string {
  return JSON.stringify(identity);
}

/** Decodes a persisted identity. Returns null if it is unreadable. */
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

/** Default identity: for a devot born without creation (reproduction, god mode). */
export function defaultIdentity(traits: readonly string[] = []): Identity {
  return {
    appearance: { ...DEFAULT_APPEARANCE },
    stats: { ...DEFAULT_STATS },
    soul: "",
    signature: signatureOf(DEFAULT_APPEARANCE, DEFAULT_STATS, traits, ""),
  };
}

// ── Heredity ────────────────────────────────────────────────────────────────

/**
 * A child's identity, drawn from its parents'.
 *
 * The appearance mixes slot by slot: the hat from one, the shirt from the other,
 * at random. You can therefore recognise a family on screen — the visible
 * counterpart of the trait mixing that already exists.
 *
 * Stats are averaged, then BROUGHT BACK TO BUDGET. Without that renormalisation
 * two gifted parents would produce an over-budget child, and the server's
 * validation would refuse it a few generations later: a line would end up
 * producing illegal children.
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
 * Brings any four values back to a LEGAL spread: whole numbers, each between
 * STAT_MIN and STAT_MAX, summing to exactly STAT_BUDGET.
 *
 * We round first, then correct the remainder point by point, giving it to (or
 * taking it from) the stat furthest from its bound. The shape of the parental
 * profile is thus preserved as far as the budget allows.
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
    // The lowest stat goes up, the highest goes down: we stay as close as
    // possible to the inherited profile.
    let best = -1;
    let bestValue = up ? STAT_MAX + 1 : STAT_MIN - 1;
    for (let i = 0; i < n; i++) {
      const v = out[i]!;
      if (up ? v < bestValue && v < STAT_MAX : v > bestValue && v > STAT_MIN) {
        best = i;
        bestValue = v;
      }
    }
    if (best < 0) break; // all at their bounds: the budget is unreachable
    out[best] = out[best]! + (up ? 1 : -1);
    total += up ? 1 : -1;
  }

  const stats = {} as Stats;
  STAT_KEYS.forEach((k, i) => {
    stats[k] = out[i]!;
  });
  return stats;
}

// ── Describing a look ───────────────────────────────────────────────────────

/** A colour common name: "scarlet" means something to a model, "#e0634c" does not. */
const COLOR_NAMES: Record<string, string> = {
  "#e0634c": "scarlet",
  "#e0b34c": "saffron",
  "#7dbc5e": "moss green",
  "#4ca6e0": "sky blue",
  "#9c4ce0": "violet",
  "#e04c8f": "bright pink",
  "#e8e4d8": "ecru",
  "#3a4150": "slate",
  "#2f3542": "charcoal",
  "#4a4f57": "iron grey",
  "#6b5844": "brown",
  "#3a5a40": "dark green",
  "#5a3a4a": "plum",
  "#8a8f98": "pale grey",
};

export function colorName(hex: string): string {
  return COLOR_NAMES[hex] ?? "an indefinable shade";
}

/**
 * A devot's look, in plain words.
 *
 * ONE formulation, used both for what a devot knows about itself and for what
 * others perceive of it. This is what gives appearance its social weight: the
 * model decides on its own who to fear or follow, with no rule imposing it — but
 * only if it can see it in the first place.
 */
export function describeAppearance(a: Appearance): string {
  const parts: string[] = [`${a.build} build`, `${colorName(a.shirt)} shirt`];
  if (a.hat !== "none") parts.push(`wearing a ${a.hat}`);
  if (a.cape !== "none") parts.push(`a ${a.cape} cape on their back`);
  if (a.face !== "none") {
    parts.push(a.face === "glasses" ? "glasses on their nose" : `a ${a.face} across their face`);
  }
  return parts.join(", ");
}

/** The look of a devot when all we hold is its serialised identity. */
export function describeIdentity(identityJson: string): string {
  const identity = decodeIdentity(identityJson);
  return identity ? describeAppearance(identity.appearance) : "of unremarkable appearance";
}

/**
 * How far a devot sees, from its stats alone.
 *
 * Shared deliberately: the simulation uses it to decide what enters a devot's
 * prompt, and the client uses it to draw the fog of war. A single formula, so
 * the circle the player watches is exactly the circle the mind is told about —
 * a fog drawn at a fixed radius would quietly lie about what a sharp-eyed or
 * short-sighted devot actually perceives.
 */
export function sightRadiusFromStats(stats: Stats): number {
  return PERCEPTION_RADIUS * statMultiplier(stats.sight);
}
