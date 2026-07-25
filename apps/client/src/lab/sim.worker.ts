/// <reference lib="webworker" />
/**
 * Worker du laboratoire : fait tourner `sim-voxel` hors du thread d'interface.
 *
 * CHEMIN CPU OBLIGATOIRE — le laboratoire doit rester utilisable sans WebGPU.
 * L'accélération GPU (voir `gpu/`) est un accélérateur optionnel, jamais une
 * dépendance : si l'adaptateur manque ou échoue, on retombe ici sans rien
 * changer aux règles.
 */
import {
  ALIVE,
  BIOMASS,
  EYE,
  MAX_ORGANISMS,
  SX,
  SY,
  SZ,
  SeededRng,
  TISSUE_MIN,
  VOID,
  VOXEL_COUNT,
  VoxelWorld,
  WATER,
  collectStats,
  decodeGenome,
  encodeGenome,
  findSpawnSpot,
  mutate,
  mutationSeed,
  randomGenome,
  registerGenome,
  spawnFromGenome,
  spawnOrganism,
  step,
  stepN,
  validateGenome,
  worldHash,
} from "@devot/sim-voxel";
import {
  packVoxel,
  type ConformityResult,
  type LabCommand,
  type LabFrame,
  type LabMessage,
  type LabOrganismInfo,
} from "./protocol.js";
import { runTerrainPassOnGpu, gpuAvailable } from "./gpu/terrainGpu.js";

const MAX_RENDER_VOXELS = 60_000;
const FRAME_INTERVAL_MS = 70;

let world: VoxelWorld | null = null;
let ticksPerFrame = 1;
let paused = false;
let selectedId = 0;
/** Organismes protégés par le joueur : leur énergie ne descend pas à zéro. */
const shielded = new Set<number>();

/**
 * Le port WGSL est-il exécutable ici ? Sondé une fois, sans bloquer le démarrage :
 * le chemin CPU ne dépend pas de la réponse.
 */
let gpuReady = false;
void gpuAvailable().then((yes) => {
  gpuReady = yes;
  log(
    yes
      ? "WebGPU disponible : le banc de conformité peut comparer les deux moteurs."
      : "WebGPU indisponible : seul le moteur CPU est utilisable ici.",
  );
});

let lastFrameAt = 0;
let ticksSinceMeasure = 0;
let measureStartedAt = 0;
let ticksPerSecond = 0;

function post(msg: LabMessage, transfer?: Transferable[]): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

function log(text: string): void {
  post({ type: "log", text });
}

// ── Construction du monde du laboratoire ────────────────────────────────────

function buildWorld(seed: number, founders: number): VoxelWorld {
  const w = new VoxelWorld(seed);
  w.generateTerrain();
  const rng = new SeededRng(seed ^ 0x9911);
  let born = 0;
  for (let n = 0; n < founders; n++) {
    const slot = registerGenome(w, randomGenome(rng.next(), 6 + rng.below(6)));
    const spot = findSpawnSpot(w, rng);
    if (spot && spawnOrganism(w, slot, spot.x, spot.y, spot.z) > 0) born++;
  }
  log(`Monde ${SX}×${SY}×${SZ} semé avec ${born} fondateurs (graine ${seed}).`);
  return w;
}

// ── Instantané de rendu (liste dérivée, jamais la grille entière) ────────────

function buildFrame(w: VoxelWorld): LabFrame {
  const voxels = new Int32Array(MAX_RENDER_VOXELS);
  let n = 0;

  // 1. Les tissus vivants d'abord : ce sont eux qui comptent visuellement.
  for (let id = 1; id < MAX_ORGANISMS && n < MAX_RENDER_VOXELS; id++) {
    if (w.orgState[id] !== ALIVE) continue;
    const base = w.bodySlot(id);
    const len = w.bodyLen[id]!;
    const sel = id === selectedId;
    for (let k = 0; k < len && n < MAX_RENDER_VOXELS; k++) {
      const i = w.bodyList[base + k]!;
      voxels[n++] = packVoxel(w.xOf(i), w.yOf(i), w.zOf(i), w.material[i]!, sel);
    }
  }

  // 2. La surface du terrain : uniquement le voxel visible du dessus, pour ne
  //    pas envoyer les couches de roche enfouies.
  for (let z = 0; z < SZ && n < MAX_RENDER_VOXELS; z++) {
    for (let x = 0; x < SX && n < MAX_RENDER_VOXELS; x++) {
      for (let y = SY - 1; y >= 0; y--) {
        const m = w.material[w.idx(x, y, z)]!;
        if (m === VOID || m >= TISSUE_MIN) continue;
        voxels[n++] = packVoxel(x, y, z, m, false);
        break;
      }
    }
  }

  const orgList: number[] = [];
  for (let id = 1; id < MAX_ORGANISMS; id++) {
    if (w.orgState[id] !== ALIVE) continue;
    const i = w.seedIdx[id]!;
    const cap = w.capacity[id]! || 1;
    orgList.push(
      id,
      w.xOf(i),
      w.yOf(i),
      w.zOf(i),
      Math.max(0, Math.min(1000, ((w.energy[id]! * 1000) / cap) | 0)),
    );
  }

  const s = collectStats(w);
  return {
    stats: {
      tick: s.tick,
      population: s.population,
      maxGeneration: s.maxGeneration,
      avgGeneration: s.avgGeneration,
      avgBodyVoxels: s.avgBodyVoxels,
      avgNeurons: s.avgNeurons,
      avgMouths: s.avgMouths,
      avgMuscles: s.avgMuscles,
      avgEyes: s.avgEyes,
      avgIntakeRate: s.avgIntakeRate,
      biomassVoxels: s.biomassVoxels,
      totalEnergy: s.totalEnergy,
      worldHash: worldHash(w),
      ticksPerSecond,
      // La simulation vivante tourne sur CPU : le port GPU couvre le terrain,
      // pas les passes par organisme, et terrain et organismes sont couplés à
      // chaque tick (cf. ARCHITECTURE §5). On signale néanmoins si le port est
      // exécutable ici, car c'est ce qui rend le banc de conformité possible.
      backend: "cpu",
      gpuReady,
    },
    voxels: voxels.subarray(0, n),
    organisms: Int32Array.from(orgList),
  };
}

function inspect(w: VoxelWorld, id: number): LabOrganismInfo | null {
  if (id <= 0 || w.orgState[id] !== ALIVE) return null;
  const g = w.orgGenome[id];
  const base = w.bodySlot(id);
  const len = w.bodyLen[id]!;
  let eyes = 0;
  for (let k = 0; k < len; k++) if (w.material[w.bodyList[base + k]!] === EYE) eyes++;
  return {
    id,
    generation: w.generation[id]!,
    energy: w.energy[id]!,
    capacity: w.capacity[id]!,
    bodyVoxels: len,
    neurons: w.neuronCount[id]!,
    mouths: w.mouthCount[id]!,
    muscles: w.muscleCount[id]!,
    eyes,
    age: w.tick - w.bornTick[id]!,
    eaten: w.eaten[id]!,
    distance: w.distance[id]!,
    protected: shielded.has(id),
    planTypes: g ? Array.from(g.body.type) : [],
    reproThreshold: g?.reproThreshold ?? 0,
    weightCount: g?.weights.length ?? 0,
  };
}

// ── Sélection artificielle ──────────────────────────────────────────────────

/** Un organisme protégé ne peut pas mourir de faim : le joueur le soutient. */
function applyShields(w: VoxelWorld): void {
  if (shielded.size === 0) return;
  for (const id of shielded) {
    if (w.orgState[id] !== ALIVE) {
      shielded.delete(id);
      continue;
    }
    if (w.energy[id]! < 12_000) w.energy[id] = 12_000;
  }
}

function forceBreed(w: VoxelWorld, id: number): void {
  if (w.orgState[id] !== ALIVE) return;
  const g = w.orgGenome[id];
  if (!g) return;
  const base = w.bodySlot(id);
  const len = w.bodyLen[id]!;
  for (let k = 0; k < len; k++) {
    const i = w.bodyList[base + k]!;
    const x = w.xOf(i);
    const y = w.yOf(i);
    const z = w.zOf(i);
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const) {
      if (!w.inBounds(x + dx, y + dy, z + dz)) continue;
      const ni = w.idx(x + dx, y + dy, z + dz);
      const m = w.material[ni]!;
      if (m !== VOID && m !== WATER) continue;
      const child = spawnFromGenome(
        w,
        mutate(g, mutationSeed(id, w.tick, w.seed)),
        x + dx,
        y + dy,
        z + dz,
        20_000,
        w.generation[id]! + 1,
      );
      if (child > 0) {
        log(`Croisement forcé : #${id} → #${child} (génération ${w.generation[child]}).`);
        return;
      }
    }
  }
  log(`Aucune place libre autour de #${id} pour un enfant.`);
}

// ── Test de conformité CPU ↔ GPU ────────────────────────────────────────────

/**
 * Exigence du jalon : même graine, mêmes ticks → même état final. On compare
 * les empreintes de deux mondes identiques, l'un avancé par la passe terrain
 * CPU, l'autre par la passe WGSL. Un écart doit être explicitement borné et
 * documenté, sinon le port GPU n'est pas considéré comme terminé.
 */
async function runConformity(ticks: number): Promise<ConformityResult> {
  const seed = 20260725;
  const cpu = new VoxelWorld(seed);
  cpu.generateTerrain();
  stepN(cpu, ticks);
  const cpuHash = worldHash(cpu);

  const available = await gpuAvailable();
  if (!available) {
    return {
      ticks,
      seed,
      cpuHash,
      gpuHash: null,
      identical: false,
      gpuAvailable: false,
      detail:
        "WebGPU indisponible dans ce navigateur : le laboratoire tourne en CPU, " +
        "ce qui est le chemin obligatoire. La conformité ne peut pas être vérifiée ici.",
    };
  }

  const gpu = new VoxelWorld(seed);
  gpu.generateTerrain();
  const ok = await runTerrainPassOnGpu(gpu, ticks);
  const gpuHash = worldHash(gpu);
  return {
    ticks,
    seed,
    cpuHash,
    gpuHash,
    identical: ok && cpuHash === gpuHash,
    gpuAvailable: true,
    detail: ok
      ? cpuHash === gpuHash
        ? `Les deux moteurs produisent le même état après ${ticks} ticks : le port GPU respecte les règles.`
        : "ÉCART détecté : les empreintes diffèrent. Le port GPU n'est pas conforme, la simulation reste sur le chemin CPU."
      : "La passe GPU a échoué à l'exécution ; repli CPU.",
  };
}

// ── Boucle ──────────────────────────────────────────────────────────────────

function loop(): void {
  const w = world;
  if (!w) {
    setTimeout(loop, 50);
    return;
  }

  if (!paused) {
    const now = performance.now();
    if (measureStartedAt === 0) measureStartedAt = now;
    for (let k = 0; k < ticksPerFrame; k++) {
      applyShields(w);
      step(w);
    }
    ticksSinceMeasure += ticksPerFrame;
    if (now - measureStartedAt > 500) {
      ticksPerSecond = (ticksSinceMeasure * 1000) / (now - measureStartedAt);
      ticksSinceMeasure = 0;
      measureStartedAt = now;
    }
  }

  const now = performance.now();
  if (now - lastFrameAt >= FRAME_INTERVAL_MS) {
    lastFrameAt = now;
    const frame = buildFrame(w);
    post({ type: "frame", frame }, [frame.voxels.buffer, frame.organisms.buffer]);
    if (selectedId > 0) post({ type: "inspect", info: inspect(w, selectedId) });
  }
  // setTimeout(0) rend la main au worker : les messages entrants sont traités
  // entre deux salves de ticks, même à x1000.
  setTimeout(loop, 0);
}

self.onmessage = (e: MessageEvent<LabCommand>) => {
  const cmd = e.data;
  switch (cmd.type) {
    case "init":
      world = buildWorld(cmd.seed, cmd.founders);
      selectedId = 0;
      shielded.clear();
      ticksSinceMeasure = 0;
      measureStartedAt = 0;
      break;
    case "speed":
      ticksPerFrame = Math.max(1, cmd.ticksPerFrame | 0);
      break;
    case "pause":
      paused = cmd.paused;
      break;
    case "inspect":
      selectedId = cmd.organismId;
      if (world) post({ type: "inspect", info: inspect(world, selectedId) });
      break;
    case "protect":
      if (cmd.on) shielded.add(cmd.organismId);
      else shielded.delete(cmd.organismId);
      log(`${cmd.on ? "Protection" : "Abandon"} de #${cmd.organismId}.`);
      break;
    case "kill":
      if (world && world.orgState[cmd.organismId] === ALIVE) {
        world.energy[cmd.organismId] = -1;
        shielded.delete(cmd.organismId);
        log(`#${cmd.organismId} éliminé par sélection artificielle.`);
      }
      break;
    case "breed":
      if (world) forceBreed(world, cmd.organismId);
      break;
    case "exportGenome": {
      if (!world) break;
      const g = world.orgGenome[cmd.organismId];
      if (!g) break;
      const bytes = encodeGenome(g);
      // On revalide ce qu'on exporte : c'est exactement ce que le monde commun
      // vérifiera au moment de relâcher la créature.
      const roundTrip = decodeGenome(bytes);
      const valid = roundTrip !== null && validateGenome(roundTrip) === null;
      post({ type: "genome", organismId: cmd.organismId, bytes, valid });
      log(
        `Génome de #${cmd.organismId} exporté : ${bytes.byteLength} octets, ` +
          `${valid ? "valide" : "INVALIDE"} pour le monde commun.`,
      );
      break;
    }
    case "conformity": {
      // Le banc simule DEUX mondes de plus : le laisser concourir avec la boucle
      // à ×1000 l'affamait, et le résultat n'arrivait jamais. On arrête le temps
      // pendant la mesure, puis on rend la vitesse d'avant.
      const wasPaused = paused;
      paused = true;
      log("Mesure de conformité en cours : le monde est suspendu.");
      void runConformity(cmd.ticks).then((result) => {
        paused = wasPaused;
        post({ type: "conformity", result });
      });
      break;
    }
  }
};

log(`Worker prêt (${VOXEL_COUNT.toLocaleString("fr-FR")} voxels par monde).`);
loop();

export {};
