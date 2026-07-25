import { describe, expect, it } from "vitest";
import {
  ALIVE,
  BIOMASS,
  CORPSE_RETURN_PER_VOXEL,
  GROWTH_COST,
  MAX_ORGANISMS,
  MOUTH_EFFICIENCY_DEN,
  MOUTH_EFFICIENCY_NUM,
  NUTRIENT_FRESH,
  SeededRng,
  VoxelWorld,
  findSpawnSpot,
  randomGenome,
  registerGenome,
  spawnOrganism,
  stepN,
} from "../src/index.js";
import { PLAN_SEED_BONE, flatWorld, stepNYielding } from "./helpers.js";
import { registerPlan } from "../src/index.js";

/**
 * LE bilan du monde. Tout le reste de la simulation en dépend : si l'énergie
 * peut se créer, aucune pression sélective ne tient, et l'évolution ne
 * récompense plus que le réplicateur le plus rapide.
 *
 * L'ancienne formulation — « l'énergie d'un organisme ne dépasse pas sa dotation
 * plus ce qu'il a mangé » — était vraie et sans valeur : elle comptait le mangé
 * comme un revenu légitime, sans jamais demander d'où venait ce qui était mangé.
 * Un cadavre rendait alors huit fois le coût de construction de son corps, et le
 * test restait vert pendant que l'écosystème vivait de ses propres morts.
 */
function ledger(w: VoxelWorld): { held: number; injected: number } {
  let held = 0;
  for (let id = 1; id < MAX_ORGANISMS; id++) {
    if (w.orgState[id] === ALIVE) held += w.energy[id]!;
  }
  for (let i = 0; i < w.nutrient.length; i++) held += w.nutrient[i]!;
  return { held, injected: w.energyInjected };
}

describe("conservation de l'énergie", () => {
  it("mourir ne peut pas rapporter plus que ce que coûte un corps", () => {
    // La borne thermodynamique, énoncée sur les constantes elles-mêmes : c'est
    // elle qui interdit la boucle « pousser, mourir, manger son propre lignage ».
    const returned = ((CORPSE_RETURN_PER_VOXEL * MOUTH_EFFICIENCY_NUM) / MOUTH_EFFICIENCY_DEN) | 0;
    expect(returned).toBeLessThan(GROWTH_COST);
  });

  it("une dépouille vaut la réserve du mort plus une part de son corps, jamais plus", () => {
    const w = flatWorld();
    const p = registerPlan(w, PLAN_SEED_BONE);
    const id = spawnOrganism(w, p, 20, 1, 20, 5_000);
    const i = w.idx(20, 1, 20);

    const before = ledger(w);
    // On le tue en lui retirant tout : la décomposition suit au tick suivant.
    w.energy[id] = 0;
    stepN(w, 1);

    expect(w.material[i]).toBe(BIOMASS);
    expect(w.nutrient[i]!).toBeLessThanOrEqual(CORPSE_RETURN_PER_VOXEL);
    // Cette mort n'a rien injecté. Le registre a pourtant pu bouger : même un
    // socle de roche sèche fait pousser un peu de biomasse. Ce qu'on exige,
    // c'est que toute la hausse s'explique par de la photosynthèse — donc
    // qu'elle soit un multiple exact de la richesse d'une pousse.
    const grown = ledger(w).injected - before.injected;
    expect(grown % NUTRIENT_FRESH).toBe(0);
  });

  it("le monde ne détient jamais plus d'énergie qu'il n'en a reçu", async () => {
    const w = new VoxelWorld(4242);
    w.generateTerrain();
    const rng = new SeededRng(0x9911);
    for (let n = 0; n < 120; n++) {
      const slot = registerGenome(w, randomGenome(rng.next(), 6 + rng.below(6)));
      const spot = findSpawnSpot(w, rng);
      if (spot) spawnOrganism(w, slot, spot.x, spot.y, spot.z);
    }

    for (let k = 0; k < 6; k++) {
      await stepNYielding(w, 100);
      const { held, injected } = ledger(w);
      expect(held, `tick ${w.tick} : le monde détient ${held} pour ${injected} reçus`).toBeLessThanOrEqual(
        injected,
      );
    }
  });

  it("la population ne peut pas dépasser ce que la photosynthèse a produit", async () => {
    // Le corollaire mesurable de l'invariant précédent. Une population de 120
    // fondateurs part avec une dotation qui lui permettrait de tenir sans rien
    // manger ; passé ce délai, tout ce qui vit encore vit de la production
    // primaire. On borne donc la biomasse vivante par l'énergie entrée.
    const w = new VoxelWorld(31337);
    w.generateTerrain();
    const rng = new SeededRng(0x2244);
    let endowment = 0;
    for (let n = 0; n < 120; n++) {
      const slot = registerGenome(w, randomGenome(rng.next(), 6 + rng.below(6)));
      const spot = findSpawnSpot(w, rng);
      if (spot && spawnOrganism(w, slot, spot.x, spot.y, spot.z) > 0) endowment++;
    }
    const injectedAtStart = w.energyInjected;

    await stepNYielding(w, 1200);

    let held = 0;
    let pop = 0;
    for (let id = 1; id < MAX_ORGANISMS; id++) {
      if (w.orgState[id] !== ALIVE) continue;
      pop++;
      held += w.energy[id]!;
    }
    expect(pop, "le monde doit rester vivant").toBeGreaterThan(0);
    // La photosynthèse a bien alimenté le monde depuis le départ…
    expect(w.energyInjected).toBeGreaterThan(injectedAtStart);
    // …et l'énergie détenue par les vivants ne dépasse pas le total reçu.
    expect(held, `${pop} vivants détenant ${held} pour ${w.energyInjected} reçus`).toBeLessThanOrEqual(
      w.energyInjected,
    );
    expect(endowment).toBeGreaterThan(60);
  });
});
