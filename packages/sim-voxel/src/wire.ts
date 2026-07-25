import { CHUNK, CX, CY, CZ, MAX_BODY_VOXELS, SX, SY, SZ, TISSUE_MIN } from "./constants.js";
import type { VoxelWorld } from "./world.js";

/**
 * PROTOCOLE DÉRIVÉ — le client ne reçoit JAMAIS le monde.
 *
 * Le monde commun fait 524 288 voxels. L'envoyer, même une fois, même compressé,
 * serait absurde : ce que le client doit dessiner tient dans une fraction de
 * cela, et l'essentiel ne change jamais. On n'envoie donc que trois choses, et
 * chacune a sa raison d'être dans un format différent :
 *
 * 1. des CHUNKS de terrain (palette + RLE), seulement s'ils ont changé ET sont
 *    visibles. Un chunk d'air pur tient en quatre octets ;
 * 2. un DESCRIPTEUR DE CORPS par organisme, envoyé UNE FOIS — puis plus rien
 *    tant que la morphologie ne change pas. Le client remaille lui-même ;
 * 3. l'état par tick des organismes, qui passe par `@colyseus/schema` : ce sont
 *    des entités, elles ont un cycle de vie, et le moteur n'envoie que les
 *    deltas.
 *
 * Encodage et décodage vivent ici, dans le noyau, pour la même raison que le
 * génome (§4.5 d'ARCHITECTURE) : deux implémentations qui divergent d'un octet
 * feraient dessiner au client un monde qui n'existe pas.
 */

/** Nombre de voxels dans un chunk cubique. */
export const CHUNK_VOLUME = CHUNK * CHUNK * CHUNK;

/** Version de format. Un client plus ancien doit refuser, pas deviner. */
export const WIRE_VERSION = 1;

// ── Chunks de terrain ───────────────────────────────────────────────────────

/**
 * Encode un chunk en palette + RLE.
 *
 * Disposition : `[version][cx][cy][cz][taille palette][palette…][runs…]`, chaque
 * run étant `[index palette (u8)][longueur (u16 LE)]`. Le parcours suit l'ordre
 * y, z, x — le même que la grille — pour que les runs épousent les couches
 * horizontales, qui sont ce que le terrain a de plus uniforme.
 *
 * Les tissus vivants sont volontairement écrasés en VIDE : les corps voyagent
 * par leur descripteur, pas par le terrain. Sans cela, un organisme qui bouge
 * invaliderait son chunk à chaque tick et ferait exploser le débit.
 */
export function encodeChunk(w: VoxelWorld, cx: number, cy: number, cz: number): Uint8Array {
  const palette: number[] = [];
  const paletteIndex = new Map<number, number>();
  // Pire cas : un run par voxel. On alloue large puis on tronque.
  const out = new Uint8Array(5 + 8 + CHUNK_VOLUME * 3);
  let p = 0;
  out[p++] = WIRE_VERSION;
  out[p++] = cx;
  out[p++] = cy;
  out[p++] = cz;
  const paletteLenAt = p++;

  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const z0 = cz * CHUNK;

  let runMat = -1;
  let runLen = 0;
  const flush = () => {
    if (runLen === 0) return;
    let idx = paletteIndex.get(runMat);
    if (idx === undefined) {
      idx = palette.length;
      palette.push(runMat);
      paletteIndex.set(runMat, idx);
    }
    out[p++] = idx;
    out[p++] = runLen & 0xff;
    out[p++] = (runLen >> 8) & 0xff;
    runLen = 0;
  };

  for (let y = y0; y < y0 + CHUNK; y++) {
    for (let z = z0; z < z0 + CHUNK; z++) {
      for (let x = x0; x < x0 + CHUNK; x++) {
        const raw = w.material[w.idx(x, y, z)]!;
        const m = raw >= TISSUE_MIN ? 0 : raw;
        if (m !== runMat) {
          flush();
          runMat = m;
        }
        runLen++;
      }
    }
  }
  flush();

  // La palette s'écrit après coup : on ne la connaît qu'une fois le chunk lu.
  const runsLen = p - 5;
  const body = out.slice(5, 5 + runsLen);
  const result = new Uint8Array(5 + palette.length + runsLen);
  result.set(out.subarray(0, 5));
  result[paletteLenAt] = palette.length;
  for (let k = 0; k < palette.length; k++) result[5 + k] = palette[k]!;
  result.set(body, 5 + palette.length);
  return result;
}

export interface DecodedChunk {
  cx: number;
  cy: number;
  cz: number;
  /** Matériaux du chunk, dans l'ordre y, z, x. */
  materials: Uint8Array;
}

/** Décode un chunk. Refuse une version inconnue plutôt que de deviner. */
export function decodeChunk(bytes: Uint8Array): DecodedChunk {
  if (bytes[0] !== WIRE_VERSION) {
    throw new Error(`chunk de version ${bytes[0]}, attendu ${WIRE_VERSION}`);
  }
  const cx = bytes[1]!;
  const cy = bytes[2]!;
  const cz = bytes[3]!;
  const paletteLen = bytes[4]!;
  const palette = bytes.subarray(5, 5 + paletteLen);

  const materials = new Uint8Array(CHUNK_VOLUME);
  let at = 0;
  for (let p = 5 + paletteLen; p < bytes.length; p += 3) {
    const mat = palette[bytes[p]!]!;
    const len = bytes[p + 1]! | (bytes[p + 2]! << 8);
    materials.fill(mat, at, at + len);
    at += len;
  }
  if (at !== CHUNK_VOLUME) {
    throw new Error(`chunk incomplet : ${at} voxels décodés sur ${CHUNK_VOLUME}`);
  }
  return { cx, cy, cz, materials };
}

/** Index linéaire d'un chunk, même ordre que `chunkVersion` du monde. */
export function chunkIndex(cx: number, cy: number, cz: number): number {
  return (cy * CZ + cz) * CX + cx;
}

export function chunkCoords(index: number): { cx: number; cy: number; cz: number } {
  const cx = index % CX;
  const cz = ((index / CX) | 0) % CZ;
  const cy = (index / (CX * CZ)) | 0;
  return { cx, cy, cz };
}

// ── Descripteur de corps ────────────────────────────────────────────────────

/**
 * Le corps d'un organisme, envoyé UNE FOIS puis seulement à chaque changement de
 * morphologie : `[version][id u16][x u8][y u8][z u8][nb voxels u16]` puis, par
 * voxel, `[dx i8][dy i8][dz i8][matériau u8]` — des décalages relatifs au germe.
 *
 * Un corps de dix voxels tient donc en 49 octets. C'est ce qui permet à l'état
 * par tick de se réduire à une poignée d'octets : la forme est déjà connue.
 */
export function encodeBody(w: VoxelWorld, id: number): Uint8Array {
  const seed = w.seedIdx[id]!;
  const sx = w.xOf(seed);
  const sy = w.yOf(seed);
  const sz = w.zOf(seed);
  const base = w.bodySlot(id);
  const len = w.bodyLen[id]!;

  const out = new Uint8Array(9 + len * 4);
  let p = 0;
  out[p++] = WIRE_VERSION;
  out[p++] = id & 0xff;
  out[p++] = (id >> 8) & 0xff;
  out[p++] = sx;
  out[p++] = sy;
  out[p++] = sz;
  out[p++] = len & 0xff;
  out[p++] = (len >> 8) & 0xff;
  out[p++] = 0; // réservé : alignement sur 4 octets pour la suite

  for (let k = 0; k < len; k++) {
    const i = w.bodyList[base + k]!;
    out[p++] = (w.xOf(i) - sx) & 0xff; // i8 en complément à deux
    out[p++] = (w.yOf(i) - sy) & 0xff;
    out[p++] = (w.zOf(i) - sz) & 0xff;
    out[p++] = w.material[i]!;
  }
  return out;
}

export interface DecodedBody {
  id: number;
  /** Position du germe, en voxels du monde. */
  x: number;
  y: number;
  z: number;
  /** Décalages relatifs au germe, et matériau, par voxel. */
  dx: Int8Array;
  dy: Int8Array;
  dz: Int8Array;
  mat: Uint8Array;
}

export function decodeBody(bytes: Uint8Array): DecodedBody {
  if (bytes[0] !== WIRE_VERSION) {
    throw new Error(`corps de version ${bytes[0]}, attendu ${WIRE_VERSION}`);
  }
  const id = bytes[1]! | (bytes[2]! << 8);
  const x = bytes[3]!;
  const y = bytes[4]!;
  const z = bytes[5]!;
  const len = bytes[6]! | (bytes[7]! << 8);
  if (len > MAX_BODY_VOXELS) throw new Error(`corps de ${len} voxels : hors bornes`);

  const dx = new Int8Array(len);
  const dy = new Int8Array(len);
  const dz = new Int8Array(len);
  const mat = new Uint8Array(len);
  for (let k = 0; k < len; k++) {
    const p = 9 + k * 4;
    dx[k] = (bytes[p]! << 24) >> 24;
    dy[k] = (bytes[p + 1]! << 24) >> 24;
    dz[k] = (bytes[p + 2]! << 24) >> 24;
    mat[k] = bytes[p + 3]!;
  }
  return { id, x, y, z, dx, dy, dz, mat };
}

// ── Brouillard de guerre, côté serveur ──────────────────────────────────────

/**
 * Rayon de vue, en voxels. Le serveur ne transmet rien au-delà : ce n'est pas
 * un effet visuel qu'un client pourrait désactiver, c'est ce qu'il ne reçoit
 * pas. Seule façon d'en faire une vraie mesure anti-triche.
 */
export const VIEW_RADIUS = 40;

/** Un chunk est-il dans le champ de vision d'un observateur ? */
export function chunkVisible(
  cx: number,
  cy: number,
  cz: number,
  eyeX: number,
  eyeZ: number,
  radius = VIEW_RADIUS,
): boolean {
  // Distance horizontale du point le plus proche du chunk : la hauteur n'entre
  // pas en compte, le monde n'a que deux chunks d'épaisseur.
  void cy;
  const nx = clamp(eyeX, cx * CHUNK, cx * CHUNK + CHUNK - 1);
  const nz = clamp(eyeZ, cz * CHUNK, cz * CHUNK + CHUNK - 1);
  const dx = eyeX - nx;
  const dz = eyeZ - nz;
  return dx * dx + dz * dz <= radius * radius;
}

/** Un point du monde est-il visible depuis (eyeX, eyeZ) ? */
export function pointVisible(
  x: number,
  z: number,
  eyeX: number,
  eyeZ: number,
  radius = VIEW_RADIUS,
): boolean {
  const dx = x - eyeX;
  const dz = z - eyeZ;
  return dx * dx + dz * dz <= radius * radius;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Bornes du monde, exportées pour que le client cadre sans les recalculer. */
export const WORLD_DIMS = { sx: SX, sy: SY, sz: SZ, cx: CX, cy: CY, cz: CZ, chunk: CHUNK };
