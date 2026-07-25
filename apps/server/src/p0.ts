/**
 * P0 — Cœur mortel (démo headless, sans 3D).
 *
 * Prouve la mécanique centrale : un devot, tick 250 ms, inférences structurées,
 * HP qui descendent selon l'usage réel, mort + destruction du contexte.
 *
 * Avec ANTHROPIC_API_KEY (ou un profil `ant auth`) : vraies inférences Claude.
 * Sans : esprit factice (MockMind) — même boucle, usage simulé.
 * Forcer le mock : `pnpm p0 -- --mock`.
 */
import {
  AnthropicMind,
  CognitionOrchestrator,
  MockMind,
  type MindProvider,
} from "@devot/agents";
import { createRepos, openDb } from "@devot/db";
import { FreeStubProvider } from "@devot/onchain";
import type { DevotEntity, FoodEntity } from "@devot/shared";
import { TICK_MS } from "@devot/shared";
import { applyDecision, perceptionSystem, tick, World } from "@devot/sim";

const USE_MOCK = process.argv.includes("--mock") || !process.env.ANTHROPIC_API_KEY;
const DB_PATH = new URL("../p0.sqlite", import.meta.url).pathname;
const MAX_RUN_MS = 90_000;
// hp_max réduit pour la démo : ~4-5 pensées avant la mort.
const DEMO_HP_MAX = 6_000;

function log(msg: string): void {
  const t = new Date().toISOString().slice(11, 23);
  console.log(`[${t}] ${msg}`);
}

async function main(): Promise<void> {
  const db = openDb(DB_PATH);
  const repos = createRepos(db);
  const payments = new FreeStubProvider();
  const world = new World(30);

  // 1. Le dieu façonne son fondateur (gratuit via le stub).
  const godId = "god-demo";
  const receipt = await payments.chargeDevotCreation(godId);
  log(`Paiement création fondateur : ${receipt.ref}`);

  const founder: DevotEntity = {
    id: "devot-adam",
    godId,
    isFounder: true,
    name: "Adam",
    pos: { x: 0, y: 0, z: 0 },
    hp: DEMO_HP_MAX,
    hpMax: DEMO_HP_MAX,
    state: "vivant",
    profile: "frugal",
    traits: ["curieux", "économe de ses pensées"],
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "wander" },
  };
  world.devots.set(founder.id, founder);
  repos.devots.insertFromEntity(founder);
  repos.events.record("birth", [founder.id], { founder: true });
  log(`Naissance de ${founder.name} (${founder.hp} HP = ${(founder.hp / 1e6).toFixed(4)} $ de pensée)`);

  // 2. L'esprit : Claude si credentials, mock sinon.
  const mind: MindProvider = USE_MOCK ? new MockMind() : new AnthropicMind();
  log(`Esprit : ${USE_MOCK ? "MockMind (aucune clé API détectée)" : "Claude (Messages API)"}`);

  const orchestrator = new CognitionOrchestrator(
    mind,
    repos,
    (id) => world.devots.get(id),
    ({ devotId, decision, hpLoss }) => {
      const d = world.devots.get(devotId);
      if (!d) return;
      applyDecision(d, decision, world);
      log(
        `${d.name} a pensé → ${decision.action}` +
          (decision.utterance ? ` « ${decision.utterance} »` : "") +
          ` | coût ${hpLoss.toFixed(0)} HP | reste ${Math.max(0, d.hp).toFixed(0)}/${d.hpMax} HP`,
      );
      if (decision.utterance) d.utterance = decision.utterance;
    },
  );

  // 3. Nourriture initiale éparse.
  let foodSeq = 0;
  const spawnFood = () => {
    const f: FoodEntity = {
      id: `food-${foodSeq++}`,
      pos: {
        x: (Math.random() - 0.5) * 30,
        y: 0,
        z: (Math.random() - 0.5) * 30,
      },
      type: "grain",
      hpValue: 800,
      source: "spawn",
    };
    world.food.set(f.id, f);
  };
  for (let i = 0; i < 3; i++) spawnFood();

  // 4. Boucle de simulation : le corps à 250 ms, l'esprit en tâche de fond.
  const start = Date.now();
  let tickCount = 0;

  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      tickCount++;
      const result = tick(world);

      for (const { devotId, foodId, hpValue } of result.eaten) {
        const d = world.devots.get(devotId);
        log(`${d?.name ?? devotId} mange ${foodId} (+${hpValue} HP → ${d?.hp.toFixed(0)})`);
        repos.events.record("meal", [devotId], { foodId, hpValue });
      }

      for (const t of [...result.triggers, ...perceptionSystem(world)]) {
        orchestrator.enqueue(t);
      }

      // Réflexion oisive périodique (toutes les ~3 s) pour animer la démo.
      if (tickCount % 12 === 0) {
        for (const d of world.aliveDevots()) {
          orchestrator.enqueue({
            kind: "idle_reflection",
            devotId: d.id,
            eventText:
              "Rien de notable ne se passe. Tu peux méditer sur ta condition, agir, ou économiser ta vie.",
            createdAt: Date.now(),
          });
        }
      }

      // Snapshot périodique de l'état chaud (1 s).
      if (tickCount % 4 === 0) {
        for (const d of world.devots.values()) repos.devots.snapshot(d);
      }

      for (const { devotId, cause } of result.deaths) {
        const d = world.devots.get(devotId);
        const ctxBefore = repos.devots.contextSize(devotId);
        repos.devots.kill(devotId, cause);
        const ctxAfter = repos.devots.contextSize(devotId);
        log(`☠ ${d?.name ?? devotId} est mort (${cause}).`);
        log(
          `  Contexte détruit : ${ctxBefore} messages → ${ctxAfter}. ` +
            `Il ne reste que la pierre tombale et ce que le monde se souvient.`,
        );
      }

      const done =
        world.aliveDevots().length === 0 || Date.now() - start > MAX_RUN_MS;
      if (done) {
        clearInterval(interval);
        resolve();
      }
    }, TICK_MS);
  });

  const row = repos.devots.get(founder.id);
  log(
    `Fin de run : ${tickCount} ticks, état final de ${founder.name} : ` +
      `${row?.state} (died_at=${row?.diedAt ?? "—"}), contexte=${repos.devots.contextSize(founder.id)} messages.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
