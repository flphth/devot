/**
 * P5.1 — mesure agrégée de la sélection naturelle sur PLUSIEURS graines.
 *
 * Une graine unique ne prouve rien : l'évolution est stochastique, et sur
 * quelques milliers de ticks une lignée peut aussi bien exploser que s'éteindre
 * par accident. On mesure donc la tendance sur N mondes indépendants.
 *
 * Usage : pnpm --filter @devot/sim-voxel evolve:multi [nbGraines] [ticks]
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
} from "../src/index.js";

const SEEDS = Number(process.argv[2] ?? 6);
const TICKS = Number(process.argv[3] ?? 8000);
const FOUNDERS = 200;
const SAMPLE_EVERY = 50;

function fmt(n: number, d = 1): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

interface Band {
  n: number;
  rate: number;
  body: number;
}

function runSeed(seed: number): {
  improvement: number;
  low: number;
  high: number;
  maxGen: number;
  population: number;
} {
  const w = new VoxelWorld(seed);
  w.generateTerrain();
  const rng = new SeededRng(seed ^ 0x9911);
  for (let n = 0; n < FOUNDERS; n++) {
    const slot = registerGenome(w, randomGenome(rng.next(), 6 + rng.below(6)));
    const spot = findSpawnSpot(w, rng);
    if (spot) spawnOrganism(w, slot, spot.x, spot.y, spot.z);
  }

  const bands = new Map<number, Band>();
  for (let t = 0; t < TICKS; t += SAMPLE_EVERY) {
    stepN(w, SAMPLE_EVERY);
    for (let id = 1; id < MAX_ORGANISMS; id++) {
      if (w.orgState[id] !== ALIVE) continue;
      const age = w.tick - w.bornTick[id]!;
      if (age < 60) continue;
      const gen = w.generation[id]!;
      const cur = bands.get(gen) ?? { n: 0, rate: 0, body: 0 };
      cur.n++;
      cur.rate += w.eaten[id]! / age;
      cur.body += w.bodyLen[id]!;
      bands.set(gen, cur);
    }
  }

  const table = [...bands.entries()].sort((a, b) => a[0] - b[0]);
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
  const low = mean(table.slice(0, split));
  const high = mean(table.slice(split));
  const s = collectStats(w);
  return {
    improvement: low === 0 ? 0 : ((high - low) / low) * 100,
    low,
    high,
    maxGen: s.maxGeneration,
    population: s.population,
  };
}

console.log(
  `Sélection naturelle agrégée — ${SEEDS} mondes indépendants, ${TICKS} ticks, ${FOUNDERS} fondateurs\n`,
);
console.log(" graine | pop finale | gén. max | gén. basses | gén. hautes | écart");

const improvements: number[] = [];
for (let k = 0; k < SEEDS; k++) {
  const seed = 1000 + k * 7717;
  const r = runSeed(seed);
  improvements.push(r.improvement);
  console.log(
    ` ${String(seed).padStart(6)} | ${String(r.population).padStart(10)} | ` +
      `${String(r.maxGen).padStart(8)} | ${fmt(r.low).padStart(11)} | ${fmt(r.high).padStart(11)} | ` +
      `${r.improvement >= 0 ? "+" : ""}${fmt(r.improvement)} %`,
  );
}

improvements.sort((a, b) => a - b);
const meanImp = improvements.reduce((a, b) => a + b, 0) / improvements.length;
const median = improvements[improvements.length >> 1]!;
const positive = improvements.filter((v) => v > 0).length;

console.log(
  `\nÉcart moyen : ${meanImp >= 0 ? "+" : ""}${fmt(meanImp)} %  ·  médiane : ` +
    `${median >= 0 ? "+" : ""}${fmt(median)} %  ·  ${positive}/${improvements.length} mondes en amélioration`,
);
console.log(
  "La dispersion est attendue : sur quelques milliers de ticks une lignée peut\n" +
    "exploser ou s'éteindre par accident. C'est la TENDANCE sur plusieurs mondes\n" +
    "qui constitue la preuve, jamais un run isolé.",
);
