import { describe, expect, it } from "vitest";
import {
  ALIVE,
  ATTACK_COST,
  BIOMASS,
  MAX_ORGANISMS,
  MOUTH,
  NEURON,
  SeededRng,
  VoxelWorld,
  crossover,
  findSpawnSpot,
  makePlan,
  passAttack,
  randomGenome,
  registerGenome,
  registerPlan,
  spawnOrganism,
  step,
  stepN,
  validateGenome,
} from "../src/index.js";
import { flatWorld, stepNYielding } from "./helpers.js";

/**
 * LA VIE SOCIALE : ce qui se passe quand deux lignées se rencontrent.
 *
 * Deux mécanismes, et ils tirent dans des sens opposés — mordre détruit,
 * croiser mêle. C'est leur coexistence qui rend un monde partagé intéressant.
 */

/** Deux organismes côte à côte, appartenant à deux lignées différentes. */
function twoNeighbours(): { w: VoxelWorld; a: number; b: number } {
  const w = flatWorld();
  const plan = makePlan([
    [0, 0, 0, MOUTH],
    [1, 0, 0, NEURON],
  ]);
  const p = registerPlan(w, plan);
  const a = spawnOrganism(w, p, 20, 1, 20, 200_000);
  const b = spawnOrganism(w, p, 23, 1, 20, 200_000);
  stepN(w, 3); // les deux corps poussent jusqu'à se toucher presque
  return { w, a, b };
}

describe("prédation entre lignées", () => {
  it("mordre arrache un voxel étranger, et le paie", () => {
    const { w, a, b } = twoNeighbours();
    // On rapproche : le corps de A occupe 20-21, celui de B 23-24. On pose donc
    // le mordant juste au contact en déplaçant la cible d'un cran.
    const victimVoxel = w.bodyList[w.bodySlot(b)]!;
    const attackerVoxel = w.bodyList[w.bodySlot(a) + 1]!;
    expect(w.owner[victimVoxel]).toBe(b);

    // Un contact direct : on place un voxel de A juste à côté d'un voxel de B.
    const target = w.idx(w.xOf(victimVoxel) - 1, w.yOf(victimVoxel), w.zOf(victimVoxel));
    w.removeBodyVoxel(a, attackerVoxel);
    w.material[attackerVoxel] = 0;
    w.owner[attackerVoxel] = 0;
    w.addBodyVoxel(a, target, MOUTH);

    const bodyBefore = w.bodyLen[b]!;
    const energyBefore = w.energy[a]!;
    w.intentAttack[a] = 1;
    passAttack(w);

    expect(w.bodyLen[b]!, "la victime a perdu un voxel").toBeLessThan(bodyBefore);
    expect(w.energy[a]!, "mordre coûte").toBe(energyBefore - ATTACK_COST);
    expect(w.bites[a]).toBe(1);
    expect(w.bitten[b]).toBe(1);
  });

  it("la chair arrachée tombe au sol : mordre ne nourrit pas sur le coup", () => {
    // C'est ce qui distingue la prédation du vol — il faut mordre PUIS rester
    // manger, donc s'exposer.
    const { w, a, b } = twoNeighbours();
    const victimVoxel = w.bodyList[w.bodySlot(b)]!;
    const target = w.idx(w.xOf(victimVoxel) - 1, w.yOf(victimVoxel), w.zOf(victimVoxel));
    w.addBodyVoxel(a, target, MOUTH);

    const eatenBefore = w.eaten[a]!;
    w.intentAttack[a] = 1;
    passAttack(w);

    expect(w.material[victimVoxel], "le voxel devient de la biomasse").toBe(BIOMASS);
    expect(w.eaten[a]!, "rien n'est ingéré au moment de la morsure").toBe(eatenBefore);
  });

  it("on ne se mord pas soi-même", () => {
    const w = flatWorld();
    const p = registerPlan(
      w,
      makePlan([
        [0, 0, 0, MOUTH],
        [1, 0, 0, NEURON],
        [2, 0, 0, MOUTH],
      ]),
    );
    const id = spawnOrganism(w, p, 30, 1, 30, 200_000);
    stepN(w, 4);
    const before = w.bodyLen[id]!;
    w.intentAttack[id] = 1;
    passAttack(w);
    expect(w.bodyLen[id]).toBe(before);
    expect(w.bites[id]).toBe(0);
  });

  it("mordre sans énergie est impossible", () => {
    const { w, a, b } = twoNeighbours();
    const victimVoxel = w.bodyList[w.bodySlot(b)]!;
    w.addBodyVoxel(a, w.idx(w.xOf(victimVoxel) - 1, w.yOf(victimVoxel), w.zOf(victimVoxel)), MOUTH);
    w.energy[a] = ATTACK_COST; // tout juste insuffisant
    const before = w.bodyLen[b]!;
    w.intentAttack[a] = 1;
    passAttack(w);
    expect(w.bodyLen[b]).toBe(before);
  });
});

describe("reproduction croisée entre lignées", () => {
  it("l'enfant garde le corps de l'initiateur et mêle les deux cerveaux", () => {
    const rng = new SeededRng(11);
    const mother = randomGenome(rng.next(), 8);
    const father = randomGenome(rng.next(), 8);
    // Deux génomes de même taille de cerveau : sinon le croisement se replie
    // sur le parent seul, ce que le test suivant vérifie.
    if (mother.hiddenMax !== father.hiddenMax) return;

    const child = crossover(mother, father, 12345);
    expect(child.body, "le plan de corps est celui de l'initiateur").toBe(mother.body);
    expect(validateGenome(child), "et l'enfant reste un génome légal").toBeNull();

    let fromMother = 0;
    let fromFather = 0;
    for (let k = 0; k < child.weights.length; k++) {
      if (child.weights[k] === mother.weights[k]) fromMother++;
      if (child.weights[k] === father.weights[k]) fromFather++;
    }
    expect(fromMother, "des poids viennent de la mère").toBeGreaterThan(0);
    expect(fromFather, "et d'autres du père").toBeGreaterThan(0);
  });

  it("des cerveaux de tailles différentes ne se croisent pas : on garde l'initiateur", () => {
    const small = randomGenome(1, 4);
    const big = randomGenome(2, 40);
    if (small.hiddenMax === big.hiddenMax) return;
    const child = crossover(small, big, 7);
    expect(child).toBe(small);
  });

  it("le croisement est déterministe", () => {
    const rng = new SeededRng(3);
    const a = randomGenome(rng.next(), 8);
    const b = randomGenome(rng.next(), 8);
    const one = crossover(a, b, 99);
    const two = crossover(a, b, 99);
    expect(Array.from(one.weights)).toEqual(Array.from(two.weights));
  });

  it("dans un monde peuplé, des enfants croisés finissent par naître", async () => {
    // Le vrai test : les lignées se rencontrent-elles assez pour que le
    // croisement existe autrement qu'en théorie ?
    const w = new VoxelWorld(4242);
    w.generateTerrain();
    const rng = new SeededRng(0x9911);
    for (let n = 0; n < 200; n++) {
      const slot = registerGenome(w, randomGenome(rng.next(), 6 + rng.below(6)));
      const spot = findSpawnSpot(w, rng);
      if (spot) spawnOrganism(w, slot, spot.x, spot.y, spot.z);
    }
    await stepNYielding(w, 1500);

    let crossbred = 0;
    let alive = 0;
    for (let id = 1; id < MAX_ORGANISMS; id++) {
      if (w.orgState[id] !== ALIVE) continue;
      alive++;
      if (w.crossbred[id]) crossbred++;
    }
    expect(alive, "le monde doit rester vivant").toBeGreaterThan(0);
    expect(crossbred, `${crossbred} croisés sur ${alive} vivants`).toBeGreaterThan(0);
  });
});

describe("la prédation existe dans un monde réel", () => {
  it("des morsures sont données sans qu'on les provoque", async () => {
    const w = new VoxelWorld(777);
    w.generateTerrain();
    const rng = new SeededRng(0x2211);
    for (let n = 0; n < 200; n++) {
      const slot = registerGenome(w, randomGenome(rng.next(), 6 + rng.below(6)));
      const spot = findSpawnSpot(w, rng);
      if (spot) spawnOrganism(w, slot, spot.x, spot.y, spot.z);
    }
    await stepNYielding(w, 1200);

    let bites = 0;
    for (let id = 1; id < MAX_ORGANISMS; id++) bites += w.bites[id]!;
    expect(bites, "aucune morsure en 1 200 ticks sur 200 organismes").toBeGreaterThan(0);
  });

  it("une morsure ne crée pas d'énergie", () => {
    const { w, a, b } = twoNeighbours();
    const victimVoxel = w.bodyList[w.bodySlot(b)]!;
    w.addBodyVoxel(a, w.idx(w.xOf(victimVoxel) - 1, w.yOf(victimVoxel), w.zOf(victimVoxel)), MOUTH);

    const injectedBefore = w.energyInjected;
    w.intentAttack[a] = 1;
    passAttack(w);
    // Le registre ne bouge pas : la chair arrachée valait déjà ce qu'elle vaut.
    expect(w.energyInjected).toBe(injectedBefore);
  });
});
