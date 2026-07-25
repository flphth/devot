import { BONE, MOUTH, ROCK, SX, SZ, VOID, VoxelWorld, makePlan } from "../src/index.js";

/** Monde plat et nu : socle de roche à y=0, tout le reste vide. */
export function flatWorld(seed = 1): VoxelWorld {
  const w = new VoxelWorld(seed);
  w.material.fill(VOID);
  w.nutrient.fill(0);
  w.owner.fill(0);
  for (let z = 0; z < SZ; z++) {
    for (let x = 0; x < SX; x++) w.material[w.idx(x, 0, z)] = ROCK;
  }
  w.materialNext.set(w.material);
  w.nutrientNext.set(w.nutrient);
  w.ownerNext.set(w.owner);
  // Le monde est plat : borner la passe terrain accélère les tests d'un facteur
  // 4. Un test qui pose un voxel plus haut passe par `setMaterial`, qui
  // repousse la borne — donc rien n'est silencieusement tronqué.
  w.activeTop = 8;
  return w;
}

/** Plan minimal : un seul voxel d'os. Isole le métabolisme de la croissance. */
export const PLAN_SEED_BONE = makePlan([[0, 0, 0, BONE]]);
/** Plan minimal : une bouche unique. Isole l'alimentation. */
export const PLAN_SEED_MOUTH = makePlan([[0, 0, 0, MOUTH]]);
/** Ligne de trois os : sert aux tests d'amputation et de cicatrisation. */
export const PLAN_LINE3 = makePlan([
  [0, 0, 0, BONE],
  [1, 0, 0, BONE],
  [2, 0, 0, BONE],
]);

/** Compte les voxels d'un matériau donné. */
export function countMaterial(w: VoxelWorld, mat: number): number {
  let n = 0;
  for (let i = 0; i < w.material.length; i++) if (w.material[i] === mat) n++;
  return n;
}
