import { ALIVE, CAPACITY_BASE, ROCK, SX, SY, SZ, TISSUE_MIN, VOID } from "./constants.js";
import { SeededRng } from "./rng.js";
import type { BodyPlan } from "./world.js";
import { VoxelWorld } from "./world.js";

/** Enregistre un plan de corps et renvoie son index dans le registre. */
export function registerPlan(w: VoxelWorld, plan: BodyPlan): number {
  w.plans.push(plan);
  return w.plans.length - 1;
}

/**
 * Fait naître un organisme : un unique voxel germe qui poussera ensuite.
 * Renvoie son id, ou 0 si l'emplacement est impossible.
 */
export function spawnOrganism(
  w: VoxelWorld,
  planId: number,
  x: number,
  y: number,
  z: number,
  energy = CAPACITY_BASE,
  generation = 0,
): number {
  if (!w.inBounds(x, y, z)) return 0;
  const i = w.idx(x, y, z);
  const target = w.material[i]!;
  if (target === ROCK || target >= TISSUE_MIN) return 0;

  const plan = w.plans[planId];
  if (!plan) return 0;

  const id = w.allocOrganism();
  if (id === 0) return 0;

  w.orgState[id] = ALIVE;
  w.planId[id] = planId;
  w.growthCursor[id] = 0;
  w.seedIdx[id] = i;
  w.generation[id] = generation;
  w.damaged[id] = 0;
  w.bodyLen[id] = 0;
  w.voxelCount[id] = 0;
  w.neuronCount[id] = 0;
  w.storageCount[id] = 0;
  w.muscleCount[id] = 0;
  w.mouthCount[id] = 0;
  w.energy[id] = energy;
  w.refreshCapacity(id);

  // Le germe est le premier voxel du plan (offset 0,0,0 par convention).
  w.addBodyVoxel(id, i, plan.type[0]!);
  w.growthCursor[id] = 1;
  return id;
}

/**
 * Cherche une case libre posée sur un sol solide, près de (cx,cz).
 * Séquentiel, hors boucle chaude → générateur à état légitime.
 */
export function findSpawnSpot(
  w: VoxelWorld,
  rng: SeededRng,
  attempts = 64,
): { x: number; y: number; z: number } | null {
  for (let a = 0; a < attempts; a++) {
    const x = rng.below(SX);
    const z = rng.below(SZ);
    for (let y = 1; y < SY - 1; y++) {
      const i = w.idx(x, y, z);
      if (w.material[i] !== VOID) continue;
      const below = w.material[w.idx(x, y - 1, z)]!;
      if (below === ROCK) return { x, y, z };
      break;
    }
  }
  return null;
}
