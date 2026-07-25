import {
  ALIVE,
  BIOMASS,
  CAPACITY_BASE,
  CAPACITY_PER_STORAGE,
  CHUNK,
  CHUNK_COUNT,
  CX,
  CZ,
  DEAD,
  GROUND_Y,
  MAX_BODY_VOXELS,
  MAX_NEURON_VOXELS,
  MAX_ORGANISMS,
  NEURON,
  NO_OWNER,
  NUTRIENT_FRESH,
  ROCK,
  STORAGE,
  SX,
  SY,
  SZ,
  TISSUE_MIN,
  VOID,
  VOXEL_COUNT,
  WATER,
} from "./constants.js";
import { NUM_INPUTS, NUM_OUTPUTS, type Genome } from "./genome.js";
import { SeededRng } from "./rng.js";

/**
 * L'état du monde, en Structure of Arrays.
 *
 * Aucun objet par voxel, aucune allocation après la construction : tous les
 * tampons de travail (ping-pong, file de parcours, listes de corps) sont
 * alloués ici une fois pour toutes. C'est la condition d'une boucle chaude
 * stable, et le port GPU devient un simple changement de support des mêmes
 * tampons.
 */
export class VoxelWorld {
  // ── Grille (double tampon pour les passes cellulaires) ────────────────────
  material: Uint8Array;
  materialNext: Uint8Array;
  nutrient: Uint16Array;
  nutrientNext: Uint16Array;
  /** Id d'organisme propriétaire d'un voxel de tissu (0 = aucun). */
  owner: Uint16Array;
  ownerNext: Uint16Array;

  /** Version par chunk : incrémentée dès qu'un voxel du chunk change. */
  readonly chunkVersion: Uint32Array;

  // ── Organismes (SoA, indexés par id ; l'id 0 est réservé) ─────────────────
  readonly energy: Int32Array;
  readonly capacity: Int32Array;
  readonly voxelCount: Uint16Array;
  readonly neuronCount: Uint16Array;
  readonly storageCount: Uint16Array;
  readonly muscleCount: Uint16Array;
  readonly mouthCount: Uint16Array;
  readonly generation: Uint16Array;
  readonly seedIdx: Int32Array;
  readonly orgState: Uint8Array;
  /** Rang du prochain voxel du plan de corps à faire pousser. */
  readonly growthCursor: Uint16Array;
  /** Un voxel a été détruit → la connexité doit être revérifiée. */
  readonly damaged: Uint8Array;

  // ── Génome et cerveau ─────────────────────────────────────────────────────
  /**
   * Génome de chaque organisme, indexé par id (donc borné : l'emplacement d'un
   * mort est réécrit à la naissance suivante — pas de fuite sur 100 000
   * générations).
   */
  readonly orgGenome: Array<Genome | undefined>;
  /** Intentions issues du cerveau, consommées par les passes du même tick. */
  readonly intentDir: Int8Array;
  readonly intentRepro: Uint8Array;
  readonly intentAttack: Uint8Array;

  // ── Mesures par organisme (émergence, sans fitness imposée) ───────────────
  readonly bornTick: Int32Array;
  readonly eaten: Int32Array;
  readonly distance: Int32Array;

  /**
   * Voxels de chaque organisme, en tranches de MAX_BODY_VOXELS.
   * Évite de balayer les 524 288 voxels par organisme : le métabolisme et la
   * connexité coûtent O(taille du corps), pas O(taille du monde).
   */
  readonly bodyList: Int32Array;
  readonly bodyLen: Uint16Array;

  /** Ids vivants, compacté à chaque tick. */
  readonly aliveIds: Uint16Array;
  aliveCount = 0;

  // ── Tampons de travail réutilisés (jamais réalloués) ──────────────────────
  private readonly bfsQueue: Int32Array;
  /** Marquage du parcours de connexité, nettoyé après usage (jamais rempli en entier). */
  private readonly reached: Uint8Array;
  /** Delta d'énergie par organisme : somme d'entiers, donc indépendante de l'ordre. */
  readonly energyDelta: Int32Array;

  /** Modèles réutilisables (populations de départ, semis du laboratoire). */
  readonly templates: Genome[] = [];

  // ── Tampons du cerveau, réutilisés à chaque évaluation ────────────────────
  readonly senseBuf = new Int32Array(NUM_INPUTS);
  readonly hiddenBuf = new Int32Array(MAX_NEURON_VOXELS);
  readonly outBuf = new Int32Array(NUM_OUTPUTS);
  /** Cibles d'une translation de corps (déplacement en deux temps). */
  readonly moveTargets: Int32Array;
  readonly moveMats: Uint8Array;

  tick = 0;
  readonly seed: number;
  private nextOrgId = 1;

  /**
   * Plus haut niveau y susceptible de contenir autre chose que du vide.
   * Borne la passe terrain : tout ce qui est au-dessus est du vide et se
   * recopie par `fill` (memset), au lieu d'être visité voxel par voxel.
   * Ne fait que croître, donc reste toujours une borne sûre. Par défaut la
   * hauteur maximale — un monde construit à la main n'est jamais tronqué ;
   * seul `generateTerrain` la resserre, et la croissance la repousse.
   */
  activeTop = SY - 1;

  constructor(seed = 1) {
    // `hash32` n'a aucun terme constant : hash32(0,0,0) === 0. Une graine nulle
    // donnerait donc un tirage nul au premier tick du premier voxel, et un
    // biais mesurable ensuite. Toute graine est ramenée à une valeur non nulle.
    this.seed = (seed | 0) === 0 ? 1 : seed | 0;

    this.material = new Uint8Array(VOXEL_COUNT);
    this.materialNext = new Uint8Array(VOXEL_COUNT);
    this.nutrient = new Uint16Array(VOXEL_COUNT);
    this.nutrientNext = new Uint16Array(VOXEL_COUNT);
    this.owner = new Uint16Array(VOXEL_COUNT);
    this.ownerNext = new Uint16Array(VOXEL_COUNT);
    this.chunkVersion = new Uint32Array(CHUNK_COUNT);

    this.energy = new Int32Array(MAX_ORGANISMS);
    this.capacity = new Int32Array(MAX_ORGANISMS);
    this.voxelCount = new Uint16Array(MAX_ORGANISMS);
    this.neuronCount = new Uint16Array(MAX_ORGANISMS);
    this.storageCount = new Uint16Array(MAX_ORGANISMS);
    this.muscleCount = new Uint16Array(MAX_ORGANISMS);
    this.mouthCount = new Uint16Array(MAX_ORGANISMS);
    this.generation = new Uint16Array(MAX_ORGANISMS);
    this.seedIdx = new Int32Array(MAX_ORGANISMS);
    this.orgState = new Uint8Array(MAX_ORGANISMS);
    this.growthCursor = new Uint16Array(MAX_ORGANISMS);
    this.damaged = new Uint8Array(MAX_ORGANISMS);
    this.orgGenome = new Array<Genome | undefined>(MAX_ORGANISMS);
    this.intentDir = new Int8Array(MAX_ORGANISMS);
    this.intentRepro = new Uint8Array(MAX_ORGANISMS);
    this.intentAttack = new Uint8Array(MAX_ORGANISMS);
    this.bornTick = new Int32Array(MAX_ORGANISMS);
    this.eaten = new Int32Array(MAX_ORGANISMS);
    this.distance = new Int32Array(MAX_ORGANISMS);

    this.bodyList = new Int32Array(MAX_ORGANISMS * MAX_BODY_VOXELS);
    this.bodyLen = new Uint16Array(MAX_ORGANISMS);
    this.aliveIds = new Uint16Array(MAX_ORGANISMS);

    this.moveTargets = new Int32Array(MAX_BODY_VOXELS);
    this.moveMats = new Uint8Array(MAX_BODY_VOXELS);
    this.bfsQueue = new Int32Array(MAX_BODY_VOXELS);
    this.reached = new Uint8Array(VOXEL_COUNT);
    this.energyDelta = new Int32Array(MAX_ORGANISMS);
  }

  // ── Indexation ───────────────────────────────────────────────────────────

  /** idx = (y * SZ + z) * SX + x — x contigu, pour la localité de cache. */
  idx(x: number, y: number, z: number): number {
    return (y * SZ + z) * SX + x;
  }

  xOf(i: number): number {
    return i % SX;
  }

  zOf(i: number): number {
    return ((i / SX) | 0) % SZ;
  }

  yOf(i: number): number {
    return (i / (SX * SZ)) | 0;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < SX && y >= 0 && y < SY && z >= 0 && z < SZ;
  }

  chunkOf(i: number): number {
    return (
      (((this.yOf(i) / CHUNK) | 0) * CZ + ((this.zOf(i) / CHUNK) | 0)) * CX +
      ((this.xOf(i) / CHUNK) | 0)
    );
  }

  /** Marque le chunk d'un voxel comme modifié : base du protocole dérivé (P5.3). */
  touch(i: number): void {
    this.chunkVersion[this.chunkOf(i)]!++;
    this.raiseActiveTop(this.yOf(i));
  }

  /** Repousse la borne de la passe terrain (avec une marge). */
  raiseActiveTop(y: number): void {
    const wanted = Math.min(SY - 1, y + 2);
    if (wanted > this.activeTop) this.activeTop = wanted;
  }

  /** Écrit un voxel de terrain en tenant la borne active à jour. */
  setMaterial(i: number, mat: number, nutrient = 0): void {
    this.material[i] = mat;
    this.nutrient[i] = nutrient;
    this.touch(i);
  }

  isTissue(i: number): boolean {
    return this.material[i]! >= TISSUE_MIN;
  }

  // ── Corps : listes de voxels ─────────────────────────────────────────────

  bodySlot(id: number): number {
    return id * MAX_BODY_VOXELS;
  }

  /** Ajoute un voxel au corps. Renvoie false si le corps est saturé. */
  addBodyVoxel(id: number, i: number, mat: number): boolean {
    const len = this.bodyLen[id]!;
    if (len >= MAX_BODY_VOXELS) return false;
    this.bodyList[this.bodySlot(id) + len] = i;
    this.bodyLen[id] = len + 1;
    this.material[i] = mat;
    this.owner[i] = id;
    this.voxelCount[id]!;
    this.voxelCount[id] = this.voxelCount[id]! + 1;
    if (mat === NEURON) this.neuronCount[id] = this.neuronCount[id]! + 1;
    else if (mat === STORAGE) {
      this.storageCount[id] = this.storageCount[id]! + 1;
      this.refreshCapacity(id);
    } else if (mat === 5) this.muscleCount[id] = this.muscleCount[id]! + 1;
    else if (mat === 7) this.mouthCount[id] = this.mouthCount[id]! + 1;
    this.touch(i);
    return true;
  }

  /** Retire un voxel du corps (échange avec le dernier — O(taille du corps)). */
  removeBodyVoxel(id: number, i: number): void {
    const base = this.bodySlot(id);
    const len = this.bodyLen[id]!;
    for (let k = 0; k < len; k++) {
      if (this.bodyList[base + k] !== i) continue;
      this.bodyList[base + k] = this.bodyList[base + len - 1]!;
      this.bodyLen[id] = len - 1;
      const mat = this.material[i]!;
      this.voxelCount[id] = Math.max(0, this.voxelCount[id]! - 1);
      if (mat === NEURON) this.neuronCount[id] = Math.max(0, this.neuronCount[id]! - 1);
      else if (mat === STORAGE) {
        this.storageCount[id] = Math.max(0, this.storageCount[id]! - 1);
        this.refreshCapacity(id);
      } else if (mat === 5) this.muscleCount[id] = Math.max(0, this.muscleCount[id]! - 1);
      else if (mat === 7) this.mouthCount[id] = Math.max(0, this.mouthCount[id]! - 1);
      return;
    }
  }

  // ── Organismes ───────────────────────────────────────────────────────────

  /** Alloue un id d'organisme, ou 0 si la population est saturée. */
  allocOrganism(): number {
    for (let n = 0; n < MAX_ORGANISMS - 1; n++) {
      const id = 1 + ((this.nextOrgId - 1 + n) % (MAX_ORGANISMS - 1));
      if (this.orgState[id] === DEAD && this.bodyLen[id] === 0) {
        this.nextOrgId = id + 1;
        return id;
      }
    }
    return 0;
  }

  refreshCapacity(id: number): void {
    this.capacity[id] = CAPACITY_BASE + this.storageCount[id]! * CAPACITY_PER_STORAGE;
    if (this.energy[id]! > this.capacity[id]!) this.energy[id] = this.capacity[id]!;
  }

  /** Reconstruit la liste compacte des vivants. Une fois par tick. */
  refreshAlive(): void {
    let n = 0;
    for (let id = 1; id < MAX_ORGANISMS; id++) {
      if (this.orgState[id] === ALIVE) this.aliveIds[n++] = id;
    }
    this.aliveCount = n;
  }

  /**
   * Parcours de connexité depuis le germe. Renvoie le nombre de voxels
   * atteints et laisse `reached` propre en sortie (nettoyage par la file).
   */
  severDisconnected(id: number, onSevered: (i: number) => void): number {
    const base = this.bodySlot(id);
    const len = this.bodyLen[id]!;
    if (len === 0) return 0;

    const seed = this.seedIdx[id]!;
    if (this.owner[seed] !== id || !this.isTissue(seed)) {
      // Le germe lui-même a été détruit : tout le corps est perdu.
      for (let k = len - 1; k >= 0; k--) onSevered(this.bodyList[base + k]!);
      return 0;
    }

    let head = 0;
    let tail = 0;
    this.bfsQueue[tail++] = seed;
    this.reached[seed] = 1;

    while (head < tail) {
      const i = this.bfsQueue[head++]!;
      const x = this.xOf(i);
      const y = this.yOf(i);
      const z = this.zOf(i);
      for (let d = 0; d < 6; d++) {
        const nx = x + NEIGHBOR_DX[d]!;
        const ny = y + NEIGHBOR_DY[d]!;
        const nz = z + NEIGHBOR_DZ[d]!;
        if (!this.inBounds(nx, ny, nz)) continue;
        const ni = this.idx(nx, ny, nz);
        if (this.reached[ni] === 1) continue;
        if (this.owner[ni] !== id || !this.isTissue(ni)) continue;
        this.reached[ni] = 1;
        if (tail < this.bfsQueue.length) this.bfsQueue[tail++] = ni;
      }
    }

    // Ampute ce qui n'a pas été atteint (parcours à l'envers : on retire en place).
    for (let k = len - 1; k >= 0; k--) {
      const i = this.bodyList[base + k]!;
      if (this.reached[i] !== 1) onSevered(i);
    }

    // Nettoyage : uniquement les cases visitées, jamais tout le tableau.
    for (let k = 0; k < tail; k++) this.reached[this.bfsQueue[k]!] = 0;
    return tail;
  }

  // ── Terrain initial ──────────────────────────────────────────────────────

  /**
   * Génère un terrain : socle rocheux ondulé, cuvettes d'eau, biomasse.
   * Séquentiel et hors boucle chaude → un générateur à état est légitime ici.
   */
  generateTerrain(): void {
    const rng = new SeededRng(this.seed ^ 0x5eed);
    this.material.fill(VOID);
    this.nutrient.fill(0);
    this.owner.fill(NO_OWNER);

    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const h =
          GROUND_Y +
          (Math.sin(x * 0.11) + Math.sin(z * 0.13)) * 1.5 +
          Math.sin(x * 0.031 + z * 0.027) * 2.5;
        const top = Math.max(1, Math.min(SY - 2, Math.round(h)));
        for (let y = 0; y < top; y++) this.material[this.idx(x, y, z)] = ROCK;
        // Les creux sous le niveau de référence se remplissent d'eau.
        for (let y = top; y <= GROUND_Y; y++) this.material[this.idx(x, y, z)] = WATER;
      }
    }

    // Biomasse initiale sur la première surface exposée.
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        for (let y = SY - 2; y > 0; y--) {
          const i = this.idx(x, y, z);
          if (this.material[i] !== VOID) continue;
          const below = this.material[this.idx(x, y - 1, z)]!;
          if (below !== ROCK && below !== WATER) continue;
          if (rng.chance(8, 100)) {
            this.material[i] = BIOMASS;
            this.nutrient[i] = NUTRIENT_FRESH;
          }
          break;
        }
      }
    }

    // Borne la passe terrain à la hauteur réellement occupée (+ marge).
    let top = 0;
    for (let i = 0; i < VOXEL_COUNT; i++) {
      if (this.material[i] !== VOID) {
        const y = this.yOf(i);
        if (y > top) top = y;
      }
    }
    this.activeTop = Math.min(SY - 1, top + 3);

    this.materialNext.set(this.material);
    this.nutrientNext.set(this.nutrient);
    this.ownerNext.set(this.owner);
    this.chunkVersion.fill(1);
  }

  /** Échange les tampons après une passe cellulaire (ping-pong). */
  swapBuffers(): void {
    const m = this.material;
    this.material = this.materialNext;
    this.materialNext = m;
    const n = this.nutrient;
    this.nutrient = this.nutrientNext;
    this.nutrientNext = n;
    const o = this.owner;
    this.owner = this.ownerNext;
    this.ownerNext = o;
  }
}

/** Plan de corps : offsets relatifs au germe, dans l'ordre de croissance. */
export interface BodyPlan {
  dx: Int8Array;
  dy: Int8Array;
  dz: Int8Array;
  type: Uint8Array;
}

/** Voisinage à 6 faces, ordre fixe (déterminisme). */
export const NEIGHBOR_DX = new Int8Array([1, -1, 0, 0, 0, 0]);
export const NEIGHBOR_DY = new Int8Array([0, 0, 1, -1, 0, 0]);
export const NEIGHBOR_DZ = new Int8Array([0, 0, 0, 0, 1, -1]);
