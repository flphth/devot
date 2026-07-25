import { describe, expect, it } from "vitest";
import {
  BIOMASS,
  BONE,
  DEAD,
  GROWTH_COST,
  MAX_BODY_VOXELS,
  PLAN_GRAZER,
  ROCK,
  damageVoxel,
  isPlanGrowable,
  makePlan,
  registerPlan,
  spawnOrganism,
  step,
  stepN,
} from "../src/index.js";
import { PLAN_LINE3, flatWorld } from "./helpers.js";

describe("croissance", () => {
  it("un organisme naît germe puis pousse un voxel par tick", () => {
    const w = flatWorld();
    const p = registerPlan(w, PLAN_LINE3);
    const id = spawnOrganism(w, p, 20, 1, 20, 60_000);
    expect(w.bodyLen[id]).toBe(1);

    step(w);
    expect(w.bodyLen[id]).toBe(2);
    step(w);
    expect(w.bodyLen[id]).toBe(3);
    // Le plan est épuisé : plus de croissance.
    stepN(w, 5);
    expect(w.bodyLen[id]).toBe(3);
  });

  it("la croissance suit les offsets du plan", () => {
    const w = flatWorld();
    const p = registerPlan(w, PLAN_LINE3);
    const id = spawnOrganism(w, p, 30, 1, 30, 60_000);
    stepN(w, 3);
    expect(w.owner[w.idx(30, 1, 30)]).toBe(id);
    expect(w.owner[w.idx(31, 1, 30)]).toBe(id);
    expect(w.owner[w.idx(32, 1, 30)]).toBe(id);
  });

  it("chaque voxel poussé coûte son énergie", () => {
    const w = flatWorld();
    const p = registerPlan(w, PLAN_LINE3);
    const id = spawnOrganism(w, p, 40, 1, 40, 60_000);
    const before = w.energy[id]!;
    step(w);
    // un voxel poussé + l'entretien du corps précédent
    expect(w.energy[id]!).toBe(before - GROWTH_COST - 2);
  });

  it("un organisme trop pauvre ne pousse pas", () => {
    const w = flatWorld();
    const p = registerPlan(w, PLAN_LINE3);
    const id = spawnOrganism(w, p, 50, 1, 50, GROWTH_COST); // sous le plancher
    stepN(w, 5);
    expect(w.bodyLen[id]).toBe(1);
  });

  it("la croissance ne traverse pas la roche", () => {
    const w = flatWorld();
    // Plan qui voudrait pousser vers le bas, dans le socle.
    const plan = makePlan([
      [0, 0, 0, BONE],
      [0, -1, 0, BONE],
    ]);
    const p = registerPlan(w, plan);
    const id = spawnOrganism(w, p, 60, 1, 60, 60_000);
    stepN(w, 4);
    expect(w.bodyLen[id]).toBe(1);
    expect(w.material[w.idx(60, 0, 60)]).toBe(ROCK); // le socle est intact
  });

  it("les plans fournis sont bien connexes dans leur ordre de croissance", () => {
    expect(isPlanGrowable(PLAN_GRAZER)).toBe(true);
    expect(isPlanGrowable(PLAN_LINE3)).toBe(true);
    // Un plan dont le second voxel ne touche rien est rejeté.
    expect(
      isPlanGrowable(
        makePlan([
          [0, 0, 0, BONE],
          [5, 0, 0, BONE],
        ]),
      ),
    ).toBe(false);
  });

  it("un corps ne dépasse pas la taille maximale", () => {
    // Plan volontairement plus long que la borne : on ne vérifie que la borne
    // dure, pas la forme obtenue.
    const voxels: Array<[number, number, number, number]> = [];
    for (let k = 0; k < MAX_BODY_VOXELS + 20; k++) voxels.push([0, 0, k % 120, BONE]);
    const w = flatWorld();
    const p = registerPlan(w, makePlan(voxels));
    const id = spawnOrganism(w, p, 70, 1, 5, 2_000_000_000);
    stepN(w, 120);
    expect(w.bodyLen[id]!).toBeLessThanOrEqual(MAX_BODY_VOXELS);
  });
});

describe("amputation et cicatrisation", () => {
  it("ce qui ne tient plus au germe devient de la chair morte", () => {
    const w = flatWorld();
    const p = registerPlan(w, PLAN_LINE3);
    const id = spawnOrganism(w, p, 20, 1, 20, 200_000);
    stepN(w, 3);
    expect(w.bodyLen[id]).toBe(3);

    // On détruit le voxel du milieu : le troisième perd tout lien avec le germe.
    const middle = w.idx(21, 1, 20);
    const far = w.idx(22, 1, 20);
    expect(damageVoxel(w, middle)).toBe(true);
    expect(w.damaged[id]).toBe(1);

    step(w);
    expect(w.material[far]).toBe(BIOMASS);
    expect(w.owner[far]).toBe(0);
    expect(w.nutrient[far]!).toBeGreaterThan(0);
  });

  it("le corps cicatrise : le voxel manquant repousse", () => {
    const w = flatWorld();
    const p = registerPlan(w, PLAN_LINE3);
    const id = spawnOrganism(w, p, 40, 1, 40, 400_000);
    stepN(w, 3);
    const middle = w.idx(41, 1, 40);
    const far = w.idx(42, 1, 40);
    damageVoxel(w, middle);

    // Dans le même tick : amputation du membre isolé, PUIS cicatrisation du
    // voxel détruit (l'ordre des passes garantit cette séquence).
    step(w);
    expect(w.material[far]).toBe(BIOMASS); // amputé
    expect(w.owner[middle]).toBe(id); // cicatrisé
    expect(w.bodyLen[id]).toBe(2);

    // Puis le plan est reconstitué en entier.
    stepN(w, 4);
    expect(w.bodyLen[id]).toBe(3);
  });

  it("détruire le germe tue l'organisme", () => {
    const w = flatWorld();
    const p = registerPlan(w, PLAN_LINE3);
    const id = spawnOrganism(w, p, 60, 1, 60, 400_000);
    stepN(w, 3);
    damageVoxel(w, w.seedIdx[id]!);
    step(w);

    // Sans germe il n'y a plus d'organisme : il ne doit pas subsister comme
    // une réserve d'énergie désincarnée capable de se reconstruire.
    expect(w.orgState[id]).toBe(DEAD);
    expect(w.bodyLen[id]).toBe(0);
    expect(w.energy[id]).toBe(0);
    expect(w.material[w.idx(61, 1, 60)]).toBe(BIOMASS);
    expect(w.material[w.idx(62, 1, 60)]).toBe(BIOMASS);
  });

  it("un voxel de terrain ne peut pas être « endommagé » comme du tissu", () => {
    const w = flatWorld();
    expect(damageVoxel(w, w.idx(10, 0, 10))).toBe(false); // roche
    expect(damageVoxel(w, w.idx(10, 5, 10))).toBe(false); // vide
  });
});
