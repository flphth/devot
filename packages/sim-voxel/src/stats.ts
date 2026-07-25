import { ALIVE, BIOMASS, MAX_ORGANISMS, VOXEL_COUNT, WATER } from "./constants.js";
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
  biomassVoxels: number;
  biomassNutrient: number;
  waterVoxels: number;
}

export function collectStats(w: VoxelWorld): WorldStats {
  let population = 0;
  let totalEnergy = 0;
  let totalBody = 0;
  let maxGen = 0;
  for (let id = 1; id < MAX_ORGANISMS; id++) {
    if (w.orgState[id] !== ALIVE) continue;
    population++;
    totalEnergy += w.energy[id]!;
    totalBody += w.bodyLen[id]!;
    if (w.generation[id]! > maxGen) maxGen = w.generation[id]!;
  }

  let biomassVoxels = 0;
  let biomassNutrient = 0;
  let waterVoxels = 0;
  for (let i = 0; i < VOXEL_COUNT; i++) {
    const m = w.material[i]!;
    if (m === BIOMASS) {
      biomassVoxels++;
      biomassNutrient += w.nutrient[i]!;
    } else if (m === WATER) waterVoxels++;
  }

  return {
    tick: w.tick,
    population,
    totalEnergy,
    totalBodyVoxels: totalBody,
    avgBodyVoxels: population === 0 ? 0 : totalBody / population,
    maxGeneration: maxGen,
    biomassVoxels,
    biomassNutrient,
    waterVoxels,
  };
}
