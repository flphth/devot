import { BIOMASS, EYE, MOUTH, NO_OWNER, SX, SY, SZ, TISSUE_MIN } from "./constants.js";
import {
  FP_ONE,
  NUM_INPUTS,
  NUM_OUTPUTS,
  OUT_MOVE_NX,
  OUT_MOVE_NZ,
  OUT_MOVE_PX,
  OUT_MOVE_PZ,
  type Genome,
} from "./genome.js";
import type { VoxelWorld } from "./world.js";

/**
 * Le cerveau : un petit réseau de neurones dont la CAPACITÉ EST BORNÉE PAR LES
 * VOXELS NEURONE du corps. Vouloir être intelligent oblige à porter des
 * neurones, donc à payer leur entretien : la morphologie détermine
 * l'intelligence, et l'intelligence coûte la vie.
 *
 * Toute l'arithmétique est entière (virgule fixe, unité 1/FP_ONE) : exacte,
 * indépendante de l'ordre, et identique en WGSL — c'est la condition de la
 * conformité CPU ↔ GPU du laboratoire.
 */

/** Portée d'un œil, en voxels. */
export const EYE_RANGE = 12;

export const IN_ENERGY = 0;
export const IN_FOOD_PX = 1;
export const IN_FOOD_NX = 2;
export const IN_FOOD_PZ = 3;
export const IN_FOOD_NZ = 4;
export const IN_MOUTH_CONTACT = 5;
export const IN_OTHER_PX = 6;
export const IN_OTHER_NX = 7;
export const IN_OTHER_PZ = 8;
export const IN_OTHER_NZ = 9;

const SCAN_DX = new Int8Array([1, -1, 0, 0]);
const SCAN_DZ = new Int8Array([0, 0, 1, -1]);

/**
 * Remplit les entrées sensorielles d'un organisme.
 * Un corps sans œil est aveugle : les entrées directionnelles restent à zéro.
 * Un corps sans bouche ne sent pas la nourriture au contact.
 */
export function sense(w: VoxelWorld, id: number, out: Int32Array): void {
  for (let k = 0; k < NUM_INPUTS; k++) out[k] = 0;

  const cap = w.capacity[id]!;
  out[IN_ENERGY] = cap > 0 ? ((w.energy[id]! * FP_ONE) / cap) | 0 : 0;

  const base = w.bodySlot(id);
  const len = w.bodyLen[id]!;
  if (len === 0) return;

  // Contact bouche ↔ biomasse : le signal le plus utile pour survivre.
  let hasEye = false;
  for (let k = 0; k < len; k++) {
    const i = w.bodyList[base + k]!;
    const m = w.material[i]!;
    if (m === EYE) hasEye = true;
    else if (m === MOUTH && touchesBiomass(w, i)) out[IN_MOUTH_CONTACT] = FP_ONE;
  }
  if (!hasEye) return; // aveugle : pas de perception à distance

  // Perception à distance depuis le germe, dans les 4 directions latérales.
  const seed = w.seedIdx[id]!;
  const sx = w.xOf(seed);
  const sy = w.yOf(seed);
  const sz = w.zOf(seed);
  for (let d = 0; d < 4; d++) {
    let foodDist = -1;
    let otherDist = -1;
    for (let r = 1; r <= EYE_RANGE; r++) {
      const x = sx + SCAN_DX[d]! * r;
      const z = sz + SCAN_DZ[d]! * r;
      if (x < 0 || x >= SX || z < 0 || z >= SZ) break;
      // On regarde à hauteur du germe et un cran au-dessus (le sol ondule).
      for (let dy = 0; dy <= 1; dy++) {
        const y = sy + dy;
        if (y >= SY) continue;
        const i = w.idx(x, y, z);
        const m = w.material[i]!;
        if (foodDist < 0 && m === BIOMASS) foodDist = r;
        else if (otherDist < 0 && m >= TISSUE_MIN && w.owner[i] !== id && w.owner[i] !== NO_OWNER) {
          otherDist = r;
        }
      }
      if (foodDist >= 0 && otherDist >= 0) break;
    }
    // Plus c'est proche, plus le signal est fort.
    if (foodDist > 0) {
      out[IN_FOOD_PX + d] = (((EYE_RANGE - foodDist + 1) * FP_ONE) / EYE_RANGE) | 0;
    }
    if (otherDist > 0) {
      out[IN_OTHER_PX + d] = (((EYE_RANGE - otherDist + 1) * FP_ONE) / EYE_RANGE) | 0;
    }
  }
}

function touchesBiomass(w: VoxelWorld, i: number): boolean {
  const x = w.xOf(i);
  const y = w.yOf(i);
  const z = w.zOf(i);
  if (x + 1 < SX && w.material[w.idx(x + 1, y, z)] === BIOMASS) return true;
  if (x > 0 && w.material[w.idx(x - 1, y, z)] === BIOMASS) return true;
  if (y + 1 < SY && w.material[w.idx(x, y + 1, z)] === BIOMASS) return true;
  if (y > 0 && w.material[w.idx(x, y - 1, z)] === BIOMASS) return true;
  if (z + 1 < SZ && w.material[w.idx(x, y, z + 1)] === BIOMASS) return true;
  if (z > 0 && w.material[w.idx(x, y, z - 1)] === BIOMASS) return true;
  return false;
}

/**
 * Évalue le cerveau. `hidden` est le nombre de neurones RÉELLEMENT présents
 * dans le corps, borné par celui du plan : perdre ses neurones rend bête,
 * les faire repousser rend à nouveau intelligent.
 */
export function think(
  g: Genome,
  inputs: Int32Array,
  hidden: number,
  hiddenBuf: Int32Array,
  outputs: Int32Array,
): void {
  const w = g.weights;
  const h = hidden > g.hiddenMax ? g.hiddenMax : hidden;

  if (h === 0) {
    // Aucun neurone : réflexe direct entrées → sorties.
    let o = 0;
    for (let j = 0; j < NUM_OUTPUTS; j++) {
      let sum = 0;
      for (let i = 0; i < NUM_INPUTS; i++) sum += w[o++]! * inputs[i]!;
      sum = (sum / FP_ONE) | 0;
      outputs[j] = clampFp(sum + w[NUM_INPUTS * NUM_OUTPUTS + j]!);
    }
    return;
  }

  // Couche cachée : NUM_INPUTS × h poids, puis h biais.
  let o = 0;
  for (let j = 0; j < h; j++) {
    let sum = 0;
    for (let i = 0; i < NUM_INPUTS; i++) sum += w[o++]! * inputs[i]!;
    sum = (sum / FP_ONE) | 0;
    hiddenBuf[j] = relu(sum);
  }
  // Les poids sont dimensionnés pour hiddenMax : on saute ceux des neurones
  // absents pour que la couche de sortie lise toujours au bon endroit.
  o = NUM_INPUTS * g.hiddenMax;
  for (let j = 0; j < h; j++) hiddenBuf[j] = relu(hiddenBuf[j]! + w[o + j]!);
  o += g.hiddenMax;

  for (let j = 0; j < NUM_OUTPUTS; j++) {
    let sum = 0;
    for (let i = 0; i < h; i++) sum += w[o + j * g.hiddenMax + i]! * hiddenBuf[i]!;
    sum = (sum / FP_ONE) | 0;
    outputs[j] = clampFp(sum + w[o + NUM_OUTPUTS * g.hiddenMax + j]!);
  }
}

function relu(v: number): number {
  if (v < 0) return 0;
  return v > FP_ONE * 4 ? FP_ONE * 4 : v;
}

function clampFp(v: number): number {
  if (v < -FP_ONE * 4) return -FP_ONE * 4;
  return v > FP_ONE * 4 ? FP_ONE * 4 : v;
}

/**
 * Direction de déplacement choisie : l'argmax des quatre sorties de mouvement,
 * ou -1 si aucune ne franchit le seuil. En cas d'égalité, la plus petite
 * direction gagne — le déterminisme interdit toute rupture d'égalité aléatoire.
 */
export function chosenDirection(outputs: Int32Array, threshold: number): number {
  let best = -1;
  let bestVal = threshold;
  for (let d = 0; d < 4; d++) {
    const v = outputs[OUT_MOVE_PX + d]!;
    if (v > bestVal) {
      bestVal = v;
      best = d;
    }
  }
  return best;
}

export const MOVE_DX = new Int8Array([1, -1, 0, 0]);
export const MOVE_DZ = new Int8Array([0, 0, 1, -1]);
export { OUT_MOVE_NX, OUT_MOVE_NZ, OUT_MOVE_PZ };
