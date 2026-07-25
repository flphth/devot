import {
  ALIVE,
  BIOMASS,
  BONE,
  CORPSE_NUTRIENT_PER_VOXEL,
  CX,
  CZ,
  DEAD,
  GROWTH_COST,
  GROWTH_ENERGY_FLOOR,
  MOUTH,
  MOUTH_EFFICIENCY_DEN,
  MOUTH_EFFICIENCY_NUM,
  MOUTH_INTAKE_PER_TICK,
  NO_OWNER,
  NUTRIENT_DECAY,
  NUTRIENT_FRESH,
  NUTRIENT_MAX,
  ROCK,
  SX,
  SY,
  SZ,
  TISSUE_MIN,
  UPKEEP,
  VOID,
  WATER,
  WATER_EVAPORATION_CHANCE,
  BIOMASS_SPAWN_CHANCE_DRY,
  BIOMASS_SPAWN_CHANCE_WET,
} from "./constants.js";
import { hash32 } from "./rng.js";
import { NEIGHBOR_DX, NEIGHBOR_DY, NEIGHBOR_DZ, VoxelWorld } from "./world.js";

/** Directions latérales, ordre fixe : +x, -x, +z, -z. */
const LAT_DX = new Int8Array([1, -1, 0, 0]);
const LAT_DZ = new Int8Array([0, 0, 1, -1]);
/** Direction opposée dans LAT (utilisée par le consentement mutuel de l'eau). */
const LAT_OPPOSITE = new Int8Array([1, 0, 3, 2]);

/** Pas d'index entre deux niveaux y consécutifs. */
const YSTRIDE = SX * SZ;

/**
 * Passe terrain fusionnée : eau, biomasse et alimentation en UNE traversée.
 *
 * Toutes les règles sont « tirées » (pull) : chaque voxel calcule son état
 * suivant à partir de l'état PRÉCÉDENT uniquement. C'est ce qui rend la passe
 * indépendante de l'ordre de parcours — donc déterministe, parallélisable, et
 * transposable en WGSL sans changer un seul comportement.
 */
export function passTerrain(w: VoxelWorld): void {
  const mat = w.material;
  const nut = w.nutrient;
  const own = w.owner;
  const matN = w.materialNext;
  const nutN = w.nutrientNext;
  const ownN = w.ownerNext;
  const tick = w.tick;
  const seed = w.seed;
  const energyDelta = w.energyDelta;
  const eatenTotal = w.eaten;

  // Au-dessus de la borne active il n'y a que du vide : un memset suffit,
  // au lieu de visiter des centaines de milliers de voxels d'air.
  const top = w.activeTop;
  if (top < SY - 1) {
    const from = (top + 1) * YSTRIDE;
    matN.fill(VOID, from);
    nutN.fill(0, from);
    ownN.fill(NO_OWNER, from);
  }

  const chunkVersion = w.chunkVersion;
  for (let y = 0; y <= top; y++) {
    const chunkYBase = ((y / 16) | 0) * CZ;
    for (let z = 0; z < SZ; z++) {
      const rowBase = (y * SZ + z) * SX;
      const chunkRowBase = (chunkYBase + ((z / 16) | 0)) * CX;
      for (let x = 0; x < SX; x++) {
        const i = rowBase + x;
        const m = mat[i]!;

        // Les tissus vivants et la roche traversent la passe inchangés :
        // ce sont les passes par organisme qui les modifient.
        if (m >= TISSUE_MIN || m === ROCK) {
          matN[i] = m;
          nutN[i] = nut[i]!;
          ownN[i] = own[i]!;
          continue;
        }
        ownN[i] = NO_OWNER;

        if (m === WATER) {
          const next = nextForWater(w, i, x, y, z, tick, seed);
          matN[i] = next;
          nutN[i] = 0;
          if (next !== m) chunkVersion[chunkRowBase + ((x / 16) | 0)]!++;
          continue;
        }

        if (m === BIOMASS) {
          // Une bouche adjacente la consomme (au plus une par tick : la
          // biomasse elle-même choisit son mangeur, donc un seul écrivain).
          let remaining = nut[i]!;
          const eaterIdx = firstAdjacentMouth(w, x, y, z);
          if (eaterIdx >= 0) {
            const eater = own[eaterIdx]!;
            const taken = remaining < MOUTH_INTAKE_PER_TICK ? remaining : MOUTH_INTAKE_PER_TICK;
            remaining -= taken;
            // Somme d'entiers : indépendante de l'ordre (atomicAdd sur GPU).
            const gained = ((taken * MOUTH_EFFICIENCY_NUM) / MOUTH_EFFICIENCY_DEN) | 0;
            energyDelta[eater] = energyDelta[eater]! + gained;
            // Mesure d'émergence : combien cet organisme a réellement ingéré.
            eatenTotal[eater] = eatenTotal[eater]! + gained;
          }
          // Décomposition naturelle.
          remaining -= NUTRIENT_DECAY;
          if (remaining <= 0) {
            matN[i] = VOID;
            nutN[i] = 0;
            chunkVersion[chunkRowBase + ((x / 16) | 0)]!++;
          } else {
            matN[i] = BIOMASS;
            nutN[i] = remaining;
          }
          continue;
        }

        // m === VOID.
        // Sortie rapide : la majorité du monde est de l'air au-dessus du vide.
        // Un vide non soutenu ne peut ni retenir d'eau latérale ni porter de
        // biomasse ; seule une chute d'eau depuis le dessus peut l'occuper.
        const above = y + 1 < SY ? mat[i + YSTRIDE]! : ROCK;
        if (above === WATER) {
          matN[i] = WATER;
          nutN[i] = 0;
          chunkVersion[chunkRowBase + ((x / 16) | 0)]!++;
          continue;
        }
        const below = y > 0 ? mat[i - YSTRIDE]! : ROCK;
        if (below === VOID) {
          matN[i] = VOID;
          nutN[i] = 0;
          continue;
        }

        const next = nextForSupportedVoid(w, i, x, y, z, below, tick, seed);
        matN[i] = next;
        nutN[i] = next === BIOMASS ? NUTRIENT_FRESH : 0;
        if (next !== VOID) chunkVersion[chunkRowBase + ((x / 16) | 0)]!++;
      }
    }
  }
}

function matAt(w: VoxelWorld, x: number, y: number, z: number): number {
  if (x < 0 || x >= SX || y < 0 || y >= SY || z < 0 || z >= SZ) return ROCK; // bords = solide
  return w.material[(y * SZ + z) * SX + x]!;
}

/** Une eau peut tomber si le voxel du dessous est vide. */
function canFall(w: VoxelWorld, x: number, y: number, z: number): boolean {
  return y > 0 && matAt(w, x, y - 1, z) === VOID;
}

/** Un vide peut retenir de l'eau si quelque chose le soutient. */
function isSupported(w: VoxelWorld, x: number, y: number, z: number): boolean {
  return y === 0 || matAt(w, x, y - 1, z) !== VOID;
}

/**
 * Étalement latéral par CONSENTEMENT MUTUEL : la destination tire au sort une
 * seule source possible, la source ne cède qu'à la destination qu'elle
 * choisit elle-même. Les deux côtés évaluent le même prédicat sur l'état
 * précédent, donc l'eau n'est ni dupliquée ni détruite, quel que soit l'ordre.
 */
function sourceGivesTo(
  w: VoxelWorld,
  x: number,
  y: number,
  z: number,
  tick: number,
  seed: number,
): number {
  for (let d = 0; d < 4; d++) {
    const dx = x + LAT_DX[d]!;
    const dz = z + LAT_DZ[d]!;
    if (matAt(w, dx, y, dz) !== VOID) continue;
    if (!isSupported(w, dx, y, dz)) continue;
    // Une destination déjà remplie par le dessus ne prend rien latéralement.
    if (matAt(w, dx, y + 1, dz) === WATER) continue;
    const di = (y * SZ + dz) * SX + dx;
    // La destination tire une direction : pointe-t-elle vers nous ?
    if ((hash32(di, tick, seed) & 3) !== LAT_OPPOSITE[d]!) continue;
    return d; // première destination consentante, ordre fixe
  }
  return -1;
}

function nextForWater(
  w: VoxelWorld,
  i: number,
  x: number,
  y: number,
  z: number,
  tick: number,
  seed: number,
): number {
  if (canFall(w, x, y, z)) return VOID; // elle tombe
  if (sourceGivesTo(w, x, y, z, tick, seed) >= 0) return VOID; // elle s'étale
  // Évaporation, seulement si exposée à l'air.
  if (matAt(w, x, y + 1, z) === VOID && (hash32(i, tick, seed ^ 0x1) & 0xffff) < WATER_EVAPORATION_CHANCE) {
    return VOID;
  }
  return WATER;
}

/**
 * Vide SOUTENU (quelque chose sous lui) et sans eau au-dessus : les deux seuls
 * cas restants sont l'étalement latéral de l'eau et la pousse de biomasse.
 * L'appelant a déjà écarté le cas fréquent — l'air au-dessus du vide.
 */
function nextForSupportedVoid(
  w: VoxelWorld,
  i: number,
  x: number,
  y: number,
  z: number,
  below: number,
  tick: number,
  seed: number,
): number {
  // 1. Une eau latérale nous choisit-elle ? (consentement mutuel)
  const pick = hash32(i, tick, seed) & 3;
  const sx = x + LAT_DX[pick]!;
  const sz = z + LAT_DZ[pick]!;
  if (matAt(w, sx, y, sz) === WATER && !canFall(w, sx, y, sz)) {
    const give = sourceGivesTo(w, sx, y, sz, tick, seed);
    if (give >= 0 && LAT_OPPOSITE[give]! === pick) return WATER;
  }

  // 2. La biomasse pousse sur roche ou biomasse. L'eau à proximité accélère
  //    fortement la pousse, mais le sol sec reste fertile — sans quoi le monde
  //    serait stérile partout sauf sur les rives.
  if (below !== ROCK && below !== BIOMASS) return VOID;
  const roll = hash32(i, tick, seed ^ 0x2) & 0xffff;
  if (roll >= BIOMASS_SPAWN_CHANCE_WET) return VOID; // écarte le cas fréquent d'abord
  for (let d = 0; d < 6; d++) {
    if (matAt(w, x + NEIGHBOR_DX[d]!, y + NEIGHBOR_DY[d]!, z + NEIGHBOR_DZ[d]!) === WATER) {
      return BIOMASS;
    }
  }
  return roll < BIOMASS_SPAWN_CHANCE_DRY ? BIOMASS : VOID;
}

/** Première bouche adjacente, dans l'ordre de voisinage fixe (déterminisme). */
function firstAdjacentMouth(w: VoxelWorld, x: number, y: number, z: number): number {
  for (let d = 0; d < 6; d++) {
    const nx = x + NEIGHBOR_DX[d]!;
    const ny = y + NEIGHBOR_DY[d]!;
    const nz = z + NEIGHBOR_DZ[d]!;
    if (nx < 0 || nx >= SX || ny < 0 || ny >= SY || nz < 0 || nz >= SZ) continue;
    const ni = (ny * SZ + nz) * SX + nx;
    if (w.material[ni] === MOUTH && w.owner[ni] !== NO_OWNER) return ni;
  }
  return -1;
}

/**
 * Métabolisme : chaque voxel de tissu coûte son entretien. On parcourt les
 * corps (O(taille des corps)) et non la grille — c'est ce qui rend le tick
 * bon marché quand le monde est grand et la population modeste.
 */
export function passMetabolism(w: VoxelWorld): void {
  const delta = w.energyDelta;
  for (let a = 0; a < w.aliveCount; a++) {
    const id = w.aliveIds[a]!;
    const base = w.bodySlot(id);
    const len = w.bodyLen[id]!;
    let cost = 0;
    for (let k = 0; k < len; k++) {
      cost += UPKEEP[w.material[w.bodyList[base + k]!]!]!;
    }
    delta[id] = delta[id]! - cost;
  }
}

/** Applique les deltas accumulés, borné par la capacité. */
export function applyEnergy(w: VoxelWorld): void {
  for (let a = 0; a < w.aliveCount; a++) {
    const id = w.aliveIds[a]!;
    let e = w.energy[id]! + w.energyDelta[id]!;
    const cap = w.capacity[id]!;
    if (e > cap) e = cap;
    w.energy[id] = e;
  }
}

/**
 * Morphogenèse : un voxel par tick et par organisme. On cherche d'abord un
 * voxel du plan qui manque (CICATRISATION), sinon on avance le curseur
 * (CROISSANCE). Un seul mécanisme couvre les deux.
 */
export function passGrowth(w: VoxelWorld): void {
  for (let a = 0; a < w.aliveCount; a++) {
    const id = w.aliveIds[a]!;
    if (w.energy[id]! - GROWTH_COST < GROWTH_ENERGY_FLOOR) continue;

    const genome = w.orgGenome[id];
    if (!genome) continue;
    const plan = genome.body;
    const cursor = w.growthCursor[id]!;
    const seedI = w.seedIdx[id]!;
    const sx = w.xOf(seedI);
    const sy = w.yOf(seedI);
    const sz = w.zOf(seedI);

    let rank = -1;
    // Cicatrisation : le premier rang déjà atteint mais absent du corps.
    for (let k = 0; k < cursor; k++) {
      const tx = sx + plan.dx[k]!;
      const ty = sy + plan.dy[k]!;
      const tz = sz + plan.dz[k]!;
      if (!w.inBounds(tx, ty, tz)) continue;
      const ti = w.idx(tx, ty, tz);
      if (w.owner[ti] !== id || w.material[ti] !== plan.type[k]!) {
        rank = k;
        break;
      }
    }
    // Sinon croissance du rang suivant.
    if (rank < 0 && cursor < plan.type.length) rank = cursor;
    if (rank < 0) continue;

    const tx = sx + plan.dx[rank]!;
    const ty = sy + plan.dy[rank]!;
    const tz = sz + plan.dz[rank]!;
    if (!w.inBounds(tx, ty, tz)) {
      if (rank === cursor) w.growthCursor[id] = cursor + 1; // rang hors monde : on l'abandonne
      continue;
    }
    const ti = w.idx(tx, ty, tz);
    const target = w.material[ti]!;
    // On ne pousse que dans du vide, de l'eau ou de la biomasse.
    if (target === ROCK || target >= TISSUE_MIN) {
      if (rank === cursor) w.growthCursor[id] = cursor + 1;
      continue;
    }
    // Le voxel doit toucher un voxel de ce même organisme (sauf le germe).
    if (rank > 0 && !touchesOrganism(w, tx, ty, tz, id)) continue;

    if (!w.addBodyVoxel(id, ti, plan.type[rank]!)) continue;
    w.energy[id] = w.energy[id]! - GROWTH_COST;
    if (rank === cursor) w.growthCursor[id] = cursor + 1;
  }
}

function touchesOrganism(
  w: VoxelWorld,
  x: number,
  y: number,
  z: number,
  id: number,
): boolean {
  for (let d = 0; d < 6; d++) {
    const nx = x + NEIGHBOR_DX[d]!;
    const ny = y + NEIGHBOR_DY[d]!;
    const nz = z + NEIGHBOR_DZ[d]!;
    if (!w.inBounds(nx, ny, nz)) continue;
    const ni = w.idx(nx, ny, nz);
    if (w.owner[ni] === id && w.isTissue(ni)) return true;
  }
  return false;
}

/**
 * Connexité : ce qui ne tient plus au germe est amputé et devient de la chair
 * morte. Ne tourne que pour les organismes marqués `damaged` — la vérification
 * est inutile tant que rien n'a été détruit.
 */
export function passConnectivity(w: VoxelWorld): void {
  for (let a = 0; a < w.aliveCount; a++) {
    const id = w.aliveIds[a]!;
    if (w.damaged[id] === 0) continue;
    w.damaged[id] = 0;
    w.severDisconnected(id, (i) => {
      // La chair amputée nourrit le monde.
      w.removeBodyVoxel(id, i);
      w.material[i] = BIOMASS;
      w.nutrient[i] = CORPSE_NUTRIENT_PER_VOXEL;
      w.owner[i] = NO_OWNER;
      w.touch(i);
    });
    // Plus de corps — typiquement le germe détruit : l'organisme meurt.
    // Sans cela il subsisterait comme une réserve d'énergie désincarnée qui
    // repousserait son propre germe à partir de rien.
    if (w.bodyLen[id] === 0) decompose(w, id);
  }
}

/** Mort : énergie épuisée → le corps entier se décompose en biomasse. */
export function passDeath(w: VoxelWorld): void {
  for (let a = 0; a < w.aliveCount; a++) {
    const id = w.aliveIds[a]!;
    if (w.energy[id]! > 0 && w.bodyLen[id]! > 0) continue;
    decompose(w, id);
  }
}

/** Décompose un organisme : tous ses voxels deviennent de la biomasse riche. */
export function decompose(w: VoxelWorld, id: number): void {
  const base = w.bodySlot(id);
  const len = w.bodyLen[id]!;
  for (let k = 0; k < len; k++) {
    const i = w.bodyList[base + k]!;
    w.material[i] = BIOMASS;
    const n = CORPSE_NUTRIENT_PER_VOXEL;
    w.nutrient[i] = n > NUTRIENT_MAX ? NUTRIENT_MAX : n;
    w.owner[i] = NO_OWNER;
    w.touch(i);
  }
  w.bodyLen[id] = 0;
  w.voxelCount[id] = 0;
  w.neuronCount[id] = 0;
  w.storageCount[id] = 0;
  w.muscleCount[id] = 0;
  w.mouthCount[id] = 0;
  w.energy[id] = 0;
  w.orgState[id] = DEAD;
}

/**
 * Détruit un voxel de tissu (prédation, accident, foudre). Marque l'organisme
 * pour que la connexité recalcule ses amputations au tick suivant.
 */
export function damageVoxel(w: VoxelWorld, i: number): boolean {
  const id = w.owner[i]!;
  if (id === NO_OWNER || !w.isTissue(i)) return false;
  w.removeBodyVoxel(id, i);
  w.material[i] = BIOMASS;
  w.nutrient[i] = CORPSE_NUTRIENT_PER_VOXEL;
  w.owner[i] = NO_OWNER;
  w.damaged[id] = 1;
  w.touch(i);
  return true;
}

/** Types exportés pour les tests : coût d'entretien d'un corps donné. */
export function bodyUpkeep(w: VoxelWorld, id: number): number {
  const base = w.bodySlot(id);
  const len = w.bodyLen[id]!;
  let cost = 0;
  for (let k = 0; k < len; k++) cost += UPKEEP[w.material[w.bodyList[base + k]!]!]!;
  return cost;
}

export { BONE, ALIVE };
