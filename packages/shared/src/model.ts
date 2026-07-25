/**
 * A model identifier. Deliberately a bare `string`: 0G Compute exposes an
 * open, changing catalogue of models (llama-3.3-70b, deepseek-r1, gpt-oss, …)
 * whose ids we cannot enumerate ahead of time. Pricing is therefore never
 * looked up from a frozen table keyed by a constrained union — it is always
 * supplied as an explicit {@link Price} (see `hpCost`).
 */
export type ModelId = string;

/**
 * The Anthropic models we DO know statically — used only to attach a default
 * per-model price when the `api` / `claude` minds run. It never constrains
 * {@link ModelId}, so 0G models remain first-class.
 */
export type AnthropicModelId =
  | "claude-haiku-4-5"
  | "claude-sonnet-4-6"
  | "claude-opus-4-8";

/** The three cognition profiles from the design (tempérament × endurance). */
export type ModelTier = "frugal" | "equilibre" | "prophete";
