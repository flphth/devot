import { MICRO_USD_PER_USD, type MicroUsd, type Price, type TokenUsage } from "@devot/shared";

/**
 * Real monetary cost of one thought, in micro-USD (µ$), rounded UP.
 *
 * `hpCost` takes an explicit {@link Price} — never a model id indexing a frozen
 * table. Anthropic minds pass `PRICE_PER_MTOK[model]`; the 0G mind passes the
 * price it read from the provider's service listing. Rounding up guarantees a
 * thought is never free due to truncation (protects the deposited balance and
 * enforces a real "plancher de pensée").
 */
export function costMicroUsd(usage: TokenUsage, price: Price): MicroUsd {
  const usd =
    (usage.inputTokens / 1_000_000) * price.in +
    (usage.outputTokens / 1_000_000) * price.out;
  return Math.ceil(usd * MICRO_USD_PER_USD);
}

/**
 * The life cost of a thought = its real µ$ cost × `lethality`.
 *
 * `lethality` is the intelligence⇄longevity dial the design calls for. With the
 * default of 1, a devot's HP is literally its remaining µ$ of inference. G2
 * ("Recalibrer") re-measures this against a real 0G inference — do not guess it.
 */
export const LETHALITY_DEFAULT = 1;

export function hpCost(usage: TokenUsage, price: Price, lethality: number = LETHALITY_DEFAULT): MicroUsd {
  return Math.ceil(costMicroUsd(usage, price) * lethality);
}
