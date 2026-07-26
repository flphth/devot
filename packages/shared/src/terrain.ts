import type { Vec3 } from "./types.js";

/**
 * The shape of the ground, as a pure function of (x, z).
 *
 * Server and client both call this — the relief is never sent over the wire,
 * it is recomputed identically on each side. That is only sound because the
 * function is deterministic and depends on nothing but its arguments: no
 * Math.random, no Date, no mutable module state.
 */

/** Half-width of the playable square: the world spans [-WORLD_HALF, WORLD_HALF]. */
export const WORLD_HALF = 30;

/**
 * Half-amplitude of the relief, in world units (a devot is ~1.1 tall).
 * Calibrated so that roughly a quarter of the sight lines at full perception
 * range are blocked by ground: hills matter without walling the world in.
 */
export const TERRAIN_AMPLITUDE = 7;

/** Eye height above the ground, used when tracing a line of sight. */
export const EYE_HEIGHT = 1;

/**
 * Deterministic hash of a lattice cell → [0, 1).
 *
 * Integer bit-mixing rather than the usual fract(sin(dot(…))): that trick
 * returns exactly 0 at the origin, which punched a hole in the ground right
 * where devots are born. It also drifts between float implementations, and
 * server and client must agree bit for bit.
 */
function hash2(ix: number, iz: number): number {
  // The 0x9e3779b9 seed matters: without it a cell of (0, 0) mixes to 0 and
  // the world gets a crater at the origin, exactly where devots are born.
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smoothstep, so the lattice does not show as diamond-shaped creases. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0, 1), bilinear between lattice corners. */
function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);

  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);

  return a * (1 - fx) * (1 - fz) + b * fx * (1 - fz) + c * (1 - fx) * fz + d * fx * fz;
}

/**
 * Ground height at (x, z). Three octaves: broad hills, then shoulders, then a
 * light roughness. Normalised so the mean sits near 0 — a devot standing on
 * flat ground is at y ≈ 0, as before the relief existed.
 */
export function terrainHeight(x: number, z: number): number {
  // Two octaves only. Piling up more averages the noise towards its mean and
  // flattens the world: hills stop being tall enough to hide anything.
  const n = 0.68 * valueNoise(x / 11, z / 11) + 0.32 * valueNoise(x / 4.5, z / 4.5);
  return (n - 0.5) * 2 * TERRAIN_AMPLITUDE;
}

/**
 * Steepness of the ground at (x, z) along a horizontal direction, as a grade
 * (rise over run). Positive = uphill. `dx`/`dz` need not be normalised.
 */
export function terrainGrade(x: number, z: number, dx: number, dz: number): number {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return 0;
  const probe = 0.5;
  const nx = x + (dx / len) * probe;
  const nz = z + (dz / len) * probe;
  return (terrainHeight(nx, nz) - terrainHeight(x, z)) / probe;
}

/**
 * How much a slope scales walking speed. Climbing costs, descending helps a
 * little, and neither ever stops nor launches a body: clamped to [0.35, 1.25].
 */
export function slopeSpeedFactor(grade: number): number {
  return Math.max(0.35, Math.min(1.25, 1 - grade * 0.55));
}

/**
 * Can `from` see `to`, or does the ground rise in between?
 *
 * Traces the segment between the two pairs of eyes and looks for terrain
 * poking above it. Sampling is coarse (every ~1.2 units) — enough for hills
 * that span tens of units, and cheap enough to run for every pair of entities
 * on every perception pass.
 */
export function hasLineOfSight(from: Vec3, to: Vec3, eye: number = EYE_HEIGHT): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return true;

  const fromY = terrainHeight(from.x, from.z) + eye;
  const toY = terrainHeight(to.x, to.z) + eye;
  const steps = Math.min(24, Math.max(3, Math.ceil(dist / 1.2)));

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const sx = from.x + dx * t;
    const sz = from.z + dz * t;
    // A ridge exactly at eye level should not blind anyone: the margin keeps
    // gentle ground from flickering visibility on and off.
    if (terrainHeight(sx, sz) > fromY + (toY - fromY) * t + 0.25) return false;
  }
  return true;
}
