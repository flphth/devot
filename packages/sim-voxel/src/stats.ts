import { ALIVE, BIOMASS, EYE, MAX_ORGANISMS, VOXEL_COUNT } from "./constants.js";
import { hash32 } from "./rng.js";
import { VoxelWorld } from "./world.js";

/**
 * Empreinte de l'état du monde en un seul entier 32 bits.
 * C'est l'outil du déterminisme : deux runs de même graine doivent produire la
 * même suite d'empreintes, et c'est aussi la comparaison qui servira au test de
 * conformité CPU ↔ GPU en P5.2.
 */
export function worldHash(w: VoxelWorld): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < VOXEL_COUNT; i++) {
    h = hash32(h, w.material[i]! | (w.nutrient[i]! << 8), w.owner[i]!);
  }
  for (let id = 1; id < MAX_ORGANISMS; id++) {
    if (w.orgState[id] !== ALIVE && w.bodyLen[id] === 0) continue;
    h = hash32(h, w.energy[id]!, (w.bodyLen[id]! << 16) | w.growthCursor[id]!);
  }
  return h >>> 0;
}

/** Agrégats : ce que le réseau transmet en mode accéléré (jamais des voxels). */
export interface WorldStats {
  tick: number;
  population: number;
  totalEnergy: number;
  totalBodyVoxels: number;
  avgBodyVoxels: number;
  maxGeneration: number;
  avgGeneration: number;
  biomassVoxels: number;
  biomassNutrient: number;
  /** Mesures d'émergence : aucune fitness n'est imposée, on observe. */
  avgNeurons: number;
  avgMouths: number;
  avgMuscles: number;
  avgEyes: number;
  /** Énergie ingérée par tick de vie, moyennée sur les vivants. */
  avgIntakeRate: number;
  avgDistance: number;
}

export function collectStats(w: VoxelWorld): WorldStats {
  let population = 0;
  let totalEnergy = 0;
  let totalBody = 0;
  let maxGen = 0;
  let sumGen = 0;
  let sumNeurons = 0;
  let sumMouths = 0;
  let sumMuscles = 0;
  let sumEyes = 0;
  let sumIntakeRate = 0;
  let sumDistance = 0;
  for (let id = 1; id < MAX_ORGANISMS; id++) {
    if (w.orgState[id] !== ALIVE) continue;
    population++;
    totalEnergy += w.energy[id]!;
    totalBody += w.bodyLen[id]!;
    const gen = w.generation[id]!;
    sumGen += gen;
    if (gen > maxGen) maxGen = gen;
    sumNeurons += w.neuronCount[id]!;
    sumMouths += w.mouthCount[id]!;
    sumMuscles += w.muscleCount[id]!;
    sumEyes += countEyes(w, id);
    const age = w.tick - w.bornTick[id]!;
    if (age > 0) sumIntakeRate += w.eaten[id]! / age;
    sumDistance += w.distance[id]!;
  }
  const per = (v: number): number => (population === 0 ? 0 : v / population);

  let biomassVoxels = 0;
  let biomassNutrient = 0;
  for (let i = 0; i < VOXEL_COUNT; i++) {
    const m = w.material[i]!;
    if (m === BIOMASS) {
      biomassVoxels++;
      biomassNutrient += w.nutrient[i]!;
    }
  }

  return {
    tick: w.tick,
    population,
    totalEnergy,
    totalBodyVoxels: totalBody,
    avgBodyVoxels: population === 0 ? 0 : totalBody / population,
    maxGeneration: maxGen,
    avgGeneration: per(sumGen),
    biomassVoxels,
    biomassNutrient,
    avgNeurons: per(sumNeurons),
    avgMouths: per(sumMouths),
    avgMuscles: per(sumMuscles),
    avgEyes: per(sumEyes),
    avgIntakeRate: per(sumIntakeRate),
    avgDistance: per(sumDistance),
  };
}

function countEyes(w: VoxelWorld, id: number): number {
  const base = w.bodySlot(id);
  const len = w.bodyLen[id]!;
  let n = 0;
  for (let k = 0; k < len; k++) if (w.material[w.bodyList[base + k]!] === EYE) n++;
  return n;
}
