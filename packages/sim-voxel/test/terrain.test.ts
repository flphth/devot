import { describe, expect, it } from "vitest";
import {
  BIOMASS,
  NUTRIENT_DECAY,
  NUTRIENT_FRESH,
  ROCK,
  SY,
  VOID,
  VoxelWorld,
  step,
  stepN,
} from "../src/index.js";
import { countMaterial, flatWorld } from "./helpers.js";

describe("biomasse", () => {
  it("une colonie s'étend, un sol nu reste nu", () => {
    // LA règle de la végétation : elle ne surgit pas de nulle part, elle avance
    // depuis ses colonies. C'est cette dépendance au voisinage qui rend le
    // broutage épuisant pour la plante — donc payant pour l'animal qui suit le
    // front. On observe une bande ÉTROITE, juste devant la colonie : sur une
    // grande surface et un temps long, la génération spontanée finirait par
    // ensemencer elle aussi, et la comparaison ne dirait plus rien.
    const spread = (seeded: boolean): number => {
      const w = flatWorld(3);
      if (seeded) {
        for (let z = 62; z <= 66; z++) w.setMaterial(w.idx(59, 1, z), BIOMASS, NUTRIENT_FRESH);
      }
      stepN(w, 400);
      let grown = 0;
      for (let z = 61; z <= 67; z++) {
        for (let x = 60; x <= 66; x++) {
          if (w.material[w.idx(x, 1, z)] === BIOMASS) grown++;
        }
      }
      return grown;
    };

    const fromColony = spread(true);
    const fromNothing = spread(false);
    expect(fromColony, "une colonie doit s'étendre").toBeGreaterThan(0);
    expect(
      fromColony,
      `${fromColony} devant une colonie contre ${fromNothing} sur sol nu`,
    ).toBeGreaterThan(fromNothing * 3);
  });

  it("une plante isolée n'apparaît qu'exceptionnellement", () => {
    // Le pendant du test précédent : la génération spontanée existe — sinon un
    // monde sans plante resterait stérile pour toujours — mais elle est si rare
    // qu'elle ne peut pas renourrir un individu immobile.
    const w = flatWorld(4); // sol de roche nu, aucune plante
    stepN(w, 40);
    const isolated = countMaterial(w, BIOMASS);
    // 16 384 surfaces × 40 ticks × 1/65536 ≈ 10 pousses spontanées attendues,
    // qui colonisent ensuite. Ce qu'on exige, c'est l'ordre de grandeur : très
    // loin de la couverture qu'obtiendrait une pousse spontanée systématique.
    expect(isolated).toBeGreaterThan(0);
    expect(isolated).toBeLessThan(300);
  });

  it("se décompose seule et finit par disparaître", () => {
    const w = flatWorld();
    const i = w.idx(50, 1, 50);
    w.setMaterial(i, BIOMASS, NUTRIENT_FRESH);
    stepN(w, 10);
    expect(w.nutrient[i]!).toBe(NUTRIENT_FRESH - 10 * NUTRIENT_DECAY);
    stepN(w, Math.ceil(NUTRIENT_FRESH / NUTRIENT_DECAY) + 5);
    expect(w.material[i]).toBe(VOID);
  });
});
