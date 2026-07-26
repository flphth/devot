/**
 * Smoke test MIND=claude: one real thought through the Claude Code
 * subscription (Agent SDK, Haiku — negligible quota, zero API key).
 */
import { AgentSdkMind, PROFILES } from "@devot/agents";
import type { DevotEntity } from "@devot/shared";
import { devotSubject } from "@devot/shared";

const devot: DevotEntity = {
  id: "devot-smoke",
  godId: "god-smoke",
  isFounder: true,
  name: "Echo",
  pos: { x: 0, y: 0, z: 0 },
  hp: 42_000,
  hpMax: 50_000,
  state: "alive",
  profile: "frugal",
  traits: ["curious", "thrifty"],
  age: 12,
  thinking: false,
  utterance: "",
  currentGoal: { kind: "wander" },
};

const mind = new AgentSdkMind();
const started = Date.now();
const result = await mind.think(
  devotSubject(devot),
  PROFILES.frugal,
  [],
  'You spot food (grain, id "food-7") not far from you, towards x=3.0, z=1.5.',
);

console.log(`✓ thought in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(`  decision: ${JSON.stringify(result.decision)}`);
console.log(
  `  usage: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out (cache read ${result.usage.cacheReadInputTokens})`,
);

if (!result.decision.action) {
  console.error("✗ no action");
  process.exit(1);
}
console.log("SMOKE MIND=CLAUDE OK");
