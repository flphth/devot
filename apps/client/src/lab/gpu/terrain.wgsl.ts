/**
 * Port WGSL de la passe terrain (eau + biomasse).
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
 * PÉRIMÈTRE : ce noyau couvre les règles de terrain (chute et étalement de
 * l'eau, évaporation, pousse et décomposition de la biomasse). L'alimentation
 * des bouches et les passes par organisme restent sur le CPU — le test de
 * conformité compare donc un monde SANS organisme, où la passe terrain est la
 * seule à agir.
 */
export const TERRAIN_WGSL = /* wgsl */ `
struct Params {
  sx: u32,
  sy: u32,
  sz: u32,
  tick: u32,
  seed: u32,
  activeTop: u32,
  voxelCount: u32,
  _pad: u32,
};

@group(0) @binding(0) var<storage, read>       matIn  : array<u32>;
@group(0) @binding(1) var<storage, read>       nutIn  : array<u32>;
@group(0) @binding(2) var<storage, read_write> matOut : array<u32>;
@group(0) @binding(3) var<storage, read_write> nutOut : array<u32>;
@group(0) @binding(4) var<uniform>             P      : Params;

const VOID_M    : u32 = 0u;
const WATER_M   : u32 = 1u;
const ROCK_M    : u32 = 2u;
const BIOMASS_M : u32 = 3u;
const TISSUE_MIN_M : u32 = 4u;

const NUTRIENT_FRESH : u32 = 20000u;
const NUTRIENT_DECAY : u32 = 40u;
const WET_CHANCE : u32 = 900u;
const DRY_CHANCE : u32 = 4u;
const EVAP_CHANCE : u32 = 12u;

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

fn canFall(x: i32, y: i32, z: i32) -> bool {
  return y > 0 && matAt(x, y - 1, z) == VOID_M;
}

fn isSupported(x: i32, y: i32, z: i32) -> bool {
  return y == 0 || matAt(x, y - 1, z) != VOID_M;
}

fn latDx(d: u32) -> i32 {
  if (d == 0u) { return 1; }
  if (d == 1u) { return -1; }
  return 0;
}

fn latDz(d: u32) -> i32 {
  if (d == 2u) { return 1; }
  if (d == 3u) { return -1; }
  return 0;
}

fn latOpposite(d: u32) -> u32 {
  if (d == 0u) { return 1u; }
  if (d == 1u) { return 0u; }
  if (d == 2u) { return 3u; }
  return 2u;
}

/** Consentement mutuel : identique à \`sourceGivesTo\`, ordre de test compris. */
fn sourceGivesTo(x: i32, y: i32, z: i32) -> i32 {
  for (var d: u32 = 0u; d < 4u; d = d + 1u) {
    let dx = x + latDx(d);
    let dz = z + latDz(d);
    if (matAt(dx, y, dz) != VOID_M) { continue; }
    if (!isSupported(dx, y, dz)) { continue; }
    if (matAt(dx, y + 1, dz) == WATER_M) { continue; }
    let di = idxOf(dx, y, dz);
    if ((hash32(di, P.tick, P.seed) & 3u) != latOpposite(d)) { continue; }
    return i32(d);
  }
  return -1;
}

fn nextForWater(i: u32, x: i32, y: i32, z: i32) -> u32 {
  if (canFall(x, y, z)) { return VOID_M; }
  if (sourceGivesTo(x, y, z) >= 0) { return VOID_M; }
  if (matAt(x, y + 1, z) == VOID_M &&
      (hash32(i, P.tick, P.seed ^ 1u) & 0xffffu) < EVAP_CHANCE) {
    return VOID_M;
  }
  return WATER_M;
}

fn nextForSupportedVoid(i: u32, x: i32, y: i32, z: i32, below: u32) -> u32 {
  let pick = hash32(i, P.tick, P.seed) & 3u;
  let sx = x + latDx(pick);
  let sz = z + latDz(pick);
  if (matAt(sx, y, sz) == WATER_M && !canFall(sx, y, sz)) {
    let give = sourceGivesTo(sx, y, sz);
    if (give >= 0 && latOpposite(u32(give)) == pick) { return WATER_M; }
  }

  if (below != ROCK_M && below != BIOMASS_M) { return VOID_M; }
  let roll = hash32(i, P.tick, P.seed ^ 2u) & 0xffffu;
  if (roll >= WET_CHANCE) { return VOID_M; }
  // Voisinage à 6 faces, même ordre que NEIGHBOR_D* côté CPU.
  if (matAt(x + 1, y, z) == WATER_M) { return BIOMASS_M; }
  if (matAt(x - 1, y, z) == WATER_M) { return BIOMASS_M; }
  if (matAt(x, y + 1, z) == WATER_M) { return BIOMASS_M; }
  if (matAt(x, y - 1, z) == WATER_M) { return BIOMASS_M; }
  if (matAt(x, y, z + 1) == WATER_M) { return BIOMASS_M; }
  if (matAt(x, y, z - 1) == WATER_M) { return BIOMASS_M; }
  if (roll < DRY_CHANCE) { return BIOMASS_M; }
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

  if (m == WATER_M) {
    matOut[i] = nextForWater(i, x, y, z);
    nutOut[i] = 0u;
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
  let above = select(ROCK_M, matIn[i + ystride], u32(y) + 1u < P.sy);
  if (above == WATER_M) {
    matOut[i] = WATER_M;
    nutOut[i] = 0u;
    return;
  }
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
