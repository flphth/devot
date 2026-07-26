import Anthropic from "@anthropic-ai/sdk";
import type { CognitionProfile, Decision, InferenceUsage, ThoughtSubject } from "@devot/shared";
import { DECISION_SCHEMA, parseDecision } from "@devot/shared";
import type { StoredMessage } from "@devot/db";
import { buildEventBlock, buildPersona, rulesFor } from "./prompts.js";

export interface ThoughtResult {
  decision: Decision;
  usage: InferenceUsage;
  /** Raw assistant content to append to the history. */
  rawAssistantContent: unknown;
  /** User turn (the event) to append to the history. */
  userTurn: string;
}

/**
 * A creature's mind: produces a structured decision from its history and an
 * event. Takes a ThoughtSubject rather than an entity, which is what lets the
 * same implementation drive both a devot and a monster — they read different
 * rules, but they think through the same door.
 *
 * Injectable interface — real implementation (Claude) or fake one (tests /
 * demo without a key).
 */
export interface MindProvider {
  think(
    subject: ThoughtSubject,
    profile: CognitionProfile,
    history: StoredMessage[],
    eventText: string,
  ): Promise<ThoughtResult>;
}

export class AnthropicMind implements MindProvider {
  private client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async think(
    subject: ThoughtSubject,
    profile: CognitionProfile,
    history: StoredMessage[],
    eventText: string,
  ): Promise<ThoughtResult> {
    const userTurn = buildEventBlock(subject, eventText);

    const messages = [
      ...history.map((m) => ({
        role: m.role,
        content: m.content as string | Anthropic.ContentBlockParam[],
      })),
      { role: "user" as const, content: userTurn },
    ];

    const res = await this.client.messages.create({
      model: profile.model,
      max_tokens: profile.maxTokens,
      ...(profile.thinking ? { thinking: profile.thinking } : {}),
      system: [
        {
          type: "text",
          text: rulesFor(subject),
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: buildPersona(subject) },
      ],
      messages,
      output_config: {
        ...(profile.effort ? { effort: profile.effort } : {}),
        format: { type: "json_schema", schema: DECISION_SCHEMA },
      },
    } as Anthropic.MessageCreateParamsNonStreaming);

    const textBlock = res.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    if (!textBlock) {
      throw new Error(`mind: no text block in response (stop=${res.stop_reason})`);
    }
    const decision = parseDecision(JSON.parse(textBlock.text));

    const usage: InferenceUsage = {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cacheReadInputTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: res.usage.cache_creation_input_tokens ?? 0,
    };

    return { decision, usage, rawAssistantContent: res.content, userTurn };
  }
}

/**
 * Fake mind for tests and for demoing without an API key: plausible decisions,
 * simulated usage (so the HP damage in the loop is real).
 */
export class MockMind implements MindProvider {
  constructor(
    private script?: Array<Partial<Decision>>,
    private mockUsage: Partial<InferenceUsage> = {},
  ) {}

  private callCount = 0;

  async think(
    subject: ThoughtSubject,
    _profile: CognitionProfile,
    _history: StoredMessage[],
    eventText: string,
  ): Promise<ThoughtResult> {
    const scripted = this.script?.[this.callCount % (this.script.length || 1)];
    this.callCount++;

    // Targeting: reuse the first id quoted in the event (food, a devot just
    // met, an attacker…) for the actions that require a target.
    const quotedId = /id "([^"]+)"/.exec(eventText)?.[1];

    const decision: Decision = scripted
      ? {
          action: "idle",
          targetId: quotedId,
          thought: "I do what is written in me.",
          ...scripted,
        }
      : eventText.includes("food")
        ? {
            action: "move",
            direction: { x: 1, z: 0 },
            thought: "Eating buys me more time to think.",
          }
        : { action: "idle", emotion: "caution", thought: "Silence keeps me alive." };

    const usage: InferenceUsage = {
      inputTokens: this.mockUsage.inputTokens ?? 1200,
      outputTokens: this.mockUsage.outputTokens ?? 60,
      cacheReadInputTokens: this.mockUsage.cacheReadInputTokens ?? 0,
      cacheCreationInputTokens: this.mockUsage.cacheCreationInputTokens ?? 0,
    };

    // Simulates the latency of a real inference (body and mind decoupled).
    await new Promise((r) => setTimeout(r, 30));

    return {
      decision,
      usage,
      rawAssistantContent: [{ type: "text", text: JSON.stringify(decision) }],
      userTurn: buildEventBlock(subject, eventText),
    };
  }
}
