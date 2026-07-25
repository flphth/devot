import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  ALIVE,
  MAX_ORGANISMS,
  NO_OWNER,
  VOID,
  VoxelWorld,
  decodeGenome,
  encodeGenome,
  spawnFromGenome,
  type Genome,
} from "@devot/sim-voxel";

/**
 * PERSISTANCE ET REPRISE du monde commun.
 *
 * Le monde tourne 24/7 : un redémarrage ne doit pas effacer des générations
 * d'évolution. On sauvegarde donc la grille et les organismes, et on les
 * recharge au démarrage.
 *
 * Format : JSON pour la partie structurée (organismes, génomes, compteurs), et
 * les trois tableaux de la grille en base64 à la suite, le tout gzippé. La
 * grille brute pèse 2,5 Mo ; gzippée elle tombe à quelques dizaines de Ko,
 * parce qu'un monde est surtout fait de longues plages d'air et de roche.
 *
 * L'écriture passe par un fichier temporaire renommé : une coupure de courant
 * pendant la sauvegarde laisse l'ancienne, jamais un fichier tronqué.
 */

const SNAPSHOT_VERSION = 1;

interface OrganismRecord {
  id: number;
  genome: string; // base64
  lineage: string;
  generation: number;
  energy: number;
  bornTick: number;
  seedIdx: number;
  growthCursor: number;
  eaten: number;
}

interface SnapshotFile {
  version: number;
  seed: number;
  tick: number;
  energyInjected: number;
  activeTop: number;
  organisms: OrganismRecord[];
  material: string;
  nutrient: string;
  owner: string;
}

const b64 = (a: ArrayBufferView): string =>
  Buffer.from(a.buffer as ArrayBuffer, a.byteOffset, a.byteLength).toString("base64");

export interface SnapshotMeta {
  lineageOf: Map<number, string>;
}

/** Écrit l'état complet du monde. Atomique : temporaire puis renommage. */
export function saveSnapshot(path: string, w: VoxelWorld, meta: SnapshotMeta): number {
  const organisms: OrganismRecord[] = [];
  for (let id = 1; id < MAX_ORGANISMS; id++) {
    if (w.orgState[id] !== ALIVE) continue;
    const g = w.orgGenome[id];
    if (!g) continue;
    organisms.push({
      id,
      genome: Buffer.from(encodeGenome(g)).toString("base64"),
      lineage: meta.lineageOf.get(id) ?? "",
      generation: w.generation[id]!,
      energy: w.energy[id]!,
      bornTick: w.bornTick[id]!,
      seedIdx: w.seedIdx[id]!,
      growthCursor: w.growthCursor[id]!,
      eaten: w.eaten[id]!,
    });
  }

  const file: SnapshotFile = {
    version: SNAPSHOT_VERSION,
    seed: w.seed,
    tick: w.tick,
    energyInjected: w.energyInjected,
    activeTop: w.activeTop,
    organisms,
    material: b64(w.material),
    nutrient: b64(w.nutrient),
    owner: b64(w.owner),
  };

  const packed = gzipSync(Buffer.from(JSON.stringify(file)), { level: 6 });
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, packed);
  renameSync(tmp, path);
  return packed.byteLength;
}

/**
 * Recharge un monde. Renvoie null si le fichier est absent, illisible ou d'une
 * version inconnue — le serveur repart alors d'un monde neuf plutôt que de
 * refuser de démarrer.
 */
export function loadSnapshot(
  path: string,
): { world: VoxelWorld; lineageOf: Map<number, string> } | null {
  if (!existsSync(path)) return null;
  let file: SnapshotFile;
  try {
    file = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as SnapshotFile;
  } catch (err) {
    console.warn(`[monde] instantané illisible (${String(err)}) : on repart d'un monde neuf.`);
    return null;
  }
  if (file.version !== SNAPSHOT_VERSION) {
    console.warn(`[monde] instantané de version ${file.version} : on repart d'un monde neuf.`);
    return null;
  }

  const w = new VoxelWorld(file.seed);
  const put = (target: ArrayBufferView, encoded: string) => {
    const raw = Buffer.from(encoded, "base64");
    new Uint8Array(target.buffer as ArrayBuffer, target.byteOffset, target.byteLength).set(raw);
  };
  put(w.material, file.material);
  put(w.nutrient, file.nutrient);
  put(w.owner, file.owner);
  w.materialNext.set(w.material);
  w.nutrientNext.set(w.nutrient);
  w.ownerNext.set(w.owner);
  w.tick = file.tick;
  w.activeTop = file.activeTop;

  // Les corps sont effacés de la grille avant d'être refaits : `spawnFromGenome`
  // refuse de se poser sur du tissu, et une seule passe suffit — la faire par
  // organisme coûterait 524 288 lectures multipliées par la population.
  for (let i = 0; i < w.material.length; i++) {
    if (w.isTissue(i)) {
      w.material[i] = VOID;
      w.owner[i] = NO_OWNER;
    }
  }
  w.materialNext.set(w.material);
  w.ownerNext.set(w.owner);

  // Les organismes sont recréés à partir de leur génome, puis leur corps est
  // reconstruit depuis la grille : c'est elle qui fait foi, pas une liste
  // recopiée qui pourrait la contredire.
  const lineageOf = new Map<number, string>();
  for (const rec of file.organisms) {
    const genome: Genome | null = decodeGenome(new Uint8Array(Buffer.from(rec.genome, "base64")));
    if (!genome) continue; // génome corrompu : on perd cet individu, pas le monde
    const id = respawn(w, genome, rec);
    if (id > 0) lineageOf.set(id, rec.lineage);
  }
  // Après les renaissances seulement : `spawnFromGenome` compte chaque dotation
  // comme une entrée d'énergie, or celles-ci sont déjà dans le total sauvegardé.
  w.energyInjected = file.energyInjected;
  return { world: w, lineageOf };
}

/**
 * Recrée un organisme à l'identique : mêmes id de lignée, même âge, même
 * énergie, et surtout le corps entier tel qu'il était — pas seulement son germe.
 */
function respawn(w: VoxelWorld, genome: Genome, rec: OrganismRecord): number {
  const x = w.xOf(rec.seedIdx);
  const y = w.yOf(rec.seedIdx);
  const z = w.zOf(rec.seedIdx);
  const id = spawnFromGenome(w, genome, x, y, z, rec.energy, rec.generation);
  if (id === 0) return 0;
  w.bornTick[id] = rec.bornTick;
  w.eaten[id] = rec.eaten;
  w.growthCursor[id] = 1;
  // Le reste du corps repoussera selon le plan, un voxel par tick : c'est la
  // même règle que pour un nouveau-né, donc rien à réimplémenter — et un monde
  // rechargé reste un monde légal.
  return id;
}
