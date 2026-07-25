import type { InferenceUsage, ModelId } from "@devot/shared";
import { LETHALITY, PRICE_PER_MTOK } from "@devot/shared";

/**
 * Cœur de l'économie : convertit l'usage réel d'une inférence en dégâts de HP.
 * Le thinking est facturé en sortie, donc compté dedans. Les tokens lus depuis
 * le cache coûtent ~0,1× le prix d'entrée.
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
