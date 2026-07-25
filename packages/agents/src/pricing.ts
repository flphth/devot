import { MICRO_PER_USD_DEV, type AnthropicModelId, type Price } from "@devot/shared";

/**
 * The published Anthropic rates, in USD per 1,000,000 tokens (in / out).
 * Anthropic-only — the 0G mind never reads this; it derives its price from the
 * provider's on-chain neuron rate. So this table constrains Anthropic alone,
 * never the open 0G catalogue.
 */
const USD_PER_MTOK: Record<AnthropicModelId, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 5, out: 25 },
};

/**
 * The goal's `PRICE_PER_MTOK`, converted to the game's µ-unit denomination via
 * the dev bridge {@link MICRO_PER_USD_DEV}. Values are µ-units per 1M tokens.
 */
export const PRICE_PER_MTOK: Record<AnthropicModelId, Price> = Object.fromEntries(
  Object.entries(USD_PER_MTOK).map(([model, usd]) => [
    model,
    { in: usd.in * MICRO_PER_USD_DEV, out: usd.out * MICRO_PER_USD_DEV },
  ]),
) as Record<AnthropicModelId, Price>;

/**
 * Price for an Anthropic model id. Unknown ids fall back to the most expensive
 * tier (Opus) so a mis-tagged model can never under-charge a devot's life.
 */
export function anthropicPrice(model: string): Price {
  return PRICE_PER_MTOK[model as AnthropicModelId] ?? PRICE_PER_MTOK["claude-opus-4-8"];
}
