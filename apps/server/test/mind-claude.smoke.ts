/**
 * Smoke test MIND=claude : une vraie pensée via l'abonnement Claude Code
 * (Agent SDK, modèle Haiku — consommation de quota négligeable, zéro clé API).
 */
import { AgentSdkMind, PROFILES } from "@devot/agents";
import type { DevotEntity } from "@devot/shared";

const devot: DevotEntity = {
  id: "devot-smoke",
  godId: "god-smoke",
  isFounder: true,
  name: "Écho",
  pos: { x: 0, y: 0, z: 0 },
  hp: 42_000,
  hpMax: 50_000,
  state: "vivant",
  profile: "frugal",
  traits: ["curieux", "économe"],
  age: 12,
  thinking: false,
  utterance: "",
  currentGoal: { kind: "wander" },
};

const mind = new AgentSdkMind();
const started = Date.now();
const result = await mind.think(
  devot,
  PROFILES.frugal,
  [],
  'Tu aperçois de la nourriture (grain, id "food-7") non loin de toi, vers x=3.0, z=1.5.',
);

console.log(`✓ pensée en ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(`  décision : ${JSON.stringify(result.decision)}`);
console.log(
  `  usage : ${result.usage.inputTokens} in / ${result.usage.outputTokens} out (cache read ${result.usage.cacheReadInputTokens})`,
);

if (!result.decision.action) {
  console.error("✗ pas d'action");
  process.exit(1);
}
console.log("SMOKE MIND=CLAUDE OK");
