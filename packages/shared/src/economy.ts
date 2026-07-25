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
 * A price for one model, expressed in **USD per 1,000,000 tokens** for input
 * and output. This is the single currency in which every mind quotes cost:
 * Anthropic minds read it from a static table (`PRICE_PER_MTOK`), the 0G mind
 * derives it from the provider's on-chain service listing. `hpCost` consumes a
 * `Price` and never a model id, so no frozen table constrains the models.
 */
export interface Price {
  /** USD per 1M input tokens. */
  in: number;
  /** USD per 1M output tokens. */
  out: number;
}

/**
 * A devot's life is a real deposited balance denominated in **micro-USD of
 * inference** (µ$). 50_000 µ$ = 0.05 $ of thinking. Kept as an integer to stay
 * exact — the wei ↔ µ$ boundary (G2/G3) lives elsewhere; the sim never uses
 * floats for balances.
 */
export type MicroUsd = number;

/** 1 USD expressed in µ$. */
export const MICRO_USD_PER_USD = 1_000_000;
