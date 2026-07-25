import { describe, expect, it } from "vitest";
import {
  ALIVE,
  MAX_ORGANISMS,
  SeededRng,
  VoxelWorld,
  collectStats,
  findSpawnSpot,
  randomGenome,
  registerGenome,
  spawnOrganism,
  stepN,
  validateGenome,
  worldHash,
} from "../src/index.js";

/**
 * Mondes volontairement courts : la génération 3 est atteinte dès ~400 ticks
 * avec 120 fondateurs. Les runs longs (et la mesure d'amélioration, qui exige
 * plusieurs mondes) vivent dans `bench/evolve*.ts`, pas dans la suite de tests.
 */
function seededWorld(seed: number, founders = 120): VoxelWorld {
  const w = new VoxelWorld(seed);
  w.generateTerrain();
  const rng = new SeededRng(seed ^ 0x9911);
  for (let n = 0; n < founders; n++) {
    const slot = registerGenome(w, randomGenome(rng.next(), 6 + rng.below(6)));
    const spot = findSpawnSpot(w, rng);
    if (spot) spawnOrganism(w, slot, spot.x, spot.y, spot.z);
  }
  return w;
}

describe("sélection naturelle", () => {
  it("les lignées se succèdent : la génération maximale progresse", () => {
    const w = seededWorld(4242);
    expect(collectStats(w).maxGeneration).toBe(0);
    stepN(w, 600);
    const s = collectStats(w);
    expect(s.maxGeneration).toBeGreaterThan(2);
    expect(s.population).toBeGreaterThan(0);
  });

  it("reste déterministe malgré reproduction et mutation", () => {
    // C'est la propriété la plus fragile du jalon : les naissances dérivent
    // leur graine par hachage de (parent, tick, monde), sans état global.
    const a = seededWorld(777);
    const b = seededWorld(777);
    // Deux points de contrôle suffisent : `worldHash` parcourt les 524 288
    // voxels, c'est lui qui coûte, pas la simulation.
    for (let k = 0; k < 2; k++) {
      stepN(a, 200);
      stepN(b, 200);
      expect(worldHash(a)).toBe(worldHash(b));
    }
    expect(collectStats(a).maxGeneration).toBeGreaterThan(0);
  });

  it("tous les génomes vivants restent valides, même après des dizaines de générations", () => {
    // Sans cela, le monde commun refuserait ses propres enfants au moment de
    // les relâcher (validation de P5.3).
    const w = seededWorld(31337);
    stepN(w, 800);
    let checked = 0;
    for (let id = 1; id < MAX_ORGANISMS; id++) {
      if (w.orgState[id] !== ALIVE) continue;
      const g = w.orgGenome[id];
      expect(g).toBeDefined();
      const bad = validateGenome(g!);
      expect(bad, `organisme ${id} (génération ${w.generation[id]}) : ${bad?.reason}`).toBeNull();
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("l'énergie ne se crée jamais : le total reste borné par ce qui est mangé", () => {
    const w = seededWorld(99, 60);
    stepN(w, 500);
    let total = 0;
    let eaten = 0;
    for (let id = 1; id < MAX_ORGANISMS; id++) {
      if (w.orgState[id] !== ALIVE) continue;
      total += w.energy[id]!;
      eaten += w.eaten[id]!;
    }
    // Chaque organisme est né avec une dotation puis n'a gagné que par sa
    // bouche : son énergie ne peut pas dépasser dotation + ingestion.
    expect(total).toBeLessThanOrEqual(60 * 40_000 + eaten + 1);
  });

  it("deux mondes de graines différentes divergent", () => {
    const a = seededWorld(1, 60);
    const b = seededWorld(2, 60);
    stepN(a, 400);
    stepN(b, 400);
    expect(worldHash(a)).not.toBe(worldHash(b));
  });
});
