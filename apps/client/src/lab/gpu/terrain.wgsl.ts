/**
 * Port WGSL de la passe terrain (colonisation et décomposition de la biomasse).
 *
 * Chaque ligne a son équivalent exact dans `passes.ts` du noyau. Deux
 * propriétés rendent ce port possible sans dérive :
 *
 * 1. `hash32` est bit à bit identique. En JavaScript `Math.imul` est une
 *    multiplication 32 bits signée ; en WGSL la multiplication sur `u32`
 *    déborde de la même façon. Les décalages `>>>` sur int32 et `>>` sur u32
 *    opèrent sur les mêmes bits. Aucun flottant n'intervient.
 * 2. Toutes les grandeurs sont ENTIÈRES (matériau, nutriment). Un `f32` aurait
 *    divergé : JavaScript calcule en float64 puis arrondit au stockage, le GPU
 *    calcule en float32.
 *
 * Les constantes ne sont PAS recopiées ici : elles sont interpolées depuis
 * `@devot/sim-voxel`. Elles l'étaient auparavant, et elles avaient déjà dérivé
 * en silence (sol sec à 4 côté GPU contre 5 côté CPU) — exactement la panne que
 * le test de conformité doit détecter, mais qu'aucun test ne peut détecter dans
 * un environnement sans WebGPU. Interpoler rend la dérive impossible.
 *
 * PÉRIMÈTRE : ce noyau couvre les règles de terrain (pousse et décomposition de
 * la biomasse). L'alimentation des bouches et les passes par organisme restent
 * sur le CPU — le test de conformité compare donc un monde SANS organisme, où la
 * passe terrain est la seule à agir.
 */
import {
  BIOMASS_CROWDING_MAX,
  BIOMASS_SPAWN_CHANCE,
  BIOMASS_SPAWN_CHANCE_SEED,
  NUTRIENT_DECAY as CORE_NUTRIENT_DECAY,
  NUTRIENT_FRESH as CORE_NUTRIENT_FRESH,
  BIOMASS as CORE_BIOMASS,
  ROCK as CORE_ROCK,
  TISSUE_MIN as CORE_TISSUE_MIN,
  VOID as CORE_VOID,
} from "@devot/sim-voxel";

export const TERRAIN_WGSL = /* wgsl */ `
struct Params {
  sx: u32,
  sy: u32,
  sz: u32,
  tick: u32,
  seed: u32,
  activeTop: u32,
  voxelCount: u32,
  /** Altitude au-dessus de laquelle plus rien ne pousse, propre au monde. */
  fertileMaxY: u32,
};

@group(0) @binding(0) var<storage, read>       matIn  : array<u32>;
@group(0) @binding(1) var<storage, read>       nutIn  : array<u32>;
@group(0) @binding(2) var<storage, read_write> matOut : array<u32>;
@group(0) @binding(3) var<storage, read_write> nutOut : array<u32>;
@group(0) @binding(4) var<uniform>             P      : Params;

// Interpolés depuis le noyau, comme les probabilités : recopier des numéros de
// matériaux à la main est exactement ce qui avait déjà dérivé en silence.
const VOID_M    : u32 = ${CORE_VOID}u;
const ROCK_M    : u32 = ${CORE_ROCK}u;
const BIOMASS_M : u32 = ${CORE_BIOMASS}u;
const TISSUE_MIN_M : u32 = ${CORE_TISSUE_MIN}u;

const NUTRIENT_FRESH : u32 = ${CORE_NUTRIENT_FRESH}u;
const NUTRIENT_DECAY : u32 = ${CORE_NUTRIENT_DECAY}u;
const GROW_CHANCE : u32 = ${BIOMASS_SPAWN_CHANCE}u;
const SEED_CHANCE : u32 = ${BIOMASS_SPAWN_CHANCE_SEED}u;
const CROWDING_MAX : u32 = ${BIOMASS_CROWDING_MAX}u;

fn hash32(a: u32, b: u32, c: u32) -> u32 {
  var h: u32 = a ^ (b * 0x9e3779b1u);
  h = h ^ (c * 0x85ebca6bu);
  h = h ^ (h >> 16u);
  h = h * 0x7feb352du;
  h = h ^ (h >> 15u);
  h = h * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return h;
}

fn idxOf(x: i32, y: i32, z: i32) -> u32 {
  return u32((y * i32(P.sz) + z) * i32(P.sx) + x);
}

/** Hors du monde = solide, exactement comme \`matAt\` côté CPU. */
fn matAt(x: i32, y: i32, z: i32) -> u32 {
  if (x < 0 || x >= i32(P.sx) || y < 0 || y >= i32(P.sy) || z < 0 || z >= i32(P.sz)) {
    return ROCK_M;
  }
  return matIn[idxOf(x, y, z)];
}

// Voisinage à 6 faces, même ordre que NEIGHBOR_DX/DY/DZ du noyau.
fn neighborDx(d: i32) -> i32 {
  if (d == 0) { return 1; }
  if (d == 1) { return -1; }
  return 0;
}

fn neighborDy(d: i32) -> i32 {
  if (d == 2) { return 1; }
  if (d == 3) { return -1; }
  return 0;
}

fn neighborDz(d: i32) -> i32 {
  if (d == 4) { return 1; }
  if (d == 5) { return -1; }
  return 0;
}

fn nextForSupportedVoid(i: u32, x: i32, y: i32, z: i32, below: u32) -> u32 {
  if (below != ROCK_M && below != BIOMASS_M) { return VOID_M; }
  // Les hauteurs sont stériles : seules les terres basses portent la végétation.
  if (u32(y) > P.fertileMaxY) { return VOID_M; }
  let roll = hash32(i, P.tick, P.seed ^ 2u) & 0xffffu;
  if (roll >= GROW_CHANCE) { return VOID_M; }

  // La biomasse COLONISE : il lui faut une voisine, mais pas trop. Voisinage à
  // 6 faces, même ordre que NEIGHBOR_D* côté CPU.
  var neighbours : u32 = 0u;
  if (below == BIOMASS_M) { neighbours = 1u; }
  for (var d: i32 = 0; d < 6; d = d + 1) {
    if (matAt(x + neighborDx(d), y + neighborDy(d), z + neighborDz(d)) == BIOMASS_M) {
      neighbours = neighbours + 1u;
    }
  }
  if (neighbours > 0u && neighbours <= CROWDING_MAX) { return BIOMASS_M; }
  if (neighbours > CROWDING_MAX) { return VOID_M; }
  if (roll < SEED_CHANCE) { return BIOMASS_M; }
  return VOID_M;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= P.voxelCount) { return; }

  let ystride = P.sx * P.sz;
  let y = i32(i / ystride);
  let rem = i % ystride;
  let z = i32(rem / P.sx);
  let x = i32(rem % P.sx);

  // Au-dessus de la borne active, le CPU remplit de vide par memset.
  if (u32(y) > P.activeTop) {
    matOut[i] = VOID_M;
    nutOut[i] = 0u;
    return;
  }

  let m = matIn[i];

  if (m >= TISSUE_MIN_M || m == ROCK_M) {
    matOut[i] = m;
    nutOut[i] = nutIn[i];
    return;
  }

  if (m == BIOMASS_M) {
    // Aucune bouche dans le monde de conformité : seule la décomposition agit.
    let remaining = nutIn[i];
    if (remaining <= NUTRIENT_DECAY) {
      matOut[i] = VOID_M;
      nutOut[i] = 0u;
    } else {
      matOut[i] = BIOMASS_M;
      nutOut[i] = remaining - NUTRIENT_DECAY;
    }
    return;
  }

  // m == VOID
  let below = select(ROCK_M, matIn[i - ystride], y > 0);
  if (below == VOID_M) {
    matOut[i] = VOID_M;
    nutOut[i] = 0u;
    return;
  }

  let next = nextForSupportedVoid(i, x, y, z, below);
  matOut[i] = next;
  nutOut[i] = select(0u, NUTRIENT_FRESH, next == BIOMASS_M);
}
`;
