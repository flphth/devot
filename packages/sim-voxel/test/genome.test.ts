import { describe, expect, it } from "vitest";
import {
  BONE,
  MAX_BODY_VOXELS,
  MAX_NEURON_VOXELS,
  MOUTH,
  NEURON,
  ROCK,
  decodeGenome,
  encodeGenome,
  genomeFromPlan,
  makePlan,
  mutate,
  mutationSeed,
  planNeurons,
  randomGenome,
  validateGenome,
  weightCount,
} from "../src/index.js";

describe("génome — sérialisation", () => {
  it("un aller-retour binaire restitue le génome à l'identique", () => {
    const g = randomGenome(1234, 10);
    const bytes = encodeGenome(g);
    const back = decodeGenome(bytes);
    expect(back).not.toBeNull();
    expect(Array.from(back!.body.dx)).toEqual(Array.from(g.body.dx));
    expect(Array.from(back!.body.dy)).toEqual(Array.from(g.body.dy));
    expect(Array.from(back!.body.dz)).toEqual(Array.from(g.body.dz));
    expect(Array.from(back!.body.type)).toEqual(Array.from(g.body.type));
    expect(Array.from(back!.weights)).toEqual(Array.from(g.weights));
    expect(back!.hiddenMax).toBe(g.hiddenMax);
    expect(back!.reproThreshold).toBe(g.reproThreshold);
  });

  it("reste compact : quelques kilo-octets, ce qui rend le relâcher trivial", () => {
    const small = encodeGenome(randomGenome(1, 8));
    expect(small.byteLength).toBeLessThan(1024);
    // Même un corps important avec beaucoup de neurones tient largement.
    const voxels: Array<[number, number, number, number]> = [[0, 0, 0, MOUTH]];
    for (let k = 1; k < 60; k++) voxels.push([0, 0, k % 8, NEURON]);
    const big = encodeGenome(genomeFromPlan(makePlan(voxels), 7));
    expect(big.byteLength).toBeLessThan(16 * 1024);
  });

  it("des octets corrompus sont refusés, pas interprétés au hasard", () => {
    expect(decodeGenome(new Uint8Array(4))).toBeNull();
    const g = encodeGenome(randomGenome(5, 6));
    g[0] = 0; // signature cassée
    expect(decodeGenome(g)).toBeNull();
    const truncated = encodeGenome(randomGenome(5, 6)).slice(0, 20);
    expect(decodeGenome(truncated)).toBeNull();
  });
});

describe("génome — validation (contenu venu d'un client, donc non fiable)", () => {
  it("accepte un génome sain", () => {
    expect(validateGenome(randomGenome(42, 9))).toBeNull();
  });

  it("refuse un germe qui n'est pas à l'origine", () => {
    const g = randomGenome(1, 5);
    g.body.dx[0] = 3;
    expect(validateGenome(g)?.reason).toContain("germe");
  });

  it("refuse un corps trop grand", () => {
    const voxels: Array<[number, number, number, number]> = [[0, 0, 0, MOUTH]];
    for (let k = 1; k <= MAX_BODY_VOXELS; k++) voxels.push([k, 0, 0, BONE]);
    const g = genomeFromPlan(makePlan(voxels), 1);
    expect(validateGenome(g)?.reason).toContain("max");
  });

  it("refuse trop de neurones", () => {
    const voxels: Array<[number, number, number, number]> = [[0, 0, 0, MOUTH]];
    for (let k = 1; k <= MAX_NEURON_VOXELS + 5; k++) voxels.push([k, 0, 0, NEURON]);
    const plan = makePlan(voxels);
    // On contourne planNeurons (qui borne) pour simuler un client malveillant.
    const g = { ...genomeFromPlan(plan, 1), hiddenMax: MAX_NEURON_VOXELS + 5 };
    expect(validateGenome(g)).not.toBeNull();
  });

  it("refuse un type de voxel qui n'est pas du tissu", () => {
    const g = genomeFromPlan(
      makePlan([
        [0, 0, 0, MOUTH],
        [1, 0, 0, ROCK], // de la roche dans un corps
      ]),
      1,
    );
    expect(validateGenome(g)?.reason).toContain("illégal");
  });

  it("refuse deux voxels au même endroit", () => {
    const g = genomeFromPlan(
      makePlan([
        [0, 0, 0, MOUTH],
        [1, 0, 0, BONE],
        [1, 0, 0, BONE],
      ]),
      1,
    );
    expect(validateGenome(g)?.reason).toContain("même offset");
  });

  it("refuse un corps dont un voxel est détaché", () => {
    const g = genomeFromPlan(
      makePlan([
        [0, 0, 0, MOUTH],
        [5, 0, 0, BONE],
      ]),
      1,
    );
    expect(validateGenome(g)?.reason).toContain("détaché");
  });

  it("refuse un nombre de poids incohérent avec le cerveau", () => {
    const g = randomGenome(3, 6);
    const tampered = { ...g, weights: new Int16Array(g.weights.length + 7) };
    expect(validateGenome(tampered)?.reason).toContain("poids");
  });

  it("refuse un seuil de reproduction hors bornes", () => {
    const g = randomGenome(3, 6);
    expect(validateGenome({ ...g, reproThreshold: 0 })).not.toBeNull();
    expect(validateGenome({ ...g, reproThreshold: 5000 })).not.toBeNull();
  });
});

describe("génome — mutation", () => {
  it("est déterministe : même graine, même enfant", () => {
    const parent = randomGenome(77, 8);
    const a = mutate(parent, 999);
    const b = mutate(parent, 999);
    expect(Array.from(a.body.type)).toEqual(Array.from(b.body.type));
    expect(Array.from(a.weights)).toEqual(Array.from(b.weights));
    expect(a.reproThreshold).toBe(b.reproThreshold);
  });

  it("des graines différentes donnent des enfants différents", () => {
    const parent = randomGenome(77, 8);
    const a = mutate(parent, 1);
    const b = mutate(parent, 2);
    const same =
      Array.from(a.body.type).join() === Array.from(b.body.type).join() &&
      Array.from(a.weights).join() === Array.from(b.weights).join();
    expect(same).toBe(false);
  });

  it("l'enfant reste toujours un génome VALIDE, sur des centaines de lignées", () => {
    // C'est la propriété qui compte : une mutation ne doit jamais produire un
    // corps impossible, sinon le monde commun rejetterait ses propres enfants.
    let g = randomGenome(11, 6);
    for (let k = 0; k < 400; k++) {
      g = mutate(g, mutationSeed(k + 1, k, 4242));
      const bad = validateGenome(g);
      expect(bad, `génération ${k} : ${bad?.reason}`).toBeNull();
    }
  });

  it("le cerveau reste dimensionné par les neurones du corps", () => {
    let g = randomGenome(21, 7);
    for (let k = 0; k < 200; k++) {
      g = mutate(g, mutationSeed(k + 1, k, 7));
      expect(g.hiddenMax).toBe(planNeurons(g.body));
      expect(g.weights.length).toBe(weightCount(g.hiddenMax));
    }
  });

  it("le germe garde son type : c'est l'identité de l'organisme", () => {
    let g = randomGenome(31, 6);
    const seedType = g.body.type[0]!;
    for (let k = 0; k < 200; k++) {
      g = mutate(g, mutationSeed(k + 1, k, 3));
      expect(g.body.type[0]).toBe(seedType);
      expect(g.body.dx[0]).toBe(0);
      expect(g.body.dy[0]).toBe(0);
      expect(g.body.dz[0]).toBe(0);
    }
  });

  it("un génome aléatoire naît avec une bouche : sans elle rien n'entre jamais", () => {
    for (let s = 1; s < 40; s++) {
      const g = randomGenome(s * 7919, 4 + (s % 9));
      let mouths = 0;
      for (const t of g.body.type) if (t === MOUTH) mouths++;
      expect(mouths).toBeGreaterThan(0);
      // Et le germe lui-même est une bouche : un nouveau-né d'un seul voxel
      // doit pouvoir se nourrir avant d'avoir l'énergie de pousser.
      expect(g.body.type[0]).toBe(MOUTH);
    }
  });
});
