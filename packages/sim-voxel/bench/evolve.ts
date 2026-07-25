/**
 * P5.1 — run headless de sélection naturelle.
 *
 * Aucune fonction de survie n'est imposée : ce qui mange et se reproduit se
 * répand, voilà tout. On observe donc, on ne récompense pas.
 *
 * Livrable du jalon : une amélioration MESURABLE entre les premières
 * générations et les dernières, et deux graines rejouables à l'identique.
 *
 * Usage : pnpm --filter @devot/sim-voxel evolve [graine] [ticks]
 */
import {
  ALIVE,
  MAX_ORGANISMS,
  SeededRng,
  VoxelWorld,
  collectStats,
  findSpawnSpot,
  randomGenome,
  registerGenome,
  spawnOrganism,
  stepN,
  worldHash,
} from "../src/index.js";

const SEED = Number(process.argv[2] ?? 20260725);
const TICKS = Number(process.argv[3] ?? 6000);
const FOUNDERS = Number(process.argv[4] ?? 200);
const SAMPLE_EVERY = 500;

function fmt(n: number, d = 1): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function build(seed: number): VoxelWorld {
  const w = new VoxelWorld(seed);
  w.generateTerrain();
  const rng = new SeededRng(seed ^ 0x9911);
  // Population de départ : des génomes tirés au hasard, tous différents.
  for (let n = 0; n < FOUNDERS; n++) {
    const slot = registerGenome(w, randomGenome(rng.next(), 6 + rng.below(6)));
    const spot = findSpawnSpot(w, rng);
    if (spot) spawnOrganism(w, slot, spot.x, spot.y, spot.z);
  }
  return w;
}

/**
 * Accumule, tout au long du run, le taux d'ingestion de chaque organisme par
 * génération. Échantillonner l'instant final ne donnerait que quelques
 * individus par génération — bien trop peu pour conclure quoi que ce soit.
 */
function sampleIntakeByGeneration(
  w: VoxelWorld,
  bands: Map<number, { n: number; rate: number; body: number }>,
): void {
  for (let id = 1; id < MAX_ORGANISMS; id++) {
    if (w.orgState[id] !== ALIVE) continue;
    const age = w.tick - w.bornTick[id]!;
    if (age < 60) continue; // trop jeune pour être jugé
    const band = w.generation[id]!;
    const cur = bands.get(band) ?? { n: 0, rate: 0, body: 0 };
    cur.n++;
    cur.rate += w.eaten[id]! / age;
    cur.body += w.bodyLen[id]!;
    bands.set(band, cur);
  }
}

console.log(`Sélection naturelle — graine ${SEED}, ${TICKS} ticks, ${FOUNDERS} fondateurs\n`);
const w = build(SEED);

console.log("  tick | pop | gén. max | gén. moy | corps | bouches | muscles | yeux | neurones | ingestion/tick | dist. moy");
const bands = new Map<number, { n: number; rate: number; body: number }>();

for (let k = 0; k * SAMPLE_EVERY < TICKS; k++) {
  // On échantillonne finement pour accumuler des effectifs exploitables,
  // et on n'affiche qu'un point sur SAMPLE_EVERY.
  for (let j = 0; j < SAMPLE_EVERY; j += 50) {
    stepN(w, 50);
    sampleIntakeByGeneration(w, bands);
  }
  const s = collectStats(w);
  console.log(
    `  ${String(s.tick).padStart(5)} | ${String(s.population).padStart(3)} | ` +
      `${String(s.maxGeneration).padStart(8)} | ${fmt(s.avgGeneration).padStart(8)} | ` +
      `${fmt(s.avgBodyVoxels).padStart(5)} | ${fmt(s.avgMouths, 2).padStart(7)} | ` +
      `${fmt(s.avgMuscles, 2).padStart(7)} | ${fmt(s.avgEyes, 2).padStart(4)} | ` +
      `${fmt(s.avgNeurons, 2).padStart(8)} | ${fmt(s.avgIntakeRate).padStart(14)} | ` +
      `${fmt(s.avgDistance).padStart(9)}`,
  );
  if (s.population === 0) {
    console.log("  → extinction : la population n'a pas tenu.");
    break;
  }
}

// ── Amélioration mesurable : premières générations contre dernières ─────────
const table = [...bands.entries()].sort((a, b) => a[0] - b[0]);
if (table.length > 0) {
  console.log("\nTaux d'ingestion par génération (cumulé sur tout le run, âge ≥ 60) :");
  for (const [gen, v] of table) {
    console.log(
      `  génération ${String(gen).padStart(3)} : ${fmt(v.rate / v.n).padStart(6)} / tick  ` +
        `corps ${fmt(v.body / v.n)} voxels  (${v.n} observations)`,
    );
  }
  const mean = (arr: typeof table): number => {
    let n = 0;
    let r = 0;
    for (const [, v] of arr) {
      n += v.n;
      r += v.rate;
    }
    return n === 0 ? 0 : r / n;
  };
  const split = Math.max(1, table.length >> 1);
  const a = mean(table.slice(0, split));
  const b = mean(table.slice(split));
  console.log(
    `\nGénérations basses : ${fmt(a)} / tick — générations hautes : ${fmt(b)} / tick ` +
      `(${b > a ? "+" : ""}${fmt(a === 0 ? 0 : ((b - a) / a) * 100)} %)`,
  );
}

const sEnd = collectStats(w);
console.log(
  `\nFin : ${sEnd.population} vivants, génération maximale ${sEnd.maxGeneration}, ` +
    `empreinte ${worldHash(w).toString(16)}`,
);

// ── Deux graines rejouables à l'identique ───────────────────────────────────
const replay = build(SEED);
stepN(replay, w.tick);
const same = worldHash(replay) === worldHash(w);
console.log(`Rejeu de la graine ${SEED} : ${same ? "IDENTIQUE" : "DIVERGENCE"}`);
if (!same) process.exitCode = 1;

const other = build(SEED + 1);
stepN(other, 1500);
const sOther = collectStats(other);
console.log(
  `Graine ${SEED + 1} (1500 ticks) : ${sOther.population} vivants, ` +
    `génération max ${sOther.maxGeneration}, empreinte ${worldHash(other).toString(16)}`,
);
