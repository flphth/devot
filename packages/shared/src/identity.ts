import {
  ATTACK_DRAIN_PER_TICK,
  DEVOT_SPEED,
  HP_MAX_DEFAULT,
  PERCEPTION_RADIUS,
} from "./constants.js";

/**
 * Who a devot is, chosen on the creation screen and frozen at birth.
 *
 * The stats are not decoration: each one feeds a real term in the simulation,
 * so shaping a founder is a set of trade-offs rather than a dress-up screen.
 * Everything here is validated server-side — the client only proposes.
 */

export const HAT_OPTIONS = ["none", "cap", "horn", "crown"] as const;
export const CAPE_OPTIONS = ["none", "short", "long"] as const;
export const BUILD_OPTIONS = ["slight", "average", "sturdy"] as const;

export type HatKind = (typeof HAT_OPTIONS)[number];
export type CapeKind = (typeof CAPE_OPTIONS)[number];
export type BuildKind = (typeof BUILD_OPTIONS)[number];

export const SKIN_COLORS = ["#f0c9a4", "#d9a377", "#a9714b", "#6f4630", "#c8d6e0"];
export const CLOTH_COLORS = [
  "#4ca6e0",
  "#e0634c",
  "#5ee07a",
  "#e0b34c",
  "#9c4ce0",
  "#dde3ee",
  "#2f3542",
];

export interface DevotAppearance {
  skin: string;
  shirt: string;
  pants: string;
  hat: HatKind;
  cape: CapeKind;
  build: BuildKind;
}

export interface DevotStats {
  /** More life to spend on thought. */
  vitality: number;
  /** Harder blows when preying on another creature. */
  power: number;
  /** Faster on its feet. */
  speed: number;
  /** Sees further. */
  sight: number;
}

export interface DevotIdentity {
  appearance: DevotAppearance;
  stats: DevotStats;
  /** Short code, unique to this devot. Assigned by the server. */
  signature: string;
}

export const STAT_MIN = 1;
export const STAT_MAX = 5;
/** Points to spread across the four stats. Four × 3 = a perfectly average devot. */
export const STAT_POINTS = 12;
export const STAT_KEYS = ["vitality", "power", "speed", "sight"] as const;

export const DEFAULT_APPEARANCE: DevotAppearance = {
  skin: SKIN_COLORS[0]!,
  shirt: CLOTH_COLORS[0]!,
  pants: "#2f3542",
  hat: "none",
  cape: "none",
  build: "average",
};

export const DEFAULT_STATS: DevotStats = {
  vitality: 3,
  power: 3,
  speed: 3,
  sight: 3,
};

export const DEFAULT_IDENTITY: DevotIdentity = {
  appearance: DEFAULT_APPEARANCE,
  stats: DEFAULT_STATS,
  signature: "",
};

// ── What the stats actually do ──────────────────────────────────────────────

/** Life at birth. Vitality 1 → 0.85×, vitality 5 → 1.45×. */
export function hpMaxFor(stats: DevotStats): number {
  return Math.round(HP_MAX_DEFAULT * (0.7 + 0.15 * stats.vitality));
}

/** HP torn from a victim per tick of contact. */
export function attackDrainFor(stats: DevotStats): number {
  return ATTACK_DRAIN_PER_TICK * (0.6 + 0.2 * stats.power);
}

/** Walking speed, in world units per second. */
export function speedFor(stats: DevotStats): number {
  return DEVOT_SPEED * (0.7 + 0.12 * stats.speed);
}

/** How far it can see — and therefore how far its mind is ever told about. */
export function perceptionFor(stats: DevotStats): number {
  return PERCEPTION_RADIUS * (0.7 + 0.12 * stats.sight);
}

// ── Validation (the client proposes, the server decides) ────────────────────

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Coerces anything into a legal appearance. Never throws. */
export function sanitizeAppearance(raw: unknown): DevotAppearance {
  const a = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    skin: isHex(a.skin) ? a.skin : DEFAULT_APPEARANCE.skin,
    shirt: isHex(a.shirt) ? a.shirt : DEFAULT_APPEARANCE.shirt,
    pants: isHex(a.pants) ? a.pants : DEFAULT_APPEARANCE.pants,
    hat: pick(a.hat, HAT_OPTIONS, "none"),
    cape: pick(a.cape, CAPE_OPTIONS, "none"),
    build: pick(a.build, BUILD_OPTIONS, "average"),
  };
}

export interface StatsValidation {
  ok: boolean;
  reason?: string;
}

/** A stat spread is legal iff every stat is in range and the budget is exact. */
export function validateStats(raw: unknown): StatsValidation {
  const s = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  let total = 0;
  for (const key of STAT_KEYS) {
    const value = s[key];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return { ok: false, reason: "stats_not_integer" };
    }
    if (value < STAT_MIN || value > STAT_MAX) {
      return { ok: false, reason: "stats_out_of_range" };
    }
    total += value;
  }
  if (total !== STAT_POINTS) return { ok: false, reason: "stats_budget" };
  return { ok: true };
}

export function sanitizeStats(raw: unknown): DevotStats {
  if (!validateStats(raw).ok) return { ...DEFAULT_STATS };
  const s = raw as Record<string, number>;
  return {
    vitality: s.vitality!,
    power: s.power!,
    speed: s.speed!,
    sight: s.sight!,
  };
}

/** A short code the player can recognise their lineage by. */
export function makeSignature(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  let n = h >>> 0;
  for (let i = 0; i < 6; i++) {
    out += alphabet[n % alphabet.length];
    n = Math.floor(n / alphabet.length) + 7;
  }
  return `${out.slice(0, 3)}-${out.slice(3)}`;
}

/** Parses a stored identity, filling in anything missing or illegal. */
export function parseIdentity(json: string | undefined | null): DevotIdentity {
  if (!json) return { ...DEFAULT_IDENTITY };
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    return {
      appearance: sanitizeAppearance(raw.appearance),
      stats: sanitizeStats(raw.stats),
      signature: typeof raw.signature === "string" ? raw.signature : "",
    };
  } catch {
    return { ...DEFAULT_IDENTITY };
  }
}
