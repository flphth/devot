/**
 * Real token usage reported by a mind after an inference.
 * Field names mirror the Anthropic Messages API (`usage.input_tokens`,
 * `usage.output_tokens`); the OpenAI-compatible 0G endpoint reports
 * `prompt_tokens` / `completion_tokens`, which the ZgMind normalises into this.
 * `thinking` tokens are billed as output and are already included in
 * `outputTokens`.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * A devot's life is a real balance denominated in **µ-units of the deposited
 * token** (µ, i.e. micro-OG once on-chain): 1 µ = 1e12 wei (see the wei↔µ
 * boundary). It is NOT micro-dollars — a devot literally holds a fraction of
 * what its god deposited, and each thought burns the real cost of that
 * inference. Kept as an integer so the sim stays exact; the chain side is wei.
 */
export type Micro = number;

/**
 * A price for one model, in **µ-units per 1,000,000 tokens** (in / out) — the
 * same denomination as a devot's balance. The 0G mind derives it from the
 * provider's on-chain neuron price (the real cost, no USD anywhere); Anthropic
 * minds convert their USD table through {@link MICRO_PER_USD_DEV} (dev only).
 * `hpCost` consumes a `Price` and never a model id, so no frozen table
 * constrains the open 0G catalogue.
 */
export interface Price {
  /** µ-units per 1M input tokens. */
  in: number;
  /** µ-units per 1M output tokens. */
  out: number;
}

/**
 * Dev-only bridge for Anthropic minds, which quote USD. The real economy is the
 * deposited 0G token; this just lets `api`/`mock`/`claude` price a thought in
 * the same µ-units. 1 USD ≙ 1e6 µ (so 1M Haiku input tokens ≈ 1 µ·… — see
 * pricing.ts). Not used by the 0G mind.
 */
export const MICRO_PER_USD_DEV = 1_000_000;
