import type { InferenceUsage, ModelId } from "@devot/shared";
import { LETHALITY, PRICE_PER_MTOK } from "@devot/shared";

/**
 * Heart of the economy: converts an inference's real usage into HP damage.
 * Thinking is billed as output, so it is counted there. Tokens read from the
 * cache cost ~0.1× the input price.
 */
export function hpCost(usage: InferenceUsage, model: ModelId): number {
  const p = PRICE_PER_MTOK[model];
  const usd =
    (usage.inputTokens / 1e6) * p.in +
    (usage.cacheReadInputTokens / 1e6) * p.in * 0.1 +
    (usage.cacheCreationInputTokens / 1e6) * p.in * 1.25 +
    (usage.outputTokens / 1e6) * p.out;
  return usd * LETHALITY;
}
