/**
 * Protocole entre l'interface et le worker de simulation.
 *
 * Le worker ne renvoie JAMAIS la grille entière (524 288 voxels, 500 Ko par
 * image) : il envoie une **liste dérivée** de voxels visibles, dans un
 * ArrayBuffer transféré (donc sans copie). C'est la même discipline que le
 * protocole réseau du monde commun (P5.3), éprouvée ici en local.
 */

export type LabCommand =
  | { type: "init"; seed: number; founders: number }
  | { type: "speed"; ticksPerFrame: number }
  | { type: "pause"; paused: boolean }
  /** Sélection artificielle : protéger, tuer, ou forcer la reproduction. */
  | { type: "protect"; organismId: number; on: boolean }
  | { type: "kill"; organismId: number }
  | { type: "breed"; organismId: number }
  | { type: "inspect"; organismId: number }
  | { type: "exportGenome"; organismId: number }
  | { type: "conformity"; ticks: number };

export interface LabStats {
  tick: number;
  population: number;
  maxGeneration: number;
  avgGeneration: number;
  avgBodyVoxels: number;
  avgNeurons: number;
  avgMouths: number;
  avgMuscles: number;
  avgEyes: number;
  avgIntakeRate: number;
  biomassVoxels: number;
  totalEnergy: number;
  worldHash: number;
  /** Ticks simulés par seconde réelle — mesure l'accélération obtenue. */
  ticksPerSecond: number;
  backend: "cpu" | "webgpu";
  /** Le port WGSL est-il exécutable ici ? (contexte sécurisé + adaptateur) */
  gpuReady: boolean;
}

export interface LabOrganismInfo {
  id: number;
  generation: number;
  energy: number;
  capacity: number;
  bodyVoxels: number;
  neurons: number;
  mouths: number;
  muscles: number;
  eyes: number;
  age: number;
  eaten: number;
  distance: number;
  protected: boolean;
  /** Plan de corps du génome, pour l'inspecteur. */
  planTypes: number[];
  reproThreshold: number;
  weightCount: number;
}

/**
 * Instantané de rendu. `voxels` empaquette chaque voxel visible sur un entier
 * 32 bits : x (7 bits) | z (7 bits) | y (5 bits) | type (4 bits) | selected (1).
 */
export interface LabFrame {
  stats: LabStats;
  voxels: Int32Array;
  /** Positions des organismes vivants, pour les étiquettes et la sélection. */
  organisms: Int32Array; // [id, x, y, z, energyPermille] × n
}

export type LabMessage =
  | { type: "frame"; frame: LabFrame }
  | { type: "inspect"; info: LabOrganismInfo | null }
  | { type: "genome"; organismId: number; bytes: Uint8Array; valid: boolean }
  | { type: "conformity"; result: ConformityResult }
  | { type: "log"; text: string };

export interface ConformityResult {
  ticks: number;
  seed: number;
  cpuHash: number;
  gpuHash: number | null;
  identical: boolean;
  gpuAvailable: boolean;
  detail: string;
}

// ── Empaquetage des voxels ──────────────────────────────────────────────────

/**
 * Un voxel tient dans un entier 32 bits :
 *   x 7 · z 7 · y 5 · matériau 4 · sélectionné 1 · teinte 5 · vigueur 3
 *
 * La TEINTE identifie la créature (dérivée de son identifiant), la VIGUEUR est
 * son énergie sur huit niveaux. Les deux voyagent avec le voxel plutôt que
 * d'être recherchées côté client : chercher à quel organisme appartient chaque
 * voxel coûtait un parcours croisé par image, et faisait tomber le rendu à
 * quelques images par seconde dès que la population montait.
 */
export function packVoxel(
  x: number,
  y: number,
  z: number,
  mat: number,
  selected: boolean,
  tint = 0,
  vigor = 0,
): number {
  return (
    (x & 0x7f) |
    ((z & 0x7f) << 7) |
    ((y & 0x1f) << 14) |
    ((mat & 0xf) << 19) |
    ((selected ? 1 : 0) << 23) |
    ((tint & 0x1f) << 24) |
    ((vigor & 0x7) << 29)
  );
}

export function unpackVoxel(v: number): {
  x: number;
  y: number;
  z: number;
  mat: number;
  selected: boolean;
  tint: number;
  vigor: number;
} {
  return {
    x: v & 0x7f,
    z: (v >> 7) & 0x7f,
    y: (v >> 14) & 0x1f,
    mat: (v >> 19) & 0xf,
    selected: ((v >> 23) & 1) === 1,
    tint: (v >>> 24) & 0x1f,
    vigor: (v >>> 29) & 0x7,
  };
}

/** Vitesses proposées par l'interface : de l'observation au x1000. */
export const SPEED_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000] as const;
