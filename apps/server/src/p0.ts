/**
 * P0 — Mortal core (headless demo, no 3D).
 *
 * Proves the central mechanic: one devot, a 250 ms tick, structured inferences,
 * HP falling with real usage, death + destruction of the context.
 *
 * Mind backend (see .env.example): Claude Code subscription (default), Messages
 * API (MIND=api + key), or simulated (MIND=mock / --mock).
 */
import { CognitionOrchestrator, PROFILES, createMind } from "@devot/agents";
import { createRepos, openDb } from "@devot/db";
import { FreeStubProvider } from "@devot/onchain";
import type { DevotEntity, FoodEntity } from "@devot/shared";
import { FOOD_TTL_MS, TICK_MS, devotSubject } from "@devot/shared";
import { applyDecision, perceptionSystem, tick, World } from "@devot/sim";

if (process.argv.includes("--mock")) process.env.MIND = "mock";
const DB_PATH = new URL("../p0.sqlite", import.meta.url).pathname;
const MAX_RUN_MS = 90_000;
// hp_max lowered for the demo: ~4-5 thoughts before death.
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

  // 1. The god shapes their founder (free through the stub).
  const godId = "god-demo";
  const receipt = await payments.chargeDevotCreation(godId);
  log(`Founder creation payment: ${receipt.ref}`);

  const founder: DevotEntity = {
    id: "devot-adam",
    godId,
    isFounder: true,
    name: "Adam",
    pos: { x: 0, y: 0, z: 0 },
    hp: DEMO_HP_MAX,
    hpMax: DEMO_HP_MAX,
    state: "alive",
    profile: "frugal",
    traits: ["curious", "sparing with their thoughts"],
    identityJson: "",
    items: [],
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "wander" },
  };
  world.devots.set(founder.id, founder);
  repos.devots.insertFromEntity(founder);
  repos.events.record("birth", [founder.id], { founder: true });
  log(`Birth of ${founder.name} (${founder.hp} HP = $${(founder.hp / 1e6).toFixed(4)} of thinking)`);

  // 2. The mind: Claude Code subscription (default), API (key), or mock.
  const { kind, mind } = createMind();
  log(
    `Mind: ${
      kind === "claude"
        ? "Claude Code subscription (Agent SDK)"
        : kind === "api"
          ? "Claude Messages API (key)"
          : "MockMind (simulated)"
    }`,
  );

  const orchestrator = new CognitionOrchestrator(
    mind,
    (id) => {
      const devot = world.devots.get(id);
      if (!devot) return undefined;
      return {
        entity: devot,
        subject: devotSubject(devot),
        profile: PROFILES[devot.profile],
        memory: repos.messages,
      };
    },
    ({ devotId, decision, hpLoss }) => {
      const d = world.devots.get(devotId);
      if (!d) return;
      applyDecision(d, decision, world);
      log(
        `${d.name} thought → ${decision.action}` +
          (decision.utterance ? ` « ${decision.utterance} »` : "") +
          ` | cost ${hpLoss.toFixed(0)} HP | ${Math.max(0, d.hp).toFixed(0)}/${d.hpMax} HP left`,
      );
      if (decision.utterance) d.utterance = decision.utterance;
    },
  );

  // 3. Sparse initial food.
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
      spawnedAt: Date.now(),
      ttlMs: FOOD_TTL_MS.grain!,
    };
    world.food.set(f.id, f);
  };
  for (let i = 0; i < 3; i++) spawnFood();

  // 4. Simulation loop: the body at 250 ms, the mind in the background.
  const start = Date.now();
  let tickCount = 0;

  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      tickCount++;
      const result = tick(world);

      for (const { devotId, foodId, hpValue } of result.eaten) {
        const d = world.devots.get(devotId);
        log(`${d?.name ?? devotId} eats ${foodId} (+${hpValue} HP -> ${d?.hp.toFixed(0)})`);
        repos.events.record("meal", [devotId], { foodId, hpValue });
      }

      for (const t of [...result.triggers, ...perceptionSystem(world)]) {
        orchestrator.enqueue(t);
      }

      // Periodic idle reflection (every ~3 s) to keep the demo alive.
      if (tickCount % 12 === 0) {
        for (const d of world.aliveDevots()) {
          orchestrator.enqueue({
            kind: "idle_reflection",
            devotId: d.id,
            eventText:
              "Nothing notable is happening. You may meditate on your condition, act, or spare your life.",
            createdAt: Date.now(),
          });
        }
      }

      // Periodic snapshot of the hot state (1 s).
      if (tickCount % 4 === 0) {
        for (const d of world.devots.values()) repos.devots.snapshot(d);
      }

      for (const { devotId, cause } of result.deaths) {
        const d = world.devots.get(devotId);
        const ctxBefore = repos.devots.contextSize(devotId);
        repos.devots.kill(devotId, cause);
        const ctxAfter = repos.devots.contextSize(devotId);
        log(`x ${d?.name ?? devotId} is dead (${cause}).`);
        log(
          `  Context destroyed: ${ctxBefore} messages → ${ctxAfter}. ` +
            `Nothing is left but the gravestone and what the world remembers.`,
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
    `End of run: ${tickCount} ticks, final state of ${founder.name}: ` +
      `${row?.state} (died_at=${row?.diedAt ?? "-"}), context=${repos.devots.contextSize(founder.id)} messages.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
