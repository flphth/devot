import { describe, expect, it } from "vitest";
import {
  PLAN_GRAZER,
  PLAN_WORM,
  ROCK,
  SY,
  SeededRng,
  VoxelWorld,
  WATER,
  findSpawnSpot,
  registerPlan,
  spawnOrganism,
  step,
  stepN,
} from "../src/index.js";
import { countMaterial, stepNYielding } from "./helpers.js";

function populatedWorld(population = 60): VoxelWorld {
  const w = new VoxelWorld(31337);
  w.generateTerrain();
  const plans = [registerPlan(w, PLAN_GRAZER), registerPlan(w, PLAN_WORM)];
  const rng = new SeededRng(5);
  for (let n = 0; n < population; n++) {
    const spot = findSpawnSpot(w, rng);
    if (!spot) continue;
    spawnOrganism(w, plans[n % plans.length]!, spot.x, spot.y, spot.z);
  }
  return w;
}

describe("boucle chaude", () => {
  it("ne fait (quasiment) aucune allocation par tick", async () => {
    const w = populatedWorld();
    await stepNYielding(w, 150); // chauffe : JIT stabilisé, tampons touchés

    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const before = process.memoryUsage().heapUsed;

    const TICKS = 600;
    // Céder la main tous les 100 ticks n'alloue que six timers : négligeable
    // devant le seuil, et cela évite de bloquer le rapporteur de Vitest.
    await stepNYielding(w, TICKS);

    gc?.();
    const after = process.memoryUsage().heapUsed;
    const perTick = (after - before) / TICKS;

    // Sans `--expose-gc` la mesure inclut les déchets non encore collectés :
    // on vérifie un ordre de grandeur, pas l'exactitude. Une allocation par
    // voxel ferait exploser ce chiffre de plusieurs ordres de grandeur
    // (524 288 voxels par tick).
    expect(perTick).toBeLessThan(20_000);
  });

  it("le coût d'un tick ne dépend pas de la population (métabolisme en O(corps))", () => {
    const empty = new VoxelWorld(99);
    empty.generateTerrain();
    stepN(empty, 40);

    const crowded = populatedWorld(200);
    stepN(crowded, 40);

    const timeOf = (w: VoxelWorld): number => {
      const t0 = performance.now();
      for (let k = 0; k < 30; k++) step(w);
      return (performance.now() - t0) / 30;
    };

    const tEmpty = timeOf(empty);
    const tCrowded = timeOf(crowded);
    // Les corps coûtent O(taille du corps), pas O(taille du monde) : 200
    // organismes ne doivent pas doubler le prix d'un tick.
    expect(tCrowded).toBeLessThan(tEmpty * 2.5);
  });

  it("la borne de hauteur active reste sûre : rien n'est tronqué en silence", () => {
    // La passe terrain s'arrête à `activeTop` et remplit le dessus de vide ;
    // un voxel posé plus haut doit repousser la borne. On teste avec de la
    // ROCHE : elle ne tombe pas, ne s'étale pas et ne s'évapore pas, donc sa
    // disparition ne pourrait venir que de la troncature.
    const w = new VoxelWorld(4);
    w.generateTerrain();
    const topBefore = w.activeTop;
    const high = w.idx(64, SY - 2, 64);
    w.setMaterial(high, ROCK);
    expect(w.activeTop).toBeGreaterThan(topBefore);

    stepN(w, 40);
    expect(w.material[high]).toBe(ROCK);
  });

  it("l'eau posée en haut du monde retombe au sol", () => {
    const w = new VoxelWorld(4);
    w.generateTerrain();
    const before = countMaterial(w, WATER);
    w.setMaterial(w.idx(64, SY - 2, 64), WATER);
    expect(countMaterial(w, WATER)).toBe(before + 1);

    stepN(w, SY + 10);
    // Elle a rejoint la masse d'eau. Le total ne baisse que par évaporation
    // des surfaces exposées (le terrain généré en a beaucoup) — jamais par
    // troncature, qui se verrait comme une chute brutale.
    expect(countMaterial(w, WATER)).toBeGreaterThan(before * 0.98);
    // Et plus rien ne flotte en altitude.
    let highWater = 0;
    for (let y = 20; y < SY; y++) {
      for (let z = 0; z < 128; z++) {
        for (let x = 0; x < 128; x++) if (w.material[w.idx(x, y, z)] === WATER) highWater++;
      }
    }
    expect(highWater).toBe(0);
  });

  it("les versions de chunk suivent les changements de terrain", () => {
    const w = new VoxelWorld(8);
    w.generateTerrain();
    const before = Uint32Array.from(w.chunkVersion);
    stepN(w, 20);
    let changed = 0;
    for (let c = 0; c < w.chunkVersion.length; c++) {
      if (w.chunkVersion[c] !== before[c]) changed++;
    }
    // Sans cela, le protocole dérivé de P5.3 n'aurait aucun moyen de savoir
    // quels chunks renvoyer au client.
    expect(changed).toBeGreaterThan(0);
  });
});
