import type { CognitionProfile, CognitionProfileName } from "@devot/shared";

/**
 * Palier de modèles = tempérament × endurance (ARCHITECTURE.md §7.2).
 * Un prophète pense mieux mais saigne plus vite.
 */
export const PROFILES: Record<CognitionProfileName, CognitionProfile> = {
  frugal: {
    name: "frugal",
    model: "claude-haiku-4-5",
    // Pas de thinking : effort/adaptive non supportés sur Haiku 4.5.
    maxTokens: 512,
  },
  equilibre: {
    name: "equilibre",
    model: "claude-sonnet-4-6",
    thinking: { type: "adaptive" },
    effort: "low",
    maxTokens: 1024,
  },
  prophete: {
    name: "prophete",
    model: "claude-opus-4-8",
    thinking: { type: "adaptive" },
    effort: "medium",
    maxTokens: 2048,
  },
};
