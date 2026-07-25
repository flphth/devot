import { anthropicPrice } from "../pricing.ts";
import type { MindProvider, ThinkRequest, ThinkResult } from "../types.ts";

/**
 * `claude` — the devot's mind on the Claude Code Max subscription via the
 * Claude Agent SDK (OAuth, no pay-per-token key). Named and selectable so the
 * four minds (claude/api/mock/0g) are all first-class, but the Agent SDK wiring
 * is deferred past the G1 foundation: it needs one-shot query + usage
 * extraction that is out of scope for the mortal-core proof.
 *
 * Until then it fails loudly instead of pretending. For headless runs use
 * MIND=mock (offline), MIND=api (pay-per-token), or MIND=0g (the prize path).
 */
export class ClaudeAgentMind implements MindProvider {
  readonly name = "claude" as const;

  async think(_req: ThinkRequest): Promise<ThinkResult> {
    // Referenced so the module's intent (economy still prices the subscription
    // notionally) is explicit and typechecked.
    void anthropicPrice;
    throw new Error(
      "MIND=claude (Agent SDK / Max OAuth) is not wired in the P0 foundation yet. " +
        "Use MIND=mock, MIND=api, or MIND=0g.",
    );
  }
}
