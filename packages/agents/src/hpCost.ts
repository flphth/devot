import type { Micro, Price, TokenUsage } from "@devot/shared";

/**
 * The real cost of one thought, in **µ-units** (the deposited-token
 * denomination), rounded UP.
 *
 * `costMicro` takes an explicit {@link Price} (µ-units per 1M tokens) — never a
 * model id indexing a frozen table. The 0G mind passes a price derived from the
 * provider's on-chain neuron rate; Anthropic minds pass their converted table.
 * Rounding up guarantees a thought is never free due to truncation (protects
 * the deposited balance and enforces a real "plancher de pensée").
 */
export function costMicro(usage: TokenUsage, price: Price): Micro {
  const cost = (usage.inputTokens / 1_000_000) * price.in + (usage.outputTokens / 1_000_000) * price.out;
  return Math.ceil(cost);
}

/**
 * The life cost of a thought = its real µ-unit cost × `lethality`.
 *
 * With the default of 1, a devot's balance is literally its remaining µ of
 * inference. G2 recalibration tunes lethality/metabolism against a real 0G
 * inference (measured: ~385 µ per thought on qwen2.5-omni-7b) — not guessed.
 */
export const LETHALITY_DEFAULT = 1;

export function hpCost(usage: TokenUsage, price: Price, lethality: number = LETHALITY_DEFAULT): Micro {
  return Math.ceil(costMicro(usage, price) * lethality);
}
