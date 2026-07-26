import type { CognitionProfile, CognitionProfileName } from "@devot/shared";

/**
 * Model tier = temperament × endurance (ARCHITECTURE.md §7.2).
 * A prophet thinks better but bleeds faster.
 */
export const PROFILES: Record<CognitionProfileName, CognitionProfile> = {
  frugal: {
    name: "frugal",
    model: "claude-haiku-4-5",
    // No thinking: effort/adaptive are not supported on Haiku 4.5.
    maxTokens: 512,
  },
  balanced: {
    name: "balanced",
    model: "claude-sonnet-4-6",
    thinking: { type: "adaptive" },
    effort: "low",
    maxTokens: 1024,
  },
  prophet: {
    name: "prophet",
    model: "claude-opus-4-8",
    thinking: { type: "adaptive" },
    effort: "medium",
    maxTokens: 2048,
  },
};
