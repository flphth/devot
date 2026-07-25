import {
  CROSSOVER_WEIGHT_SHARE,
  BONE,
  EYE,
  MAX_BODY_VOXELS,
  MAX_NEURON_VOXELS,
  MOUTH,
  MUSCLE,
  NEURON,
  STORAGE,
  TISSUE_MIN,
} from "./constants.js";
import { SeededRng, hash32 } from "./rng.js";
import type { BodyPlan } from "./world.js";

/**
 * Le génome — la SEULE chose qui voyage entre le laboratoire et le monde
 * commun. Il doit donc être compact, sérialisable, et interprété exactement de
 * la même façon des deux côtés : c'est pour cette raison qu'il vit dans le
 * noyau partagé et non dans un package à part.
 */
export interface Genome {
  /** Plan de corps : offsets relatifs au germe, dans l'ordre de croissance. */
  body: BodyPlan;
  /**
   * Poids du cerveau en virgule fixe (unité : 1/FP_ONE). Dimensionné pour le
   * nombre MAXIMAL de neurones du plan ; à l'exécution, seuls les neurones
   * réellement présents dans le corps sont actifs.
   */
  weights: Int16Array;
  /** Nombre de voxels neurone présents dans le plan (borne du cerveau). */
  hiddenMax: number;
  /** Seuil de reproduction, en millièmes de la capacité (0..1000). */
  reproThreshold: number;
}

// ── Cerveau : dimensions fixes ──────────────────────────────────────────────
export const FP_ONE = 1024;
export const NUM_INPUTS = 10;
export const NUM_OUTPUTS = 6;

export const OUT_MOVE_PX = 0;
export const OUT_MOVE_NX = 1;
export const OUT_MOVE_PZ = 2;
export const OUT_MOVE_NZ = 3;
export const OUT_REPRODUCE = 4;
export const OUT_ATTACK = 5;

/** Nombre de poids nécessaires pour un cerveau à `hidden` neurones. */
export function weightCount(hidden: number): number {
  // Sans neurone : réflexe direct entrées → sorties (+ biais).
  if (hidden === 0) return NUM_INPUTS * NUM_OUTPUTS + NUM_OUTPUTS;
  return NUM_INPUTS * hidden + hidden + hidden * NUM_OUTPUTS + NUM_OUTPUTS;
}

/** Compte les voxels neurone d'un plan : c'est la borne du cerveau. */
export function planNeurons(body: BodyPlan): number {
  let n = 0;
  for (let k = 0; k < body.type.length; k++) if (body.type[k] === NEURON) n++;
  return n > MAX_NEURON_VOXELS ? MAX_NEURON_VOXELS : n;
}

/** Types de tissus qu'une mutation peut faire apparaître. */
const TISSUE_CHOICES = new Uint8Array([BONE, MUSCLE, STORAGE, MOUTH, EYE, NEURON]);

// ── Construction ────────────────────────────────────────────────────────────

/** Génome à partir d'un plan de corps, avec un cerveau tiré au hasard. */
export function genomeFromPlan(body: BodyPlan, seed: number): Genome {
  const hiddenMax = planNeurons(body);
  const weights = new Int16Array(weightCount(hiddenMax));
  const rng = new SeededRng(seed);
  for (let k = 0; k < weights.length; k++) {
    // Poids initiaux dans [-FP_ONE/2, FP_ONE/2] : ni saturés, ni nuls.
    weights[k] = rng.range(-FP_ONE >> 1, FP_ONE >> 1);
  }
  return { body, weights, hiddenMax, reproThreshold: 450 };
}

/**
 * Génome aléatoire viable : un germe d'os, au moins une bouche (sinon il ne
 * peut pas manger), puis quelques tissus tirés au hasard en croissance
 * connexe. Sert de population de départ au laboratoire.
 */
export function randomGenome(seed: number, size = 8): Genome {
  const rng = new SeededRng(seed);
  const n = Math.max(3, Math.min(MAX_BODY_VOXELS, size));

  const dx = new Int8Array(n);
  const dy = new Int8Array(n);
  const dz = new Int8Array(n);
  const type = new Uint8Array(n);

  // Le GERME EST UNE BOUCHE. Un nouveau-né n'est qu'un seul voxel : si ce
  // voxel ne peut pas manger, il doit d'abord pousser — donc dépenser une
  // énergie qu'il n'a pas encore. Faire du germe une bouche brise ce blocage.
  type[0] = MOUTH;
  // PUIS UN NEURONE, tout de suite. Sans système nerveux un corps n'agit pas :
  // il ne se déplace pas et surtout ne se reproduit pas (cf. `think`). Un
  // fondateur sans neurone est donc une impasse garantie, et un fondateur dont
  // le neurone arrive tard dans le plan traverse une longue enfance stérile —
  // la croissance suit l'ordre du plan, un voxel par tick. Mesuré : en tirant ce
  // voxel au hasard, la moitié des mondes stagnaient à la génération 1 après
  // 6 000 ticks. La mutation peut toujours le retirer ensuite ; cette lignée
  // s'éteint alors, et c'est précisément le propos.
  dx[1] = 1;
  type[1] = NEURON;
  let placed = 2;

  while (placed < n) {
    // On s'accroche à un voxel déjà placé, dans une direction libre.
    const anchor = rng.below(placed);
    const d = rng.below(6);
    const ox = dx[anchor]! + (d === 0 ? 1 : d === 1 ? -1 : 0);
    const oy = dy[anchor]! + (d === 2 ? 1 : d === 3 ? -1 : 0);
    const oz = dz[anchor]! + (d === 4 ? 1 : d === 5 ? -1 : 0);
    if (oy < 0 || oy > 6 || Math.abs(ox) > 6 || Math.abs(oz) > 6) continue;
    let taken = false;
    for (let k = 0; k < placed && !taken; k++) {
      if (dx[k] === ox && dy[k] === oy && dz[k] === oz) taken = true;
    }
    if (taken) continue;
    dx[placed] = ox;
    dy[placed] = oy;
    dz[placed] = oz;
    type[placed] = TISSUE_CHOICES[rng.below(TISSUE_CHOICES.length)]!;
    placed++;
  }

  return genomeFromPlan({ dx, dy, dz, type }, seed ^ 0x51ed);
}

/**
 * CROISEMENT de deux génomes.
 *
 * Le plan de corps vient entièrement de l'initiateur : mélanger deux
 * morphologies produirait presque toujours un corps non connexe, donc un enfant
 * que le monde refuserait. Ce sont les POIDS DU CERVEAU qui se mêlent — poids
 * par poids, la moitié tirée chez le partenaire quand les deux cerveaux ont la
 * même taille, et un repli sur le parent seul sinon.
 *
 * Autrement dit, deux lignées échangent des comportements, pas des anatomies.
 * C'est la seule forme de brassage qui reste toujours viable sans avoir à
 * réparer l'enfant après coup.
 */
export function crossover(initiator: Genome, partner: Genome, seed: number): Genome {
  if (partner.hiddenMax !== initiator.hiddenMax) return initiator;
  if (partner.weights.length !== initiator.weights.length) return initiator;

  const weights = new Int16Array(initiator.weights.length);
  for (let k = 0; k < weights.length; k++) {
    const roll = hash32(k, seed, 0x63e0) % 1000;
    weights[k] = roll < CROSSOVER_WEIGHT_SHARE ? partner.weights[k]! : initiator.weights[k]!;
  }
  return {
    body: initiator.body,
    weights,
    hiddenMax: initiator.hiddenMax,
    // Le seuil de reproduction se moyenne : un trait quantitatif, pas un gène
    // qu'on prendrait chez l'un ou chez l'autre.
    reproThreshold: ((initiator.reproThreshold + partner.reproThreshold) / 2) | 0,
  };
}

// ── Mutation ────────────────────────────────────────────────────────────────

/**
 * Copie mutée d'un génome. Déterministe : la graine est dérivée par hachage de
 * (parent, tick, graine du monde), donc pas d'état global et un rejeu exact.
 */
export function mutate(parent: Genome, seed: number): Genome {
  const rng = new SeededRng(seed === 0 ? 1 : seed);
  const src = parent.body;
  const n = src.type.length;

  // Trois mutations morphologiques possibles, mutuellement exclusives.
  const roll = rng.below(100);
  let dx: Int8Array;
  let dy: Int8Array;
  let dz: Int8Array;
  let type: Uint8Array;

  if (roll < 18 && n < MAX_BODY_VOXELS) {
    // AJOUT d'un voxel accroché à un voxel existant.
    dx = new Int8Array(n + 1);
    dy = new Int8Array(n + 1);
    dz = new Int8Array(n + 1);
    type = new Uint8Array(n + 1);
    dx.set(src.dx);
    dy.set(src.dy);
    dz.set(src.dz);
    type.set(src.type);
    let ok = false;
    for (let attempt = 0; attempt < 12 && !ok; attempt++) {
      const anchor = rng.below(n);
      const d = rng.below(6);
      const ox = src.dx[anchor]! + (d === 0 ? 1 : d === 1 ? -1 : 0);
      const oy = src.dy[anchor]! + (d === 2 ? 1 : d === 3 ? -1 : 0);
      const oz = src.dz[anchor]! + (d === 4 ? 1 : d === 5 ? -1 : 0);
      if (oy < 0 || oy > 8 || Math.abs(ox) > 8 || Math.abs(oz) > 8) continue;
      let taken = false;
      for (let k = 0; k < n && !taken; k++) {
        if (src.dx[k] === ox && src.dy[k] === oy && src.dz[k] === oz) taken = true;
      }
      if (taken) continue;
      dx[n] = ox;
      dy[n] = oy;
      dz[n] = oz;
      type[n] = TISSUE_CHOICES[rng.below(TISSUE_CHOICES.length)]!;
      ok = true;
    }
    if (!ok) {
      // Aucune place libre : on retombe sur une copie stricte du corps.
      dx = Int8Array.from(src.dx);
      dy = Int8Array.from(src.dy);
      dz = Int8Array.from(src.dz);
      type = Uint8Array.from(src.type);
    }
  } else if (roll < 30 && n > 3) {
    // RETRAIT d'un voxel (jamais le germe, jamais la dernière bouche).
    const victim = 1 + rng.below(n - 1);
    const keep = src.type[victim] !== MOUTH || countType(src, MOUTH) > 1;
    const m = keep ? n - 1 : n;
    dx = new Int8Array(m);
    dy = new Int8Array(m);
    dz = new Int8Array(m);
    type = new Uint8Array(m);
    let w = 0;
    for (let k = 0; k < n; k++) {
      if (keep && k === victim) continue;
      dx[w] = src.dx[k]!;
      dy[w] = src.dy[k]!;
      dz[w] = src.dz[k]!;
      type[w] = src.type[k]!;
      w++;
    }
  } else {
    // CHANGEMENT de type d'un voxel (le germe reste de l'os).
    dx = Int8Array.from(src.dx);
    dy = Int8Array.from(src.dy);
    dz = Int8Array.from(src.dz);
    type = Uint8Array.from(src.type);
    if (roll < 62 && n > 1) {
      const k = 1 + rng.below(n - 1);
      type[k] = TISSUE_CHOICES[rng.below(TISSUE_CHOICES.length)]!;
    }
  }

  let body: BodyPlan = { dx, dy, dz, type };
  // Un retrait peut DÉTACHER un voxel qui ne tenait que par celui qu'on
  // supprime : le plan devient impoussable et le monde commun refuserait
  // l'enfant. Dans ce cas la mutation morphologique est abandonnée et seul le
  // cerveau dérive — mieux vaut un enfant identique qu'un enfant impossible.
  if (!isGrowablePlan(body)) {
    body = {
      dx: Int8Array.from(src.dx),
      dy: Int8Array.from(src.dy),
      dz: Int8Array.from(src.dz),
      type: Uint8Array.from(src.type),
    };
  }
  const hiddenMax = planNeurons(body);
  const wanted = weightCount(hiddenMax);
  const weights = new Int16Array(wanted);
  // On reprend les poids du parent tant qu'ils existent ; le reste est tiré.
  for (let k = 0; k < wanted; k++) {
    weights[k] =
      k < parent.weights.length ? parent.weights[k]! : rng.range(-FP_ONE >> 2, FP_ONE >> 2);
  }
  // Dérive de quelques poids : c'est l'apprentissage par sélection.
  const drifts = 1 + rng.below(6);
  for (let d = 0; d < drifts; d++) {
    const k = rng.below(wanted);
    const delta = rng.range(-FP_ONE >> 3, FP_ONE >> 3);
    let v = weights[k]! + delta;
    if (v > 32000) v = 32000;
    if (v < -32000) v = -32000;
    weights[k] = v;
  }

  let repro = parent.reproThreshold + rng.range(-40, 40);
  if (repro < 250) repro = 250;
  if (repro > 950) repro = 950;

  return { body, weights, hiddenMax, reproThreshold: repro };
}

/** Chaque voxel (sauf le germe) doit toucher un voxel de rang inférieur. */
function isGrowablePlan(body: BodyPlan): boolean {
  const n = body.type.length;
  if (n === 0) return false;
  if (body.dx[0] !== 0 || body.dy[0] !== 0 || body.dz[0] !== 0) return false;
  for (let k = 1; k < n; k++) {
    let touches = false;
    for (let j = 0; j < k && !touches; j++) {
      const d =
        Math.abs(body.dx[k]! - body.dx[j]!) +
        Math.abs(body.dy[k]! - body.dy[j]!) +
        Math.abs(body.dz[k]! - body.dz[j]!);
      if (d === 1) touches = true;
    }
    if (!touches) return false;
  }
  return true;
}

function countType(body: BodyPlan, t: number): number {
  let n = 0;
  for (let k = 0; k < body.type.length; k++) if (body.type[k] === t) n++;
  return n;
}

/** Graine de mutation, dérivée sans état global (rejeu exact garanti). */
export function mutationSeed(parentId: number, tick: number, worldSeed: number): number {
  return hash32(parentId, tick, worldSeed ^ 0xbeef) | 1;
}

// ── Validation (utilisée par le serveur avant de relâcher un génome) ─────────

export interface GenomeRejection {
  reason: string;
}

/**
 * Un génome venu d'un client est du contenu non fiable. On ne cherche PAS à
 * prouver qu'il a été obtenu par évolution — dans le monde, la créature paiera
 * le coût métabolique de son corps. On vérifie seulement qu'il est légal.
 */
export function validateGenome(g: Genome): GenomeRejection | null {
  const body = g.body;
  const n = body.type.length;
  if (n < 1) return { reason: "corps vide" };
  if (n > MAX_BODY_VOXELS) return { reason: `corps de ${n} voxels (max ${MAX_BODY_VOXELS})` };
  if (body.dx.length !== n || body.dy.length !== n || body.dz.length !== n) {
    return { reason: "plan de corps incohérent" };
  }
  if (body.dx[0] !== 0 || body.dy[0] !== 0 || body.dz[0] !== 0) {
    return { reason: "le germe doit être à l'offset (0,0,0)" };
  }
  for (let k = 0; k < n; k++) {
    const t = body.type[k]!;
    if (t < TISSUE_MIN || t > NEURON) return { reason: `type de voxel illégal : ${t}` };
  }
  const neurons = countType(body, NEURON);
  if (neurons > MAX_NEURON_VOXELS) {
    return { reason: `${neurons} neurones (max ${MAX_NEURON_VOXELS})` };
  }
  // Doublons interdits : deux voxels au même endroit.
  for (let k = 0; k < n; k++) {
    for (let j = k + 1; j < n; j++) {
      if (body.dx[k] === body.dx[j] && body.dy[k] === body.dy[j] && body.dz[k] === body.dz[j]) {
        return { reason: "deux voxels au même offset" };
      }
    }
  }
  // Connexité dans l'ordre de croissance : sinon le corps ne peut pas pousser.
  for (let k = 1; k < n; k++) {
    let touches = false;
    for (let j = 0; j < k && !touches; j++) {
      const d =
        Math.abs(body.dx[k]! - body.dx[j]!) +
        Math.abs(body.dy[k]! - body.dy[j]!) +
        Math.abs(body.dz[k]! - body.dz[j]!);
      if (d === 1) touches = true;
    }
    if (!touches) return { reason: `voxel ${k} détaché du reste du corps` };
  }
  if (g.hiddenMax !== planNeurons(body)) {
    return { reason: "taille de cerveau incohérente avec le corps" };
  }
  if (g.weights.length !== weightCount(g.hiddenMax)) {
    return { reason: "nombre de poids incohérent avec le cerveau" };
  }
  if (g.reproThreshold < 1 || g.reproThreshold > 1000) {
    return { reason: "seuil de reproduction hors bornes" };
  }
  return null;
}

// ── Sérialisation binaire (réseau + persistance) ─────────────────────────────

/**
 * "DGV2". Incrémenté quand l'eau a été retirée du monde : les matériaux ont été
 * renumérotés (l'os passe de 4 à 3, et ainsi de suite), donc un génome écrit
 * avant cette date décrirait un corps fait des mauvais tissus. Mieux vaut le
 * refuser franchement que le lire de travers.
 */
const MAGIC = 0x44475632;

/** Encode un génome en octets. Quelques kilo-octets au plus. */
export function encodeGenome(g: Genome): Uint8Array {
  const n = g.body.type.length;
  const size = 4 + 2 + 2 + 2 + n * 4 + g.weights.length * 2;
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  let o = 0;
  view.setUint32(o, MAGIC);
  o += 4;
  view.setUint16(o, n);
  o += 2;
  view.setUint16(o, g.hiddenMax);
  o += 2;
  view.setUint16(o, g.reproThreshold);
  o += 2;
  for (let k = 0; k < n; k++) {
    view.setInt8(o++, g.body.dx[k]!);
    view.setInt8(o++, g.body.dy[k]!);
    view.setInt8(o++, g.body.dz[k]!);
    view.setUint8(o++, g.body.type[k]!);
  }
  for (let k = 0; k < g.weights.length; k++) {
    view.setInt16(o, g.weights[k]!);
    o += 2;
  }
  return new Uint8Array(buf);
}

/** Décode un génome. Renvoie null si les octets ne sont pas exploitables. */
export function decodeGenome(bytes: Uint8Array): Genome | null {
  if (bytes.byteLength < 10) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== MAGIC) return null;
  const n = view.getUint16(4);
  const hiddenMax = view.getUint16(6);
  const reproThreshold = view.getUint16(8);
  if (n < 1 || n > MAX_BODY_VOXELS) return null;
  const wCount = weightCount(hiddenMax > MAX_NEURON_VOXELS ? MAX_NEURON_VOXELS : hiddenMax);
  if (bytes.byteLength !== 10 + n * 4 + wCount * 2) return null;

  let o = 10;
  const dx = new Int8Array(n);
  const dy = new Int8Array(n);
  const dz = new Int8Array(n);
  const type = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    dx[k] = view.getInt8(o++);
    dy[k] = view.getInt8(o++);
    dz[k] = view.getInt8(o++);
    type[k] = view.getUint8(o++);
  }
  const weights = new Int16Array(wCount);
  for (let k = 0; k < wCount; k++) {
    weights[k] = view.getInt16(o);
    o += 2;
  }
  return { body: { dx, dy, dz, type }, weights, hiddenMax, reproThreshold };
}
