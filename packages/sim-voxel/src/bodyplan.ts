import { BONE, EYE, MOUTH, MUSCLE, NEURON, STORAGE } from "./constants.js";
import type { BodyPlan } from "./world.js";

/**
 * Plans de corps de P5.0 : écrits à la main, uniquement pour éprouver la
 * morphogenèse (croissance, amputation, cicatrisation) et pour mesurer le coût
 * d'un tick. En P5.1 ils seront produits et mutés par le génome.
 *
 * Convention : le premier voxel est le germe (offset 0,0,0), et chaque voxel
 * suivant doit toucher un voxel déjà placé — sinon la croissance ne peut pas
 * l'atteindre et le plan est invalide.
 */
export function makePlan(
  voxels: ReadonlyArray<readonly [number, number, number, number]>,
): BodyPlan {
  const n = voxels.length;
  const plan: BodyPlan = {
    dx: new Int8Array(n),
    dy: new Int8Array(n),
    dz: new Int8Array(n),
    type: new Uint8Array(n),
  };
  for (let k = 0; k < n; k++) {
    const v = voxels[k]!;
    plan.dx[k] = v[0];
    plan.dy[k] = v[1];
    plan.dz[k] = v[2];
    plan.type[k] = v[3];
  }
  return plan;
}

/** Vérifie qu'un plan est connexe dans son ordre de croissance. */
export function isPlanGrowable(plan: BodyPlan): boolean {
  const n = plan.type.length;
  if (n === 0) return false;
  if (plan.dx[0] !== 0 || plan.dy[0] !== 0 || plan.dz[0] !== 0) return false;
  for (let k = 1; k < n; k++) {
    let touches = false;
    for (let j = 0; j < k && !touches; j++) {
      const d =
        Math.abs(plan.dx[k]! - plan.dx[j]!) +
        Math.abs(plan.dy[k]! - plan.dy[j]!) +
        Math.abs(plan.dz[k]! - plan.dz[j]!);
      if (d === 1) touches = true;
    }
    if (!touches) return false;
  }
  return true;
}

/** Brouteur : une bouche au sol, une réserve, un œil. Simple et viable. */
export const PLAN_GRAZER = makePlan([
  [0, 0, 0, BONE],
  [0, 1, 0, STORAGE],
  [1, 0, 0, MOUTH],
  [-1, 0, 0, MOUTH],
  [0, 1, 1, EYE],
  [0, 0, 1, MUSCLE],
  [0, 0, -1, MUSCLE],
]);

/** Ver : un corps allongé, beaucoup de muscle, une seule bouche. */
export const PLAN_WORM = makePlan([
  [0, 0, 0, BONE],
  [0, 0, 1, MUSCLE],
  [0, 0, 2, MUSCLE],
  [0, 0, 3, MUSCLE],
  [0, 0, -1, MOUTH],
  [0, 1, 0, STORAGE],
  [0, 0, 4, MUSCLE],
]);

/** Penseur : des neurones, donc coûteux — sert à vérifier que penser tue. */
export const PLAN_THINKER = makePlan([
  [0, 0, 0, BONE],
  [0, 1, 0, NEURON],
  [0, 2, 0, NEURON],
  [1, 1, 0, NEURON],
  [-1, 0, 0, MOUTH],
  [1, 0, 0, STORAGE],
  [0, 0, 1, EYE],
]);
