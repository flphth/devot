/**
 * THE WORLD'S CLOCK.
 *
 * Standing still used to be free. Metabolism was the only cost of existing and
 * it is small, so a cautious devot could sit and outlast everyone. The clock is
 * what takes that away: night and winter make doing nothing expensive, and they
 * arrive whether anyone is ready or not.
 *
 * Pure functions of world time, like the terrain is a pure function of place —
 * the server sends one number and the client derives the same sky from it.
 */

/** A full day, in milliseconds of real time. */
export const DAY_MS = 120_000;
/** Share of a day spent in darkness. */
export const NIGHT_FRACTION = 0.4;
/** Days in one season. Four seasons make a year of 16 real minutes. */
export const DAYS_PER_SEASON = 2;

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

export type DayPhase = "dawn" | "day" | "dusk" | "night";

/** Where we are in the current day, in [0, 1). 0 is sunrise. */
export function dayProgress(worldMs: number): number {
  const t = (worldMs % DAY_MS) / DAY_MS;
  return t < 0 ? t + 1 : t;
}

/** Which day of the world this is, counting from the first. */
export function dayNumber(worldMs: number): number {
  return Math.floor(worldMs / DAY_MS);
}

export function isNight(worldMs: number): boolean {
  return dayProgress(worldMs) >= 1 - NIGHT_FRACTION;
}

/**
 * A coarser reading than isNight, for the sky and for what a devot is told.
 * Dawn and dusk are short bands on either side of the light.
 */
export function dayPhase(worldMs: number): DayPhase {
  const t = dayProgress(worldMs);
  const nightStart = 1 - NIGHT_FRACTION;
  if (t < 0.08) return "dawn";
  if (t < nightStart - 0.08) return "day";
  if (t < nightStart) return "dusk";
  return "night";
}

export function seasonOf(worldMs: number): Season {
  const index = Math.floor(dayNumber(worldMs) / DAYS_PER_SEASON) % SEASONS.length;
  return SEASONS[index]!;
}

/**
 * How much harder living is right now. Multiplies the passive metabolism, so
 * the cost of merely existing rises at night and through winter — which is the
 * whole point: waiting has to stop being a dominant strategy.
 */
export function metabolismMultiplier(worldMs: number): number {
  const night = isNight(worldMs) ? 1.8 : 1;
  const season = seasonOf(worldMs);
  const cold = season === "winter" ? 1.7 : season === "autumn" ? 1.2 : 1;
  return night * cold;
}

/**
 * How readily the world offers food. Nothing grows in the dark, and winter is
 * lean — a lineage that did not store life while it was cheap will feel it.
 */
export function foodSpawnMultiplier(worldMs: number): number {
  const night = isNight(worldMs) ? 0.15 : 1;
  const season = seasonOf(worldMs);
  const yield_ =
    season === "summer" ? 1.5 : season === "spring" ? 1.2 : season === "autumn" ? 0.8 : 0.3;
  return night * yield_;
}

/** Predators hunt better in the dark. Devots do not see any further. */
export function monsterSightMultiplier(worldMs: number): number {
  return isNight(worldMs) ? 1.4 : 1;
}

/** What a devot is told about the hour and the season, in its own terms. */
export function describeSky(worldMs: number): string {
  const phase = dayPhase(worldMs);
  const season = seasonOf(worldMs);
  const when =
    phase === "night"
      ? "It is NIGHT. Nothing grows in the dark, the cold takes more of your life for every moment you exist, and the monsters see further than you do."
      : phase === "dusk"
        ? "The light is failing. Night is close, and with it the cold and the hunters."
        : phase === "dawn"
          ? "Dawn. The night is over and the world starts giving again."
          : "It is broad day.";
  const weather =
    season === "winter"
      ? "It is WINTER: almost nothing grows, and staying alive costs far more than it did."
      : season === "autumn"
        ? "It is autumn. The world gives less than it did, and the cold is coming."
        : season === "summer"
          ? "It is summer. Food is as plentiful as it will ever be — what you do not use now, you will want later."
          : "It is spring. The world is generous again.";
  return `${when} ${weather}`;
}
