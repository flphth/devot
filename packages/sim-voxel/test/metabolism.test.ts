import { describe, expect, it } from "vitest";
import {
  ALIVE,
  BIOMASS,
  BONE,
  CAPACITY_BASE,
  CAPACITY_PER_STORAGE,
  DEAD,
  MOUTH_EFFICIENCY_DEN,
  MOUTH_EFFICIENCY_NUM,
  MOUTH,
  MOUTH_INTAKE_PER_TICK,
  MUSCLE,
  NEURON,
  NUTRIENT_DECAY,
  SENESCENCE_PERIOD,
  STORAGE,
  UPKEEP,
  makePlan,
  registerPlan,
  spawnOrganism,
  step,
  stepN,
} from "../src/index.js";
import { PLAN_SEED_BONE, PLAN_SEED_MOUTH, countMaterial, flatWorld } from "./helpers.js";

describe("l'énergie est la vie", () => {
  it("un corps consomme exactement son entretien par tick", () => {
    const w = flatWorld();
    const p = registerPlan(w, PLAN_SEED_BONE);
    const id = spawnOrganism(w, p, 20, 1, 20, 30_000);
    expect(id).toBeGreaterThan(0);

    // Plan d'un seul voxel → aucune croissance possible, l'entretien est isolé.
    step(w);
    expect(w.energy[id]!).toBe(30_000 - UPKEEP[BONE]!);
    stepN(w, 9);
    expect(w.energy[id]!).toBe(30_000 - UPKEEP[BONE]! * 10);
  });

  it("vieillir coûte de plus en plus cher", () => {
    // La sénescence : sans elle, un corps sans neurone — donc stérile, puisque
    // le système nerveux commande toute action — vivrait éternellement sur une
    // rive fertile et bloquerait la sélection.
    const w = flatWorld();
    const p = registerPlan(w, PLAN_SEED_BONE);
    const id = spawnOrganism(w, p, 20, 1, 20, 5_000_000);

    const costOverTenTicks = (): number => {
      const before = w.energy[id]!;
      stepN(w, 10);
      return before - w.energy[id]!;
    };
    const young = costOverTenTicks();
    stepN(w, SENESCENCE_PERIOD * 6);
    const old = costOverTenTicks();

    expect(young).toBe(UPKEEP[BONE]! * 10); // le tout jeune ne paie que son corps
    expect(old).toBeGreaterThan(young); // le vieux paie son corps ET son âge
    // La surcharge suit l'âge : +1 par tick tous les SENESCENCE_PERIOD ticks.
    expect(old - young).toBeGreaterThanOrEqual(60);
  });

  it("aucune énergie n'apparaît de nulle part sans nourriture", () => {
    const w = flatWorld();
    const p = registerPlan(w, PLAN_SEED_BONE);
    const id = spawnOrganism(w, p, 20, 1, 20, 30_000);
    let previous = w.energy[id]!;
    for (let k = 0; k < 50; k++) {
      step(w);
      expect(w.energy[id]!).toBeLessThan(previous);
      previous = w.energy[id]!;
    }
  });

  it("une bouche convertit la biomasse avec sa perte de rendement", () => {
    const w = flatWorld();
    const p = registerPlan(w, PLAN_SEED_MOUTH);
    const id = spawnOrganism(w, p, 20, 1, 20, 20_000);
    // Biomasse juste à côté de la bouche.
    const food = w.idx(21, 1, 20);
    w.setMaterial(food, BIOMASS, 50_000);

    const before = w.energy[id]!;
    step(w);

    const taken = MOUTH_INTAKE_PER_TICK; // la biomasse est plus riche que la prise
    const gained = ((taken * MOUTH_EFFICIENCY_NUM) / MOUTH_EFFICIENCY_DEN) | 0;
    expect(w.energy[id]!).toBe(before + gained - UPKEEP[MOUTH]!);
    // La biomasse perd ce qui a été mangé, plus sa décomposition naturelle.
    expect(w.nutrient[food]!).toBe(50_000 - taken - NUTRIENT_DECAY);
  });

  it("l'énergie est plafonnée par la capacité", () => {
    const w = flatWorld();
    const p = registerPlan(w, PLAN_SEED_MOUTH);
    const id = spawnOrganism(w, p, 20, 1, 20, CAPACITY_BASE);
    w.setMaterial(w.idx(21, 1, 20), BIOMASS, 60_000);
    stepN(w, 5);
    expect(w.energy[id]!).toBeLessThanOrEqual(w.capacity[id]!);
    expect(w.capacity[id]!).toBe(CAPACITY_BASE);
  });

  it("chaque voxel réserve augmente la capacité", () => {
    const w = flatWorld();
    const plan = makePlan([
      [0, 0, 0, BONE],
      [1, 0, 0, STORAGE],
      [2, 0, 0, STORAGE],
    ]);
    const p = registerPlan(w, plan);
    const id = spawnOrganism(w, p, 20, 1, 20, 40_000);
    expect(w.capacity[id]!).toBe(CAPACITY_BASE);
    stepN(w, 3); // le temps que les deux réserves poussent
    expect(w.storageCount[id]!).toBe(2);
    expect(w.capacity[id]!).toBe(CAPACITY_BASE + 2 * CAPACITY_PER_STORAGE);
  });

  it("un neurone coûte plus cher qu'un os : penser est le tissu le plus lourd", () => {
    expect(UPKEEP[NEURON]!).toBeGreaterThan(UPKEEP[BONE]!);
    expect(UPKEEP[NEURON]!).toBeGreaterThan(UPKEEP[MUSCLE]!); // plus qu'un muscle au repos
  });
});

describe("mort et décomposition", () => {
  it("à énergie nulle, le corps entier devient de la biomasse", () => {
    const w = flatWorld();
    const p = registerPlan(w, PLAN_SEED_BONE);
    const id = spawnOrganism(w, p, 30, 1, 30, UPKEEP[BONE]!);
    const seedIdx = w.seedIdx[id]!;
    expect(w.orgState[id]).toBe(ALIVE);
    expect(countMaterial(w, BIOMASS)).toBe(0);

    step(w); // énergie tombe à 0 → mort
    expect(w.orgState[id]).toBe(DEAD);
    expect(w.bodyLen[id]).toBe(0);
    expect(w.material[seedIdx]).toBe(BIOMASS);
    expect(w.nutrient[seedIdx]!).toBeGreaterThan(0);
    expect(w.owner[seedIdx]).toBe(0);
  });

  it("un cadavre nourrit un survivant", () => {
    const w = flatWorld();
    const pBone = registerPlan(w, PLAN_SEED_BONE);
    const pMouth = registerPlan(w, PLAN_SEED_MOUTH);
    const victim = spawnOrganism(w, pBone, 40, 1, 40, UPKEEP[BONE]!);
    const eater = spawnOrganism(w, pMouth, 41, 1, 40, 20_000);
    expect(victim).toBeGreaterThan(0);
    expect(eater).toBeGreaterThan(0);

    step(w); // la victime meurt et se décompose à côté du mangeur
    const afterDeath = w.energy[eater]!;
    step(w); // le mangeur convertit la charogne
    expect(w.energy[eater]!).toBeGreaterThan(afterDeath);
  });

  it("l'emplacement d'un mort est rendu au pool", () => {
    const w = flatWorld();
    const p = registerPlan(w, PLAN_SEED_BONE);
    const first = spawnOrganism(w, p, 50, 1, 50, UPKEEP[BONE]!);
    step(w);
    expect(w.orgState[first]).toBe(DEAD);
    expect(w.bodyLen[first]).toBe(0);

    // Le pool considère l'emplacement comme libre : `allocOrganism` finit par
    // le rendre après avoir fait le tour (l'ordre de recyclage est un détail).
    let seenAgain = false;
    for (let k = 0; k < 3000 && !seenAgain; k++) {
      if (w.allocOrganism() === first) seenAgain = true;
    }
    expect(seenAgain).toBe(true);
  });
});
