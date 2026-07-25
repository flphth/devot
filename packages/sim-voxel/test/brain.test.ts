import { describe, expect, it } from "vitest";
import {
  BIOMASS,
  BONE,
  CAPACITY_BASE,
  EYE,
  FP_ONE,
  IN_ENERGY,
  IN_FOOD_PX,
  IN_MOUTH_CONTACT,
  IN_OTHER_PX,
  MIN_CHILD_ENERGY,
  MOUTH,
  MUSCLE,
  MUSCLE_CONTRACTION_COST,
  NEURON,
  NEURON_THINKING_COST,
  NUM_INPUTS,
  NUM_OUTPUTS,
  OUT_MOVE_PX,
  ROCK,
  chosenDirection,
  genomeFromPlan,
  makePlan,
  registerGenome,
  registerPlan,
  sense,
  spawnOrganism,
  step,
  stepN,
  think,
  weightCount,
} from "../src/index.js";
import { flatWorld } from "./helpers.js";

/** Génome dont tous les poids sont fixés : rend le comportement prévisible. */
function fixedBrain(
  plan: ReturnType<typeof makePlan>,
  fill: (k: number, count: number) => number,
) {
  const g = genomeFromPlan(plan, 1);
  for (let k = 0; k < g.weights.length; k++) g.weights[k] = fill(k, g.weights.length);
  return g;
}

describe("perception", () => {
  it("mesure l'énergie relative", () => {
    const w = flatWorld();
    const p = registerPlan(w, makePlan([[0, 0, 0, MOUTH]]));
    const id = spawnOrganism(w, p, 20, 1, 20, CAPACITY_BASE);
    const buf = new Int32Array(NUM_INPUTS);
    sense(w, id, buf);
    expect(buf[IN_ENERGY]).toBe(FP_ONE); // plein
    w.energy[id] = (w.capacity[id]! / 2) | 0;
    sense(w, id, buf);
    expect(buf[IN_ENERGY]).toBeCloseTo(FP_ONE / 2, -1);
  });

  it("signale le contact d'une bouche avec la biomasse", () => {
    const w = flatWorld();
    const p = registerPlan(w, makePlan([[0, 0, 0, MOUTH]]));
    const id = spawnOrganism(w, p, 30, 1, 30, 20_000);
    const buf = new Int32Array(NUM_INPUTS);
    sense(w, id, buf);
    expect(buf[IN_MOUTH_CONTACT]).toBe(0);

    w.setMaterial(w.idx(31, 1, 30), BIOMASS, 20_000);
    sense(w, id, buf);
    expect(buf[IN_MOUTH_CONTACT]).toBe(FP_ONE);
  });

  it("un corps SANS ŒIL est aveugle : aucune perception à distance", () => {
    const w = flatWorld();
    const p = registerPlan(w, makePlan([[0, 0, 0, MOUTH]]));
    const id = spawnOrganism(w, p, 40, 1, 40, 20_000);
    w.setMaterial(w.idx(45, 1, 40), BIOMASS, 20_000);
    const buf = new Int32Array(NUM_INPUTS);
    sense(w, id, buf);
    expect(buf[IN_FOOD_PX]).toBe(0);
  });

  it("un œil voit la nourriture, et d'autant plus fort qu'elle est proche", () => {
    const w = flatWorld();
    const p = registerPlan(
      w,
      makePlan([
        [0, 0, 0, MOUTH],
        [0, 1, 0, EYE],
      ]),
    );
    const id = spawnOrganism(w, p, 50, 1, 50, 200_000);
    stepN(w, 2); // le temps que l'œil pousse
    expect(w.neuronCount[id]).toBe(0);

    const buf = new Int32Array(NUM_INPUTS);
    w.setMaterial(w.idx(58, 1, 50), BIOMASS, 20_000);
    sense(w, id, buf);
    const far = buf[IN_FOOD_PX]!;
    expect(far).toBeGreaterThan(0);

    w.setMaterial(w.idx(58, 1, 50), 0);
    w.setMaterial(w.idx(52, 1, 50), BIOMASS, 20_000);
    sense(w, id, buf);
    expect(buf[IN_FOOD_PX]!).toBeGreaterThan(far);
  });

  it("un œil distingue un autre organisme de la nourriture", () => {
    const w = flatWorld();
    const seer = registerPlan(
      w,
      makePlan([
        [0, 0, 0, MOUTH],
        [0, 1, 0, EYE],
      ]),
    );
    const other = registerPlan(w, makePlan([[0, 0, 0, BONE]]));
    const a = spawnOrganism(w, seer, 60, 1, 60, 200_000);
    spawnOrganism(w, other, 66, 1, 60, 50_000);
    stepN(w, 2);

    const buf = new Int32Array(NUM_INPUTS);
    sense(w, a, buf);
    expect(buf[IN_OTHER_PX]!).toBeGreaterThan(0);
    expect(buf[IN_FOOD_PX]!).toBe(0);
  });
});

describe("cerveau — borné par les voxels neurone", () => {
  it("sans neurone, c'est un réflexe direct entrées → sorties", () => {
    const plan = makePlan([[0, 0, 0, MOUTH]]);
    const g = genomeFromPlan(plan, 1);
    expect(g.hiddenMax).toBe(0);
    expect(g.weights.length).toBe(weightCount(0));

    const inputs = new Int32Array(NUM_INPUTS);
    inputs[IN_ENERGY] = FP_ONE;
    const outputs = new Int32Array(NUM_OUTPUTS);
    think(g, inputs, 0, new Int32Array(8), outputs);
    for (const o of outputs) expect(Number.isFinite(o)).toBe(true);
  });

  it("avec des neurones, la couche cachée est dimensionnée par le corps", () => {
    const plan = makePlan([
      [0, 0, 0, MOUTH],
      [1, 0, 0, NEURON],
      [2, 0, 0, NEURON],
      [3, 0, 0, NEURON],
    ]);
    const g = genomeFromPlan(plan, 1);
    expect(g.hiddenMax).toBe(3);
    expect(g.weights.length).toBe(weightCount(3));
  });

  it("perdre ses neurones change la décision : la pensée dépend du corps", () => {
    const plan = makePlan([
      [0, 0, 0, MOUTH],
      [1, 0, 0, NEURON],
      [2, 0, 0, NEURON],
    ]);
    const g = fixedBrain(plan, (k) => (k % 3 === 0 ? 400 : -200));
    const inputs = new Int32Array(NUM_INPUTS);
    for (let k = 0; k < NUM_INPUTS; k++) inputs[k] = FP_ONE >> 1;

    const withBrain = new Int32Array(NUM_OUTPUTS);
    const blunted = new Int32Array(NUM_OUTPUTS);
    think(g, inputs, 2, new Int32Array(8), withBrain);
    think(g, inputs, 0, new Int32Array(8), blunted);
    expect(Array.from(withBrain)).not.toEqual(Array.from(blunted));
  });

  it("reste dans les entiers : jamais de NaN, jamais d'infini", () => {
    const plan = makePlan([
      [0, 0, 0, MOUTH],
      [1, 0, 0, NEURON],
    ]);
    // Poids extrêmes, entrées saturées : le cas le plus défavorable.
    const g = fixedBrain(plan, (k) => (k % 2 === 0 ? 32000 : -32000));
    const inputs = new Int32Array(NUM_INPUTS).fill(FP_ONE * 4);
    const outputs = new Int32Array(NUM_OUTPUTS);
    think(g, inputs, 1, new Int32Array(8), outputs);
    for (const o of outputs) {
      expect(Number.isInteger(o)).toBe(true);
      expect(Math.abs(o)).toBeLessThanOrEqual(FP_ONE * 4);
    }
  });

  it("est déterministe : mêmes entrées, mêmes sorties", () => {
    const g = genomeFromPlan(
      makePlan([
        [0, 0, 0, MOUTH],
        [1, 0, 0, NEURON],
        [2, 0, 0, NEURON],
      ]),
      99,
    );
    const inputs = new Int32Array(NUM_INPUTS);
    for (let k = 0; k < NUM_INPUTS; k++) inputs[k] = (k * 97) % FP_ONE;
    const a = new Int32Array(NUM_OUTPUTS);
    const b = new Int32Array(NUM_OUTPUTS);
    think(g, inputs, 2, new Int32Array(8), a);
    think(g, inputs, 2, new Int32Array(8), b);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("la direction choisie est l'argmax, sans départage aléatoire", () => {
    const outputs = new Int32Array(NUM_OUTPUTS);
    expect(chosenDirection(outputs, 100)).toBe(-1); // rien au-dessus du seuil
    outputs[OUT_MOVE_PX + 2] = 500;
    expect(chosenDirection(outputs, 100)).toBe(2);
    // Égalité : la plus petite direction gagne (déterminisme).
    outputs[OUT_MOVE_PX + 1] = 500;
    expect(chosenDirection(outputs, 100)).toBe(1);
  });

  it("penser coûte de l'énergie, proportionnellement aux neurones", () => {
    const w = flatWorld();
    const plan = makePlan([
      [0, 0, 0, MOUTH],
      [1, 0, 0, NEURON],
      [2, 0, 0, NEURON],
    ]);
    // Cerveau muet : aucune sortie ne franchit les seuils, donc aucun
    // mouvement ni reproduction ne viennent polluer la mesure.
    const g = fixedBrain(plan, () => 0);
    const p = registerGenome(w, g);
    const id = spawnOrganism(w, p, 20, 1, 20, 300_000);
    stepN(w, 3); // les deux neurones poussent
    expect(w.neuronCount[id]).toBe(2);

    const before = w.energy[id]!;
    step(w);
    const upkeep = 4 /* bouche */ + 8 * 2 /* neurones */;
    const thinking = 2 * NEURON_THINKING_COST;
    // La croissance est terminée : il ne reste que l'entretien et la pensée.
    expect(w.energy[id]!).toBe(before - upkeep - thinking);
  });
});

describe("déplacement", () => {
  it("un corps sans neurone n'agit pas du tout, même saturé d'énergie", () => {
    // La règle qui donne son sens à « le cerveau est borné par les voxels
    // neurone » : sans système nerveux, pas d'action. Il y avait auparavant un
    // réflexe direct gratuit, et c'était la vraie cause de l'extinction
    // systématique des cerveaux — un réflexe linéaire suffisait à ce monde, donc
    // la couche cachée ne servait à rien et coûtait son entretien.
    const w = flatWorld();
    const plan = makePlan([
      [0, 0, 0, MOUTH],
      [1, 0, 0, MUSCLE],
    ]);
    const g = fixedBrain(plan, () => 3000); // toutes les sorties saturées
    const p = registerGenome(w, g);
    const id = spawnOrganism(w, p, 20, 1, 20, 500_000);
    stepN(w, 3);
    expect(w.muscleCount[id]).toBe(1); // il a bien de quoi bouger
    expect(w.neuronCount[id]).toBe(0); // mais rien pour le vouloir

    const seedBefore = w.seedIdx[id]!;
    stepN(w, 10);
    expect(w.seedIdx[id]).toBe(seedBefore);
    expect(w.distance[id]).toBe(0);
    expect(w.intentRepro[id]).toBe(0);
    expect(w.intentAttack[id]).toBe(0);
    // Il vit pourtant : la croissance et l'alimentation ne passent pas par le
    // cerveau. Un corps sans nerfs est une plante, pas un cadavre.
    expect(w.orgState[id]).toBe(1);
  });

  it("un corps sans muscle ne bouge pas, quoi qu'en dise son cerveau", () => {
    const w = flatWorld();
    const plan = makePlan([[0, 0, 0, MOUTH]]);
    const g = fixedBrain(plan, () => 3000); // toutes les sorties saturées
    const p = registerGenome(w, g);
    const id = spawnOrganism(w, p, 20, 1, 20, 300_000);
    const seedBefore = w.seedIdx[id]!;
    stepN(w, 5);
    expect(w.seedIdx[id]).toBe(seedBefore);
    expect(w.distance[id]).toBe(0);
  });

  it("un corps musclé et pourvu d'un neurone se translate et paie la contraction", () => {
    const w = flatWorld();
    // Le neurone n'est pas décoratif : sans système nerveux, aucune action n'est
    // émise, quel que soit le cerveau (voir `think`).
    const plan = makePlan([
      [0, 0, 0, MOUTH],
      [1, 0, 0, MUSCLE],
      [2, 0, 0, NEURON],
    ]);
    // Poids qui saturent la sortie « +x » : direction prévisible.
    const g = fixedBrain(plan, () => 2000);
    const p = registerGenome(w, g);
    const id = spawnOrganism(w, p, 20, 1, 20, 400_000);
    stepN(w, 3); // le muscle et le neurone poussent
    expect(w.muscleCount[id]).toBe(1);
    expect(w.neuronCount[id]).toBe(1);

    const before = { x: w.xOf(w.seedIdx[id]!), e: w.energy[id]! };
    step(w);
    const moved = w.xOf(w.seedIdx[id]!) !== before.x || w.zOf(w.seedIdx[id]!) !== 20;
    expect(moved).toBe(true);
    expect(w.distance[id]!).toBeGreaterThan(0);
    // Le coût de contraction a bien été prélevé.
    expect(w.energy[id]!).toBeLessThan(before.e - MUSCLE_CONTRACTION_COST);
  });

  it("le corps reste connexe après un déplacement", () => {
    const w = flatWorld();
    const plan = makePlan([
      [0, 0, 0, MOUTH],
      [1, 0, 0, MUSCLE],
      [2, 0, 0, MUSCLE],
    ]);
    const g = fixedBrain(plan, () => 2000);
    const p = registerGenome(w, g);
    const id = spawnOrganism(w, p, 30, 1, 30, 600_000);
    stepN(w, 20);

    // Tous les voxels appartiennent bien à l'organisme et se touchent.
    const base = w.bodySlot(id);
    const len = w.bodyLen[id]!;
    expect(len).toBeGreaterThan(1);
    for (let k = 0; k < len; k++) {
      const i = w.bodyList[base + k]!;
      expect(w.owner[i]).toBe(id);
    }
    expect(w.orgState[id]).toBe(1);
  });

  it("un mur de roche bloque le déplacement", () => {
    const w = flatWorld();
    const plan = makePlan([
      [0, 0, 0, MOUTH],
      [1, 0, 0, MUSCLE],
    ]);
    const g = fixedBrain(plan, () => 2000);
    const p = registerGenome(w, g);
    const id = spawnOrganism(w, p, 40, 1, 40, 400_000);
    stepN(w, 2);
    // On emmure l'organisme À SA POSITION COURANTE : il a déjà pu se déplacer
    // pendant les ticks de croissance.
    const sx = w.xOf(w.seedIdx[id]!);
    const sz = w.zOf(w.seedIdx[id]!);
    for (const [dx, dz] of [
      [2, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
    ]) {
      w.setMaterial(w.idx(sx + dx!, 1, sz + dz!), ROCK);
    }
    const seedBefore = w.seedIdx[id]!;
    const distBefore = w.distance[id]!;
    stepN(w, 10);
    expect(w.seedIdx[id]).toBe(seedBefore);
    expect(w.distance[id]).toBe(distBefore);
  });
});

describe("reproduction", () => {
  it("engendre un enfant muté, une génération plus loin, en partageant l'énergie", () => {
    const w = flatWorld();
    const plan = makePlan([
      [0, 0, 0, MOUTH],
      [1, 0, 0, BONE],
      [2, 0, 0, NEURON], // sans neurone, aucune intention n'est émise
    ]);
    const g = fixedBrain(plan, () => 2000); // veut tout, y compris se reproduire
    const p = registerGenome(w, g);
    const parent = spawnOrganism(w, p, 20, 1, 20, 500_000);
    const before = w.energy[parent]!;

    let child = 0;
    for (let k = 0; k < 8 && child === 0; k++) {
      step(w);
      for (let id = 1; id < 100; id++) {
        if (id !== parent && w.orgState[id] === 1) child = id;
      }
    }
    expect(child).toBeGreaterThan(0);
    expect(w.generation[child]).toBe(w.generation[parent]! + 1);
    expect(w.energy[parent]!).toBeLessThan(before);
    expect(w.energy[child]!).toBeGreaterThanOrEqual(MIN_CHILD_ENERGY);
    // L'enfant a son propre génome, distinct de celui du parent.
    expect(w.orgGenome[child]).not.toBe(w.orgGenome[parent]);
  });

  it("un parent trop pauvre ne se reproduit pas : pas d'enfant condamné", () => {
    const w = flatWorld();
    const plan = makePlan([[0, 0, 0, MOUTH]]);
    const g = fixedBrain(plan, () => 2000);
    const p = registerGenome(w, g);
    const parent = spawnOrganism(w, p, 20, 1, 20, MIN_CHILD_ENERGY);
    stepN(w, 5);
    let others = 0;
    for (let id = 1; id < 100; id++) if (id !== parent && w.orgState[id] === 1) others++;
    expect(others).toBe(0);
  });
});
