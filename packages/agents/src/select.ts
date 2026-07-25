import { AgentSdkChronicler, AgentSdkMind } from "./agentSdkMind.js";
import { AnthropicChronicler } from "./chronicler.js";
import type { Chronicler } from "./chronicler.js";
import { MockChronicler } from "./chronicler.js";
import { AnthropicMind, MockMind, type MindProvider } from "./mind.js";

export type MindKind = "claude" | "api" | "mock";

/**
 * Choice of mind backend:
 * - MIND=claude -> Claude Code subscription via the Agent SDK (no key, default)
 * - MIND=api    -> Messages API pay-per-token (ANTHROPIC_API_KEY required)
 * - MIND=mock   -> simulated minds, offline, zero spend
 * With no explicit MIND: an API key present -> api, otherwise -> claude.
 */
export function resolveMindKind(env: NodeJS.ProcessEnv = process.env): MindKind {
  const explicit = env.MIND ?? env.DEVOT_MIND;
  if (explicit === "mock" || env.DEVOT_MOCK === "1") return "mock";
  if (explicit === "api") return "api";
  if (explicit === "claude") return "claude";
  if (usableApiKey(env)) return "api";
  return "claude";
}

/** Ignores empty keys or the `sk-ant-...` placeholder copied from .env.example. */
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
          "[agents] MIND=claude: ANTHROPIC_API_KEY detected but ignored — minds run on the Claude Code subscription (set MIND=api to use the key).",
        );
      }
      return {
        kind,
        mind: new AgentSdkMind(env.DEVOT_MODEL),
        chronicler: new AgentSdkChronicler(),
      };
  }
}
