import type { Decision, ModelId, Price, TokenUsage } from "@devot/shared";

/** The kinds of mind a devot can be animated by. */
export type MindName = "claude" | "api" | "mock" | "0g";

export interface MindMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Everything a mind needs to produce one thought. The system prompt holds the
 * (cacheable) world rules + persona; untrusted content (divine 140c, other
 * devots' words) is already folded into `event` as a user turn.
 */
export interface ThinkRequest {
  system: string;
  history: MindMessage[];
  event: string;
  model: ModelId;
  maxTokens?: number;
  /** Adaptive thinking hint, for providers that support it (Anthropic). */
  thinking?: { type: "adaptive" } | { type: "disabled" };
  /** Effort cursor (intelligence ⇄ longevity), for providers that support it. */
  effort?: "low" | "medium" | "high";
}

/**
 * Proof that an inference ran inside a genuine TEE. Produced by the 0G mind via
 * `broker.inference.processResponse(provider, chatId, content)`. Persisted with
 * the thought and shown in the Esprit panel.
 */
export interface TeeProof {
  /** Result of the on-chain TEE signature verification. */
  verified: boolean;
  /** The chat id verified (response `id` or the `ZG-Res-Key` header). */
  chatId: string;
  /** The 0G provider address that served the inference. */
  provider: string;
}

/** The outcome of one thought. */
export interface ThinkResult {
  decision: Decision;
  usage: TokenUsage;
  /** The price (USD/1M tok) used to value this thought — feeds `hpCost`. */
  price: Price;
  /** Raw model text, for the journal / debugging. */
  raw: string;
  /** True if the JSON repair path was needed (portable structured output). */
  repaired: boolean;
  /** Present only for verifiable providers (0G). */
  tee?: TeeProof;
  model: ModelId;
}

export interface MindProvider {
  readonly name: MindName;
  think(req: ThinkRequest): Promise<ThinkResult>;
  /** Release any long-lived resources (broker connections, SDK clients). */
  close?(): Promise<void>;
}
