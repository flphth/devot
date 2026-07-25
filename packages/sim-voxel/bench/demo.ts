/**
 * Démonstration headless du noyau P5.0 : un monde vit, des organismes
 * poussent, mangent, s'épuisent et se décomposent — et deux graines
 * identiques produisent exactement la même histoire.
 *
 * Usage : pnpm --filter @devot/sim-voxel demo
 */
import {
  BIOMASS,
  MATERIAL_NAMES,
  PLAN_GRAZER,
  PLAN_THINKER,
  PLAN_WORM,
  SX,
  SY,
  SZ,
  SeededRng,
  VoxelWorld,
  collectStats,
  damageVoxel,
  findSpawnSpot,
  registerPlan,
  spawnOrganism,
  stepN,
  worldHash,
} from "../src/index.js";

const SEED = 20260725;
const POPULATION = 40;

function log(msg: string): void {
  console.log(msg);
}

function fmt(n: number, d = 0): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function build(seed: number): { w: VoxelWorld; ids: number[] } {
  const w = new VoxelWorld(seed);
  w.generateTerrain();
  const plans = [
    registerPlan(w, PLAN_GRAZER),
    registerPlan(w, PLAN_WORM),
    registerPlan(w, PLAN_THINKER),
  ];
  const rng = new SeededRng(seed ^ 0x1234);
  const ids: number[] = [];
  for (let n = 0; n < POPULATION; n++) {
    const spot = findSpawnSpot(w, rng);
    if (!spot) continue;
    const id = spawnOrganism(w, plans[n % plans.length]!, spot.x, spot.y, spot.z);
    if (id > 0) ids.push(id);
  }
  return { w, ids };
}

log(`Monde ${SX}×${SY}×${SZ} — graine ${SEED}`);
const { w, ids } = build(SEED);
const s0 = collectStats(w);
log(
  `Naissance de ${ids.length} organismes (brouteurs, vers, penseurs) sur un terrain ` +
    `de ${fmt(s0.biomassVoxels)} voxels de biomasse.`,
);

// ── Morphogenèse observable sur un individu ─────────────────────────────────
const subject = ids[0]!;
log(`Suivi de l'organisme #${subject} (${fmt(w.bodyLen[subject]!)} voxel au départ) :`);
for (let k = 0; k < 5; k++) {
  stepN(w, 1);
  const base = w.bodySlot(subject);
  const parts: string[] = [];
  for (let j = 0; j < w.bodyLen[subject]!; j++) {
    parts.push(MATERIAL_NAMES[w.material[w.bodyList[base + j]!]!]!);
  }
  log(
    `  tick ${String(w.tick).padStart(3)} : ${w.bodyLen[subject]} voxels [${parts.join(", ")}] ` +
      `— énergie ${fmt(w.energy[subject]!)}/${fmt(w.capacity[subject]!)}`,
  );
}

// ── Amputation et cicatrisation ─────────────────────────────────────────────
const base = w.bodySlot(subject);
const limb = w.bodyList[base + w.bodyLen[subject]! - 1]!;
log(
  `\nOn arrache un membre de #${subject} (${MATERIAL_NAMES[w.material[limb]!]}) : ` +
    `${damageVoxel(w, limb) ? "détruit" : "échec"}`,
);
stepN(w, 1);
log(`  après connexité + cicatrisation : ${w.bodyLen[subject]} voxels`);
stepN(w, 4);
log(`  4 ticks plus tard : ${w.bodyLen[subject]} voxels (le plan se reconstitue)`);

// ── Le monde vit : famine, décomposition, repousse ──────────────────────────
log("\nÉvolution du monde :");
log("  tick | vivants | énergie totale | corps moy. | biomasse | empreinte");
for (let k = 0; k < 10; k++) {
  stepN(w, 60);
  const s = collectStats(w);
  log(
    `  ${String(s.tick).padStart(4)} | ${String(s.population).padStart(7)} | ` +
      `${fmt(s.totalEnergy).padStart(14)} | ${fmt(s.avgBodyVoxels, 1).padStart(10)} | ` +
      `${fmt(s.biomassVoxels).padStart(8)} | ${worldHash(w).toString(16).padStart(8, "0")}`,
  );
}

const sEnd = collectStats(w);
log(
  `\nAprès ${sEnd.tick} ticks : ${sEnd.population} survivants sur ${ids.length}. ` +
    `Les morts se sont décomposés en biomasse — la matière circule.`,
);

// ── Déterminisme : la même graine rejoue la même histoire ───────────────────
// Sur une paire de mondes VIERGES : celui du dessus a été amputé à la main,
// il ne peut donc pas servir de référence.
const TICKS = 400;
const { w: runA } = build(SEED);
const { w: runB } = build(SEED);
stepN(runA, TICKS);
stepN(runB, TICKS);
const hA = worldHash(runA);
const hB = worldHash(runB);
log(
  `\nDéterminisme — deux mondes de graine ${SEED} sur ${TICKS} ticks : ` +
    `${hA === hB ? "empreintes IDENTIQUES" : "DIVERGENCE"} ` +
    `(${hA.toString(16)} / ${hB.toString(16)})`,
);
if (hA !== hB) process.exitCode = 1;

const { w: other } = build(SEED + 1);
stepN(other, TICKS);
log(
  `Graine voisine ${SEED + 1} : ${
    worldHash(other) === hA ? "empreinte IDENTIQUE (anormal)" : "empreinte différente, comme attendu"
  }`,
);
