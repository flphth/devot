import { MAX_ORGANISMS } from "./constants.js";
import {
  applyEnergy,
  passConnectivity,
  passDeath,
  passGrowth,
  passMetabolism,
  passTerrain,
} from "./passes.js";
import { VoxelWorld } from "./world.js";

/**
 * Un tick du monde. L'ordre est significatif et fait partie du contrat de
 * déterminisme : le laboratoire (GPU) devra l'appliquer à l'identique.
 *
 * 1. recenser les vivants
 * 2. remettre les deltas d'énergie à zéro
 * 3. passe terrain fusionnée (eau, biomasse, alimentation) → ping-pong
 * 4. métabolisme (coût d'entretien voxel par voxel)
 * 5. appliquer les deltas
 * 6. mort et décomposition
 * 7. connexité — les blessures se règlent AVANT la réparation
 * 8. morphogenèse (croissance ou cicatrisation)
 *
 * L'ordre 7 avant 8 est essentiel : dans l'autre sens, la cicatrisation
 * repousserait le voxel détruit dans le même tick et un membre ne serait
 * jamais amputé.
 */
export function step(w: VoxelWorld): void {
  w.refreshAlive();
  w.energyDelta.fill(0, 0, MAX_ORGANISMS);

  passTerrain(w);
  w.swapBuffers();

  passMetabolism(w);
  applyEnergy(w);
  passDeath(w);
  passConnectivity(w);
  passGrowth(w);

  w.tick++;
}

/** Fait avancer le monde de n ticks. */
export function stepN(w: VoxelWorld, n: number): void {
  for (let k = 0; k < n; k++) step(w);
}
