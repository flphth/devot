import type { AnthropicModelId, Price } from "@devot/shared";

/**
 * The ONLY static price table, and it covers Anthropic models exclusively.
 * The 0G mind never reads this — it derives its {@link Price} from the
 * provider's on-chain service listing. So this table constrains Anthropic
 * only and never the open 0G catalogue.
 *
 * USD per 1,000,000 tokens (in / out).
 */
export const PRICE_PER_MTOK: Record<AnthropicModelId, Price> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 5, out: 25 },
};

/**
 * Price for an Anthropic model id. Unknown ids fall back to the most expensive
 * tier (Opus) so a mis-tagged model can never under-charge a devot's life.
 */
export function anthropicPrice(model: string): Price {
  return PRICE_PER_MTOK[model as AnthropicModelId] ?? PRICE_PER_MTOK["claude-opus-4-8"];
}
