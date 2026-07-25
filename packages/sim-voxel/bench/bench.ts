/**
 * Benchmark du noyau — POINT DE DÉCISION du jalon P5.0.
 *
 * Si un tick coûte quelques millisecondes, tout le plan est confortable.
 * S'il coûte des centaines de millisecondes, il faut réduire le monde ou
 * porter le serveur sur GPU avant d'aller plus loin.
 *
 * Usage : pnpm --filter @devot/sim-voxel bench
 */
import {
  PLAN_GRAZER,
  PLAN_THINKER,
  PLAN_WORM,
  SeededRng,
  SX,
  SY,
  SZ,
  VOXEL_COUNT,
  VoxelWorld,
  collectStats,
  findSpawnSpot,
  registerPlan,
  spawnOrganism,
  step,
} from "../src/index.js";

const POPULATIONS = [0, 50, 200];
const WARMUP = 40;
const MEASURE = 220;

function fmt(n: number, digits = 2): string {
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function buildWorld(population: number): VoxelWorld {
  const w = new VoxelWorld(20260725);
  w.generateTerrain();
  const plans = [
    registerPlan(w, PLAN_GRAZER),
    registerPlan(w, PLAN_WORM),
    registerPlan(w, PLAN_THINKER),
  ];
  const rng = new SeededRng(7);
  for (let n = 0; n < population; n++) {
    const spot = findSpawnSpot(w, rng);
    if (!spot) continue;
    spawnOrganism(w, plans[n % plans.length]!, spot.x, spot.y, spot.z);
  }
  return w;
}

function measure(population: number): void {
  const w = buildWorld(population);
  for (let k = 0; k < WARMUP; k++) step(w);

  const samples = new Float64Array(MEASURE);
  for (let k = 0; k < MEASURE; k++) {
    const t0 = performance.now();
    step(w);
    samples[k] = performance.now() - t0;
  }
  samples.sort();
  const median = samples[MEASURE >> 1]!;
  const p95 = samples[Math.floor(MEASURE * 0.95)]!;
  let sum = 0;
  for (const s of samples) sum += s;
  const mean = sum / MEASURE;

  const stats = collectStats(w);
  const voxPerSec = VOXEL_COUNT / (median / 1000);

  console.log(
    `pop ${String(population).padStart(3)} | médiane ${fmt(median)} ms | moyenne ${fmt(mean)} ms | p95 ${fmt(p95)} ms | ` +
      `${fmt(voxPerSec / 1e6, 1)} Mvoxels/s | vivants ${stats.population} | corps moy. ${fmt(stats.avgBodyVoxels, 1)} voxels`,
  );
  console.log(
    `        → x1000 tiendrait ${median > 0 ? fmt(1000 / (median * 1000), 3) : "∞"} s de temps réel par seconde de calcul` +
      ` (ticks/s max : ${fmt(1000 / median, 0)})`,
  );
}

console.log(`Monde ${SX}×${SY}×${SZ} = ${VOXEL_COUNT.toLocaleString("fr-FR")} voxels`);
console.log(`Node ${process.version} — ${MEASURE} ticks mesurés après ${WARMUP} de chauffe\n`);
for (const p of POPULATIONS) measure(p);
