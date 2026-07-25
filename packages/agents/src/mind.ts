import Anthropic from "@anthropic-ai/sdk";
import type { CognitionProfile, Decision, DevotEntity, InferenceUsage } from "@devot/shared";
import { DECISION_SCHEMA, ITEM_KINDS, parseDecision } from "@devot/shared";
import type { StoredMessage } from "@devot/db";
import { buildEventBlock, buildPersona, WORLD_RULES } from "./prompts.js";

export interface ThoughtResult {
  decision: Decision;
  usage: InferenceUsage;
  /** Contenu brut assistant à append à l'historique. */
  rawAssistantContent: unknown;
  /** Tour utilisateur (événement) à append à l'historique. */
  userTurn: string;
}

/**
 * L'esprit d'un devot : produit une décision structurée à partir de son
 * historique et d'un événement. Interface injectable — implémentation réelle
 * (Claude) ou factice (tests / démo sans clé).
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
 * Esprit factice pour tests et démo sans clé API : décisions plausibles,
 * usage simulé (donc dégâts de HP réels dans la boucle).
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

    // Ciblage : réutilise le premier id cité dans l'événement (nourriture,
    // devot rencontré, agresseur…) pour les actions qui exigent une cible.
    const quotedId = /id "([^"]+)"/.exec(eventText)?.[1];

    const decision: Decision = scripted
      ? {
          action: "idle",
          targetId: quotedId,
          // Forger exige de nommer l'objet. Sans ce choix, un script « craft »
          // produirait une décision incomplète que le monde refuserait, et le
          // mode de développement ne pourrait jamais exercer la forge.
          item: ITEM_KINDS[this.callCount % ITEM_KINDS.length],
          thought: "I do what is written in me.",
          ...scripted,
        }
      : eventText.includes("nourriture")
        ? {
            action: "move",
            direction: { x: 1, z: 0 },
            thought: "Eating buys thinking time.",
          }
        : { action: "idle", emotion: "prudence", thought: "Le silence me garde en vie." };

    const usage: InferenceUsage = {
      inputTokens: this.mockUsage.inputTokens ?? 1200,
      outputTokens: this.mockUsage.outputTokens ?? 60,
      cacheReadInputTokens: this.mockUsage.cacheReadInputTokens ?? 0,
      cacheCreationInputTokens: this.mockUsage.cacheCreationInputTokens ?? 0,
    };

    // Simule la latence d'une vraie inférence (corps et esprit découplés).
    await new Promise((r) => setTimeout(r, 30));

    return {
      decision,
      usage,
      rawAssistantContent: [{ type: "text", text: JSON.stringify(decision) }],
      userTurn: buildEventBlock(devot, eventText),
    };
  }
}
