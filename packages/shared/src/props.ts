import { WORLD_HALF, terrainGrade, terrainHeight } from "./terrain.js";
import type { Vec3 } from "./types.js";

/**
 * The things that decorate and obstruct the world: rocks and flowers.
 *
 * Like the relief, they are generated from a fixed seed rather than sent over
 * the wire — the server and the client run this same function and get the same
 * boulders in the same places. Rocks are solid; flowers are not.
 */

export interface WorldProp {
  id: string;
  x: number;
  z: number;
  /** Ground height at (x, z), precomputed — every consumer needs it. */
  y: number;
  /** Uniform scale of the model. */
  scale: number;
  rotation: number;
  /** Which of the model variants to draw. */
  variant: number;
}

export interface RockProp extends WorldProp {
  /** Horizontal radius that bodies cannot enter. */
  radius: number;
}

export const ROCK_COUNT = 52;
export const FLOWER_COUNT = 240;

/** Seed of the world's decoration. Change it and every rock moves. */
const PROP_SEED = 0x5eed1e;

/** Bodies keep this much distance from a rock's centre, on top of its radius. */
export const BODY_RADIUS = 0.3;

/** Deterministic PRNG (mulberry32) — same sequence on server and client. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Steepness at a point, direction-independent. */
function steepness(x: number, z: number): number {
  return Math.max(
    Math.abs(terrainGrade(x, z, 1, 0)),
    Math.abs(terrainGrade(x, z, 0, 1)),
  );
}

function build(): { rocks: RockProp[]; flowers: WorldProp[] } {
  const rand = mulberry32(PROP_SEED);
  const rocks: RockProp[] = [];
  const flowers: WorldProp[] = [];

  // Rocks first: they own their ground, and flowers will avoid them.
  let guard = 0;
  while (rocks.length < ROCK_COUNT && guard++ < ROCK_COUNT * 40) {
    const x = (rand() - 0.5) * 2 * WORLD_HALF * 0.96;
    const z = (rand() - 0.5) * 2 * WORLD_HALF * 0.96;
    const radius = 0.55 + rand() * 0.95;

    // Keep the middle of the map clear: it is where founders open their eyes.
    if (Math.hypot(x, z) < 4) continue;
    // No boulder may overlap another, or bodies could get pinched between them.
    if (rocks.some((r) => Math.hypot(r.x - x, r.z - z) < r.radius + radius + 1.2)) {
      continue;
    }

    rocks.push({
      id: `rock-${rocks.length}`,
      x,
      z,
      y: terrainHeight(x, z),
      radius,
      scale: radius,
      rotation: rand() * Math.PI * 2,
      variant: Math.floor(rand() * 3),
    });
  }

  guard = 0;
  while (flowers.length < FLOWER_COUNT && guard++ < FLOWER_COUNT * 30) {
    const x = (rand() - 0.5) * 2 * WORLD_HALF * 0.98;
    const z = (rand() - 0.5) * 2 * WORLD_HALF * 0.98;

    // Flowers are meadow things: they do not grow on the steep faces.
    if (steepness(x, z) > 0.55) continue;
    if (rocks.some((r) => Math.hypot(r.x - x, r.z - z) < r.radius + 0.5)) continue;

    flowers.push({
      id: `flower-${flowers.length}`,
      x,
      z,
      y: terrainHeight(x, z),
      scale: 0.7 + rand() * 0.6,
      rotation: rand() * Math.PI * 2,
      variant: Math.floor(rand() * 4),
    });
  }

  return { rocks, flowers };
}

let cache: { rocks: RockProp[]; flowers: WorldProp[] } | undefined;

/** The world's props. Built once, then shared — never mutate the result. */
export function worldProps(): { rocks: RockProp[]; flowers: WorldProp[] } {
  cache ??= build();
  return cache;
}

/**
 * Pushes a body out of any rock it has walked into, straight away from the
 * centre. No pathfinding: a body that walks at a boulder slides around it
 * rather than sticking to it, which is enough to make rocks feel solid without
 * ever trapping anyone.
 */
export function resolveRockCollisions(pos: Vec3, bodyRadius: number = BODY_RADIUS): void {
  for (const rock of worldProps().rocks) {
    const dx = pos.x - rock.x;
    const dz = pos.z - rock.z;
    const min = rock.radius + bodyRadius;
    const d = Math.hypot(dx, dz);
    if (d >= min) continue;
    if (d < 1e-6) {
      // Dead centre: pick a fixed direction rather than dividing by zero.
      pos.x = rock.x + min;
      continue;
    }
    pos.x = rock.x + (dx / d) * min;
    pos.z = rock.z + (dz / d) * min;
  }
}
