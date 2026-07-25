import { AgentSdkChronicler, AgentSdkMind } from "./agentSdkMind.js";
import { AnthropicChronicler } from "./chronicler.js";
import type { Chronicler } from "./chronicler.js";
import { MockChronicler } from "./chronicler.js";
import { AnthropicMind, MockMind, type MindProvider } from "./mind.js";

export type MindKind = "claude" | "api" | "mock";

/**
 * Choix du backend des esprits :
 * - MIND=claude → abonnement Claude Code via l'Agent SDK (aucune clé, défaut)
 * - MIND=api    → Messages API pay-per-token (ANTHROPIC_API_KEY requis)
 * - MIND=mock   → esprits simulés, hors-ligne, 0 dépense
 * Sans MIND explicite : une clé API présente → api, sinon → claude.
 */
export function resolveMindKind(env: NodeJS.ProcessEnv = process.env): MindKind {
  const explicit = env.MIND ?? env.DEVOT_MIND;
  if (explicit === "mock" || env.DEVOT_MOCK === "1") return "mock";
  if (explicit === "api") return "api";
  if (explicit === "claude") return "claude";
  if (usableApiKey(env)) return "api";
  return "claude";
}

/** Ignore les clés vides ou le placeholder `sk-ant-...` copié du .env.example. */
function usableApiKey(env: NodeJS.ProcessEnv): boolean {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return !!key && key !== "sk-ant-..." && !key.endsWith("...");
}

export function createMind(env: NodeJS.ProcessEnv = process.env): {
  kind: MindKind;
  mind: MindProvider;
  chronicler: Chronicler;
} {
  const kind = resolveMindKind(env);
  const script = env.DEVOT_MOCK_SCRIPT?.split(",").map((action) => ({
    action: action.trim() as never,
  }));
  switch (kind) {
    case "mock":
      return { kind, mind: new MockMind(script), chronicler: new MockChronicler() };
    case "api":
      return { kind, mind: new AnthropicMind(), chronicler: new AnthropicChronicler() };
    case "claude":
      if (env.ANTHROPIC_API_KEY) {
        console.warn(
          "[agents] MIND=claude : ANTHROPIC_API_KEY détectée mais ignorée — les esprits utilisent l'abonnement Claude Code (mets MIND=api pour utiliser la clé).",
        );
      }
      return {
        kind,
        mind: new AgentSdkMind(env.DEVOT_MODEL),
        chronicler: new AgentSdkChronicler(),
      };
  }
}
