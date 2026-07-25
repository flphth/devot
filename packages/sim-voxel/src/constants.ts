/**
 * Constantes du noyau. Aucune dépendance : ce package doit tourner à
 * l'identique dans un worker navigateur et dans le serveur.
 */

// ── Types de voxels ─────────────────────────────────────────────────────────
// L'ordre compte : tout ce qui est >= TISSUE_MIN est du tissu vivant, ce qui
// permet de tester l'appartenance à un organisme sans table de correspondance.
export const VOID = 0;
export const WATER = 1;
export const ROCK = 2;
export const BIOMASS = 3;
export const BONE = 4;
export const MUSCLE = 5;
export const STORAGE = 6;
export const MOUTH = 7;
export const EYE = 8;
export const NEURON = 9;

export const TISSUE_MIN = BONE;
export const MATERIAL_COUNT = 10;

export const MATERIAL_NAMES = [
  "vide",
  "eau",
  "roche",
  "biomasse",
  "os",
  "muscle",
  "réserve",
  "bouche",
  "œil",
  "neurone",
] as const;

// ── Dimensions du monde ─────────────────────────────────────────────────────
export const SX = 128;
export const SY = 32;
export const SZ = 128;
export const VOXEL_COUNT = SX * SY * SZ;

export const CHUNK = 16;
export const CX = SX / CHUNK;
export const CY = SY / CHUNK;
export const CZ = SZ / CHUNK;
export const CHUNK_COUNT = CX * CY * CZ;

// ── Économie : l'énergie est la vie ─────────────────────────────────────────
// Tout est en entiers (virgule fixe) : exact, et identique CPU ↔ GPU.
// 1 unité d'énergie = 1 µ-unité. Un voxel de biomasse « riche » vaut
// NUTRIENT_MAX, soit de quoi entretenir un petit corps quelques dizaines de ticks.
export const NUTRIENT_MAX = 60_000;
export const NUTRIENT_FRESH = 20_000; // biomasse qui vient de pousser
export const NUTRIENT_DECAY = 40; // perte par tick d'une biomasse au sol

/** Coût d'entretien par tick, par type de tissu (µ-unités). */
export const UPKEEP = new Int32Array(MATERIAL_COUNT);
UPKEEP[BONE] = 2;
UPKEEP[MUSCLE] = 6;
UPKEEP[STORAGE] = 3;
UPKEEP[MOUTH] = 4;
UPKEEP[EYE] = 4;
UPKEEP[NEURON] = 8;

/** Surcoût d'une contraction musculaire (P5.1 : piloté par le cerveau). */
export const MUSCLE_CONTRACTION_COST = 30;
/** Surcoût d'une pensée par voxel neurone (P5.1). */
export const NEURON_THINKING_COST = 40;

/** Capacité énergétique : base + apport de chaque voxel réserve. */
export const CAPACITY_BASE = 40_000;
export const CAPACITY_PER_STORAGE = 25_000;

/** Une bouche convertit au plus ceci par tick, avec une perte à la conversion. */
export const MOUTH_INTAKE_PER_TICK = 4_000;
export const MOUTH_EFFICIENCY_NUM = 4;
export const MOUTH_EFFICIENCY_DEN = 5; // 80 % — le reste est dissipé

/** Coût énergétique de faire pousser un voxel de tissu. */
export const GROWTH_COST = 3_000;
/** Un organisme ne pousse que s'il garde cette réserve après le coût. */
export const GROWTH_ENERGY_FLOOR = 12_000;

/** À la mort, l'énergie restante + une part du corps deviennent de la biomasse. */
export const CORPSE_NUTRIENT_PER_VOXEL = 12_000;

// ── Terrain ─────────────────────────────────────────────────────────────────
/** Hauteur du socle rocheux (y < GROUND_Y est de la roche). */
export const GROUND_Y = 4;
/** Probabilité (sur 2^16) qu'un voxel éligible fasse pousser de la biomasse. */
export const BIOMASS_SPAWN_CHANCE = 900;
/** Probabilité (sur 2^16) qu'une flaque d'eau s'évapore. */
export const WATER_EVAPORATION_CHANCE = 12;

// ── Organismes ──────────────────────────────────────────────────────────────
// Largement au-delà de la cible (quelques centaines) ; dimensionne aussi
// bodyList (MAX_ORGANISMS × MAX_BODY_VOXELS entiers), d'où la modération.
export const MAX_ORGANISMS = 2048;
/** 0 est réservé à « aucun propriétaire » dans le tableau owner. */
export const NO_OWNER = 0;

export const ALIVE = 1;
export const DEAD = 0;

/** Bornes de validation d'un plan de corps (reprises par la validation P5.3). */
export const MAX_BODY_VOXELS = 512;
export const MAX_NEURON_VOXELS = 64;
