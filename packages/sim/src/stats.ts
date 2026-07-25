import {
  ATTACK_DRAIN_PER_TICK,
  DEFAULT_STATS,
  DEVOT_SPEED,
  HP_MAX_DEFAULT,
  PERCEPTION_RADIUS,
  decodeIdentity,
  statMultiplier,
  type DevotEntity,
  statsWithItems,
  type Stats,
} from "@devot/shared";

/**
 * STATS IN PLAY.
 *
 * Every quantity in the world now goes through here instead of using its raw
 * constant. A hardy devot lives longer, a quick devot moves faster, a
 * sharp-sighted devot sees further — and therefore receives more in its prompt.
 *
 * Stats come from the PERSISTED identity, never from what a client claims:
 * they were validated once and for all at birth.
 *
 * JSON decoding is memoised by identity string. Without that, we would reparse
 * the same JSON for every devot on every tick, in the server's hottest loop.
 */
const cache = new Map<string, Stats>();

/** Stats du CORPS seul, sans ce qu'il porte. */
function bodyStatsOf(devot: DevotEntity): Stats {
  const raw = devot.identityJson;
  if (!raw) return DEFAULT_STATS;
  const hit = cache.get(raw);
  if (hit) return hit;
  const stats = decodeIdentity(raw)?.stats ?? DEFAULT_STATS;
  // Safety bound: the cache tracks the number of DISTINCT identities, not the
  // number of devots. It therefore cannot grow without limit in a stable world,
  // but a world running for months would eventually pile up.
  if (cache.size > 4096) cache.clear();
  cache.set(raw, stats);
  return stats;
}

/**
 * EFFECTIVE stats: the body, plus what it has forged.
 *
 * An item is not an ornament: it shifts a stat, and therefore changes what the
 * devot can do. And since it was paid for in HP, it also shortened that devot's
 * life — that is the bargain.
 */
export function statsOf(devot: DevotEntity): Stats {
  const body = bodyStatsOf(devot);
  return devot.items.length === 0 ? body : statsWithItems(body, devot.items);
}

/** Points de vie maximaux de ce devot. */
export function hpMaxOf(devot: DevotEntity): number {
  return Math.round(HP_MAX_DEFAULT * statMultiplier(statsOf(devot).vitality));
}

/** Movement speed, in units per second. */
export function speedOf(devot: DevotEntity): number {
  return DEVOT_SPEED * statMultiplier(statsOf(devot).speed);
}

/** Perception radius: what this devot sees, hence what enters its head. */
export function sightOf(devot: DevotEntity): number {
  return PERCEPTION_RADIUS * statMultiplier(statsOf(devot).sight);
}

/** HP drained per tick when this devot attacks. */
export function drainOf(devot: DevotEntity): number {
  return ATTACK_DRAIN_PER_TICK * statMultiplier(statsOf(devot).power);
}
