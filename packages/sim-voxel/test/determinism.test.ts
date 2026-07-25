import { describe, expect, it } from "vitest";
import {
  PLAN_GRAZER,
  PLAN_WORM,
  SeededRng,
  VoxelWorld,
  findSpawnSpot,
  hash32,
  registerPlan,
  spawnOrganism,
  step,
  stepN,
  worldHash,
} from "../src/index.js";

function buildWorld(seed: number, population: number): VoxelWorld {
  const w = new VoxelWorld(seed);
  w.generateTerrain();
  const plans = [registerPlan(w, PLAN_GRAZER), registerPlan(w, PLAN_WORM)];
  const rng = new SeededRng(seed ^ 0xabcd);
  for (let n = 0; n < population; n++) {
    const spot = findSpawnSpot(w, rng);
    if (!spot) continue;
    spawnOrganism(w, plans[n % plans.length]!, spot.x, spot.y, spot.z);
  }
  return w;
}

describe("déterminisme — condition de la conformité CPU ↔ GPU", () => {
  it("deux runs de même graine produisent la même suite d'empreintes", () => {
    const a = buildWorld(4242, 30);
    const b = buildWorld(4242, 30);
    expect(worldHash(a)).toBe(worldHash(b));

    for (let k = 0; k < 6; k++) {
      stepN(a, 25);
      stepN(b, 25);
      expect(worldHash(a)).toBe(worldHash(b));
    }
    expect(a.tick).toBe(150);
  });

  it("deux graines différentes divergent", () => {
    const a = buildWorld(1, 20);
    const b = buildWorld(2, 20);
    stepN(a, 40);
    stepN(b, 40);
    expect(worldHash(a)).not.toBe(worldHash(b));
  });

  it("le hachage sans état ne dépend pas de l'ordre d'appel", () => {
    // Rejouer les mêmes (idx, tick, seed) dans un ordre différent donne
    // exactement les mêmes valeurs : c'est ce qui rend la passe parallélisable.
    const forward: number[] = [];
    for (let i = 0; i < 64; i++) forward.push(hash32(i, 7, 99));
    const backward: number[] = new Array(64);
    for (let i = 63; i >= 0; i--) backward[i] = hash32(i, 7, 99);
    expect(backward).toEqual(forward);
  });

  it("le hachage reste dans les entiers 32 bits non signés", () => {
    for (const [a, b, c] of [
      [0, 0, 0],
      [-1, -1, -1],
      [2 ** 31, 12345, 6789],
      [524287, 100000, 20260725],
    ]) {
      const h = hash32(a!, b!, c!);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("l'empreinte change quand le monde évolue", () => {
    const w = buildWorld(9, 10);
    const before = worldHash(w);
    step(w);
    expect(worldHash(w)).not.toBe(before);
  });
});
