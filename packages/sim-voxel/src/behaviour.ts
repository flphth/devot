import {
  ALIVE,
  ATTACK_COST,
  BIOMASS,
  MOUTH_EFFICIENCY_DEN,
  MOUTH_EFFICIENCY_NUM,
  MIN_CHILD_ENERGY,
  MUSCLE_CONTRACTION_COST,
  NEURON_THINKING_COST,
  NO_OWNER,
  REPRO_COST,
  REPRO_CHILD_SHARE,
  ROCK,
  TISSUE_MIN,
  VOID,
} from "./constants.js";
import { MOVE_DX, MOVE_DZ, chosenDirection, sense, think } from "./brain.js";
import {
  FP_ONE,
  OUT_ATTACK,
  OUT_REPRODUCE,
  crossover,
  mutate,
  mutationSeed,
} from "./genome.js";
import { NEIGHBOR_DX, NEIGHBOR_DY, NEIGHBOR_DZ, VoxelWorld } from "./world.js";
import { damageVoxel } from "./passes.js";
import { spawnFromGenome } from "./spawn.js";

/** Seuils (en unités FP) au-delà desquels une sortie déclenche l'action. */
export const MOVE_THRESHOLD = FP_ONE >> 2;
export const REPRO_OUTPUT_THRESHOLD = FP_ONE >> 2;
export const ATTACK_OUTPUT_THRESHOLD = FP_ONE >> 1;

/**
 * Perception puis décision. Penser coûte : chaque voxel neurone actif prélève
 * son surcoût de pensée — c'est la transposition directe de « penser coûte la
 * vie » de l'ancien Devot dans la chair du nouveau.
 */
export function passBrain(w: VoxelWorld): void {
  for (let a = 0; a < w.aliveCount; a++) {
    const id = w.aliveIds[a]!;
    w.intentDir[id] = -1;
    w.intentRepro[id] = 0;
    w.intentAttack[id] = 0;

    const g = w.orgGenome[id];
    if (!g) continue;

    sense(w, id, w.senseBuf);
    const hidden = w.neuronCount[id]!;
    think(g, w.senseBuf, hidden, w.hiddenBuf, w.outBuf);

    if (hidden > 0) {
      w.energyDelta[id] = w.energyDelta[id]! - hidden * NEURON_THINKING_COST;
    }

    const dir = chosenDirection(w.outBuf, MOVE_THRESHOLD);
    if (dir >= 0 && w.muscleCount[id]! > 0) w.intentDir[id] = dir;
    if (w.outBuf[OUT_REPRODUCE]! > REPRO_OUTPUT_THRESHOLD) w.intentRepro[id] = 1;
    if (w.outBuf[OUT_ATTACK]! > ATTACK_OUTPUT_THRESHOLD) w.intentAttack[id] = 1;
  }
}

/**
 * Déplacement : le corps entier se translate d'un voxel. En deux temps —
 * on calcule toutes les cibles, on vide les anciennes cases, puis on écrit les
 * nouvelles — sinon un corps s'écraserait lui-même.
 * Les muscles paient la contraction : bouger un gros corps coûte cher.
 */
export function passMove(w: VoxelWorld): void {
  for (let a = 0; a < w.aliveCount; a++) {
    const id = w.aliveIds[a]!;
    const dir = w.intentDir[id]!;
    if (dir < 0) continue;

    const muscles = w.muscleCount[id]!;
    if (muscles === 0) continue;
    const cost = muscles * MUSCLE_CONTRACTION_COST;
    if (w.energy[id]! <= cost) continue;

    const dx = MOVE_DX[dir]!;
    const dz = MOVE_DZ[dir]!;
    const base = w.bodySlot(id);
    const len = w.bodyLen[id]!;

    // 1. Toutes les cibles doivent être libres (ou occupées par nous-mêmes).
    let ok = true;
    for (let k = 0; k < len && ok; k++) {
      const i = w.bodyList[base + k]!;
      const nx = w.xOf(i) + dx;
      const ny = w.yOf(i);
      const nz = w.zOf(i) + dz;
      if (!w.inBounds(nx, ny, nz)) {
        ok = false;
        break;
      }
      const ti = w.idx(nx, ny, nz);
      const tm = w.material[ti]!;
      const own = w.owner[ti]!;
      // On traverse le vide et l'eau ; la roche, la biomasse et les autres
      // corps bloquent (pas de destruction gratuite de matière).
      if (own === id) {
        // notre propre voxel : il se déplacera aussi
      } else if (tm !== VOID) {
        ok = false;
      }
      w.moveTargets[k] = ti;
      w.moveMats[k] = w.material[i]!;
    }
    if (!ok) continue;

    // 2. On libère les anciennes cases.
    for (let k = 0; k < len; k++) {
      const i = w.bodyList[base + k]!;
      w.material[i] = VOID;
      w.owner[i] = NO_OWNER;
      w.touch(i);
    }
    // 3. On écrit les nouvelles.
    const oldSeed = w.seedIdx[id]!;
    for (let k = 0; k < len; k++) {
      const ti = w.moveTargets[k]!;
      w.material[ti] = w.moveMats[k]!;
      w.owner[ti] = id;
      w.bodyList[base + k] = ti;
      w.touch(ti);
    }
    w.seedIdx[id] = w.idx(w.xOf(oldSeed) + dx, w.yOf(oldSeed), w.zOf(oldSeed) + dz);
    w.energy[id] = w.energy[id]! - cost;
    w.distance[id] = w.distance[id]! + 1;
  }
}

/**
 * PRÉDATION : un organisme qui le veut arrache un voxel de tissu ÉTRANGER au
 * contact de son corps.
 *
 * Le voxel arraché devient de la biomasse au sol — il n'est pas mangé sur le
 * coup. Le prédateur doit donc mordre puis rester manger, ce qui l'expose et
 * laisse au mordu une chance de fuir avec sa chair. C'est aussi ce qui fait que
 * mordre ne crée pas d'énergie : la chair vaut ce qu'elle valait.
 *
 * On mord le PREMIER voxel étranger trouvé dans l'ordre de voisinage fixe :
 * comme partout ailleurs, aucune rupture d'égalité aléatoire.
 */
export function passAttack(w: VoxelWorld): void {
  const count = w.aliveCount;
  for (let a = 0; a < count; a++) {
    const id = w.aliveIds[a]!;
    if (w.orgState[id] !== ALIVE) continue;
    if (w.intentAttack[id] === 0) continue;
    if (w.energy[id]! <= ATTACK_COST) continue;

    const target = firstForeignTissue(w, id);
    if (target < 0) continue;

    const victim = w.owner[target]!;
    if (!damageVoxel(w, target)) continue;

    // La chair passe dans le prédateur : `damageVoxel` a posé de la biomasse à
    // la place du tissu, on la lui donne au lieu de la laisser au sol.
    const flesh = w.nutrient[target]!;
    const gained = ((flesh * MOUTH_EFFICIENCY_NUM) / MOUTH_EFFICIENCY_DEN) | 0;
    w.setMaterial(target, VOID);
    w.energy[id] = w.energy[id]! - ATTACK_COST + gained;
    w.eaten[id] = w.eaten[id]! + gained;
    w.bites[id] = w.bites[id]! + 1;
    w.bitten[victim] = w.bitten[victim]! + 1;
  }
}

/** Premier voxel de tissu appartenant à un AUTRE organisme, au contact. */
function firstForeignTissue(w: VoxelWorld, id: number): number {
  const base = w.bodySlot(id);
  const len = w.bodyLen[id]!;
  for (let k = 0; k < len; k++) {
    const i = w.bodyList[base + k]!;
    const x = w.xOf(i);
    const y = w.yOf(i);
    const z = w.zOf(i);
    for (let d = 0; d < 6; d++) {
      const nx = x + NEIGHBOR_DX[d]!;
      const ny = y + NEIGHBOR_DY[d]!;
      const nz = z + NEIGHBOR_DZ[d]!;
      if (!w.inBounds(nx, ny, nz)) continue;
      const ni = w.idx(nx, ny, nz);
      const other = w.owner[ni]!;
      if (other === NO_OWNER || other === id) continue;
      if (!w.isTissue(ni)) continue;
      return ni;
    }
  }
  return -1;
}

/**
 * Reproduction : au-dessus de son seuil d'énergie et si son cerveau le veut,
 * un organisme engendre. Le génome de l'enfant est une copie MUTÉE, et une
 * part de l'énergie du parent passe dans l'enfant : procréer épuise.
 *
 * Au CONTACT D'UNE LIGNÉE ÉTRANGÈRE, l'enfant est un croisement : plan de corps
 * de l'initiateur, poids de cerveau mêlés aux deux. L'initiateur reste le seul
 * suzerain — c'est lui qui paie.
 */
export function passReproduce(w: VoxelWorld): void {
  // On fige la liste : un enfant né pendant la passe ne se reproduit pas dans
  // le même tick (sinon l'ordre de parcours changerait le résultat).
  const count = w.aliveCount;
  for (let a = 0; a < count; a++) {
    const id = w.aliveIds[a]!;
    if (w.orgState[id] !== ALIVE) continue;
    if (w.intentRepro[id] === 0) continue;

    const g = w.orgGenome[id];
    if (!g) continue;

    const threshold = ((w.capacity[id]! * g.reproThreshold) / 1000) | 0;
    if (w.energy[id]! < threshold) continue;
    if (w.energy[id]! <= REPRO_COST) continue;

    const spot = freeNeighbourOfBody(w, id);
    if (spot < 0) continue;

    const share = (((w.energy[id]! - REPRO_COST) * REPRO_CHILD_SHARE) / 1000) | 0;
    // Pas d'enfant qu'on ne peut pas doter : un nouveau-né sous-alimenté meurt
    // sans descendance, ce qui éteint la lignée au lieu de la propager.
    if (share < MIN_CHILD_ENERGY) continue;

    // Un partenaire au contact ? Alors l'enfant croise les deux cerveaux.
    const partner = firstForeignTissue(w, id);
    const partnerId = partner >= 0 ? w.owner[partner]! : NO_OWNER;
    const partnerGenome = partnerId !== NO_OWNER ? w.orgGenome[partnerId] : undefined;
    const seedForChild = mutationSeed(id, w.tick, w.seed);
    const childGenome = partnerGenome
      ? mutate(crossover(g, partnerGenome, seedForChild), seedForChild ^ 0x5bf0)
      : mutate(g, seedForChild);
    const childId = spawnFromGenome(
      w,
      childGenome,
      w.xOf(spot),
      w.yOf(spot),
      w.zOf(spot),
      share,
      w.generation[id]! + 1,
    );
    if (childId === 0) continue;

    w.energy[id] = w.energy[id]! - REPRO_COST - share;
    if (partnerGenome) w.crossbred[childId] = 1;
    // L'héritage n'est pas une entrée d'énergie : il sort du parent pour entrer
    // dans l'enfant. `spawnFromGenome` l'a compté comme une dotation, on défait
    // cette ligne — sinon le registre autoriserait le monde à grossir d'une
    // génération à l'autre, et le test de conservation ne prouverait plus rien.
    w.energyInjected -= share;
  }
}

/** Première case libre (vide ou eau) touchant le corps, ordre fixe. */
function freeNeighbourOfBody(w: VoxelWorld, id: number): number {
  const base = w.bodySlot(id);
  const len = w.bodyLen[id]!;
  for (let k = 0; k < len; k++) {
    const i = w.bodyList[base + k]!;
    const x = w.xOf(i);
    const y = w.yOf(i);
    const z = w.zOf(i);
    for (let d = 0; d < 6; d++) {
      const nx = x + NEIGHBOR_DX[d]!;
      const ny = y + NEIGHBOR_DY[d]!;
      const nz = z + NEIGHBOR_DZ[d]!;
      if (!w.inBounds(nx, ny, nz)) continue;
      const ni = w.idx(nx, ny, nz);
      const m = w.material[ni]!;
      if (m === VOID) return ni;
    }
  }
  return -1;
}

export { BIOMASS, ROCK, TISSUE_MIN };
