import Anthropic from "@anthropic-ai/sdk";
import type { CognitionProfile, Decision, DevotEntity, InferenceUsage } from "@devot/shared";
import { DECISION_SCHEMA, ITEM_KINDS, parseDecision } from "@devot/shared";
import type { StoredMessage } from "@devot/db";
import { buildEventBlock, buildPersona, WORLD_RULES } from "./prompts.js";

export interface ThoughtResult {
  decision: Decision;
  usage: InferenceUsage;
  /** Raw assistant content to append to the history. */
  rawAssistantContent: unknown;
  /** User turn (the event) to append to the history. */
  userTurn: string;
}

/**
 * A devot's mind: produces a structured decision from its history and an event.
 * Injectable interface — real implementation (Claude) or fake (tests / demo
 * without a key).
 */
export interface MindProvider {
  think(
    devot: DevotEntity,
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
    devot: DevotEntity,
    profile: CognitionProfile,
    history: StoredMessage[],
    eventText: string,
  ): Promise<ThoughtResult> {
    const userTurn = buildEventBlock(devot, eventText);

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
          text: WORLD_RULES,
          cache_control: { type: "ephemeral" },
        },
        { type: "text", text: buildPersona(devot) },
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
 * Fake mind for tests and for the demo without an API key: plausible decisions,
 * simulated usage (so real HP damage in the loop).
 */
export class MockMind implements MindProvider {
  constructor(
    private script?: Array<Partial<Decision>>,
    private mockUsage: Partial<InferenceUsage> = {},
  ) {}

  private callCount = 0;

  async think(
    devot: DevotEntity,
    _profile: CognitionProfile,
    _history: StoredMessage[],
    eventText: string,
  ): Promise<ThoughtResult> {
    const scripted = this.script?.[this.callCount % (this.script.length || 1)];
    this.callCount++;

    // Targeting: reuses the first id quoted in the event (food, a devot just
    // met, an attacker…) for the actions that require a target.
    const quotedId = /id "([^"]+)"/.exec(eventText)?.[1];

    const decision: Decision = scripted
      ? {
          action: "idle",
          targetId: quotedId,
          // Forging requires naming the item. Without this pick, a "craft"
          // script would produce an incomplete decision the world would refuse,
          // and dev mode could never exercise the forge.
          item: ITEM_KINDS[this.callCount % ITEM_KINDS.length],
          thought: "I do what is written in me.",
          ...scripted,
        }
      : eventText.includes("food")
        ? {
            action: "move",
            direction: { x: 1, z: 0 },
            thought: "Eating buys thinking time.",
          }
        : { action: "idle", emotion: "wariness", thought: "Silence keeps me alive." };

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
      userTurn: buildEventBlock(devot, eventText),
    };
  }
}
