/**
 * Smoke test: a MONSTER thinks through the Claude Code subscription.
 *
 * Worth its own smoke test because a monster reads a different rulebook than a
 * devot (MONSTER_RULES, no reproduction, hunger as a constant) and takes a
 * different path through buildPersona — one Haiku call, negligible quota.
 */
import { AgentSdkMind, PROFILES } from "@devot/agents";
import type { MonsterEntity } from "@devot/shared";
import { monsterSubject } from "@devot/shared";

const monster: MonsterEntity = {
  id: "monster-smoke",
  name: "Gnaw-smoke",
  pos: { x: 2, y: 0, z: -3 },
  hp: 21_000,
  hpMax: 60_000,
  state: "alive",
  age: 40,
  thinking: false,
  utterance: "",
  currentGoal: { kind: "prowl" },
  lastThoughtAt: 0,
};

const mind = new AgentSdkMind();
const started = Date.now();
const result = await mind.think(
  monsterSubject(monster),
  PROFILES.frugal,
  [],
  'You catch sight of a devot, Adam (id "devot-adam"), at x=4.0, z=-2.0. It looks starving. You are at 35% of your own life, and it is draining.',
);

console.log(`✓ thought in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(`  decision: ${JSON.stringify(result.decision)}`);
console.log(
  `  usage: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`,
);

if (!result.decision.action) {
  console.error("✗ no action");
  process.exit(1);
}
// A monster is never allowed to breed, whatever it answers; the simulation
// drops the action, but a model choosing it would mean the rules did not land.
if (result.decision.action === "reproduce") {
  console.error("✗ the monster tried to reproduce — MONSTER_RULES did not land");
  process.exit(1);
}
console.log("SMOKE MIND=MONSTER OK");
