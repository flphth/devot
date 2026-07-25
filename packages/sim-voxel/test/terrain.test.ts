import { describe, expect, it } from "vitest";
import {
  BIOMASS,
  NUTRIENT_DECAY,
  NUTRIENT_FRESH,
  ROCK,
  SY,
  VOID,
  VoxelWorld,
  WATER,
  step,
  stepN,
} from "../src/index.js";
import { countMaterial, flatWorld } from "./helpers.js";

/**
 * Bassin hermétique : sol et couvercle de roche COLLÉS à la couche d'eau, donc
 * aucune eau n'est exposée au vide — l'évaporation est structurellement
 * impossible. La moitié droite est vide : l'eau peut s'y étaler. Toute
 * variation du total serait donc un bug du schéma d'étalement, pas un effet
 * de bord du modèle.
 */
function hermeticBasin(): { w: VoxelWorld; waterCount: number } {
  const w = new VoxelWorld(77);
  w.material.fill(VOID);
  w.nutrient.fill(0);
  w.owner.fill(0);

  const x0 = 10;
  const x1 = 29;
  const z0 = 10;
  const z1 = 29;

  for (let z = z0 - 1; z <= z1 + 1; z++) {
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      w.material[w.idx(x, 0, z)] = ROCK; // sol
      w.material[w.idx(x, 2, z)] = ROCK; // couvercle, directement sur l'eau
      const onWall = x === x0 - 1 || x === x1 + 1 || z === z0 - 1 || z === z1 + 1;
      if (onWall) w.material[w.idx(x, 1, z)] = ROCK; // parois
    }
  }

  // L'eau n'occupe que la moitié gauche : il reste de la place où s'étaler.
  let n = 0;
  const mid = (x0 + x1) >> 1;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= mid; x++) {
      w.material[w.idx(x, 1, z)] = WATER;
      n++;
    }
  }

  w.materialNext.set(w.material);
  w.nutrientNext.set(w.nutrient);
  w.ownerNext.set(w.owner);
  w.activeTop = 5;
  return { w, waterCount: n };
}

describe("eau — le consentement mutuel conserve la matière", () => {
  it("dans un bassin hermétique, la quantité d'eau est exactement conservée", () => {
    const { w, waterCount } = hermeticBasin();
    expect(countMaterial(w, WATER)).toBe(waterCount);
    for (let k = 0; k < 80; k++) {
      step(w);
      // Ni duplication ni disparition : c'est l'invariant du consentement
      // mutuel — une source ne cède qu'à la destination qui l'a choisie.
      expect(countMaterial(w, WATER)).toBe(waterCount);
    }
  });

  it("et pendant ce temps l'eau se déplace réellement", () => {
    const { w } = hermeticBasin();
    const right = w.idx(28, 1, 20); // moitié initialement vide
    expect(w.material[right]).toBe(VOID);
    stepN(w, 120);
    let filled = 0;
    for (let z = 10; z <= 29; z++) {
      for (let x = 20; x <= 29; x++) if (w.material[w.idx(x, 1, z)] === WATER) filled++;
    }
    expect(filled).toBeGreaterThan(0);
  });

  it("l'eau tombe jusqu'au sol", () => {
    const w = flatWorld();
    w.setMaterial(w.idx(40, SY - 2, 40), WATER);
    expect(countMaterial(w, WATER)).toBe(1);

    stepN(w, SY + 8);
    expect(countMaterial(w, WATER)).toBe(1);
    // Elle repose sur la roche — mais elle a pu s'étaler en tombant, donc on
    // vérifie son altitude, pas sa colonne d'origine.
    let y = -1;
    for (let yy = 0; yy < SY; yy++) {
      for (let x = 30; x < 50 && y < 0; x++) {
        for (let z = 30; z < 50; z++) {
          if (w.material[w.idx(x, yy, z)] === WATER) {
            y = yy;
            break;
          }
        }
      }
      if (y >= 0) break;
    }
    expect(y).toBe(1);
  });

  it("une colonne d'eau s'étale sur plusieurs colonnes", () => {
    const w = flatWorld();
    for (let y = 1; y <= 6; y++) w.setMaterial(w.idx(64, y, 64), WATER);
    const total = countMaterial(w, WATER);
    stepN(w, 60);
    expect(countMaterial(w, WATER)).toBe(total);

    let columns = 0;
    for (let x = 56; x <= 72; x++) {
      for (let z = 56; z <= 72; z++) {
        if (w.material[w.idx(x, 1, z)] === WATER) columns++;
      }
    }
    expect(columns).toBeGreaterThan(1);
  });
});

describe("biomasse", () => {
  it("pousse au contact de l'eau, sur un sol solide", () => {
    const w = flatWorld();
    for (let x = 30; x < 40; x++) {
      for (let z = 30; z < 40; z++) w.setMaterial(w.idx(x, 1, z), WATER);
    }
    expect(countMaterial(w, BIOMASS)).toBe(0);
    stepN(w, 200);
    expect(countMaterial(w, BIOMASS)).toBeGreaterThan(0);
  });

  it("pousse beaucoup plus vite près de l'eau que sur sol sec", () => {
    // Le gradient de fertilité est ce qui crée la pression sélective : sans
    // lui, la nourriture est partout et l'évolution choisit l'immobilité.
    const dry = flatWorld();
    stepN(dry, 200);
    const dryCount = countMaterial(dry, BIOMASS);

    const wet = flatWorld();
    for (let x = 0; x < 128; x += 4) {
      for (let z = 0; z < 128; z += 4) wet.setMaterial(wet.idx(x, 1, z), WATER);
    }
    stepN(wet, 200);
    const wetCount = countMaterial(wet, BIOMASS) - countMaterial(wet, WATER) * 0;

    expect(dryCount).toBeGreaterThan(0); // le sol sec n'est pas stérile
    expect(wetCount).toBeGreaterThan(dryCount * 2); // mais les rives sont riches
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
