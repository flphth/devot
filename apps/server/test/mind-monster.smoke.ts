/**
 * Smoke test: a MONSTER thinks through the Claude Code subscription.
 *
 * Worth its own smoke test because a monster reads a different rulebook than a
 * devot (MONSTER_RULES, no reproduction, no forging, hunger as a constant) and
 * takes a different path through buildPersona — one Haiku call, negligible quota.
 */
import { AgentSdkMind, PROFILES } from "@devot/agents";
import type { MonsterEntity } from "@devot/shared";
import { monsterSubject } from "@devot/shared";

const monster: MonsterEntity = {
  id: "monster-smoke",
  name: "Beast-smoke",
  pos: { x: 2, y: 0, z: -3 },
  hp: 21_000,
  hpMax: 60_000,
  hoard: 48_000,
  state: "alive",
  age: 40,
  thinking: false,
  utterance: "",
  lastThoughtAt: 0,
};

const mind = new AgentSdkMind();
const started = Date.now();
const result = await mind.think(
  monsterSubject(monster),
  PROFILES.frugal,
  [],
  `You are at 35% of your life and it is draining while you prowl.

Living things within reach:
- Adam (id "devot-adam"), 3.0 away, at 22% of its life, dying
- Eve (id "devot-eve"), 9.0 away, at 95% of its life — COMING FOR YOU`,
);

console.log(`✓ thought in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(`  decision: ${JSON.stringify(result.decision)}`);
console.log(`  usage: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);

if (!result.decision.action) {
  console.error("✗ no action");
  process.exit(1);
}
// A monster neither breeds nor forges, whatever it answers. The simulation
// drops those actions anyway, but a model choosing one means the rules did not
// land — which is the thing this smoke test exists to catch.
if (result.decision.action === "reproduce" || result.decision.action === "craft") {
  console.error(`✗ the monster chose ${result.decision.action} — MONSTER_RULES did not land`);
  process.exit(1);
}
console.log("SMOKE MIND=MONSTER OK");
