import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CognitionProfile, DevotEntity, InferenceUsage } from "@devot/shared";
import { DECISION_SCHEMA, parseDecision } from "@devot/shared";
import type { StoredMessage } from "@devot/db";
import type { Chronicler, ChronicleResult } from "./chronicler.js";
import type { MindProvider, ThoughtResult } from "./mind.js";
import { buildEventBlock, buildPersona, WORLD_RULES } from "./prompts.js";

/**
 * Esprits animés par l'abonnement Claude Code (Agent SDK) : aucune clé API
 * pay-per-token — chaque pensée passe par les identifiants Claude Code de la
 * machine. L'usage réel (tokens) est toujours converti en dégâts de HP.
 *
 * Chaque pensée est une session éphémère : l'historique du devot est rejoué
 * dans le prompt sous forme de transcript (sa mémoire vit dans notre base).
 */
export class AgentSdkMind implements MindProvider {
  constructor(private modelOverride?: string) {}

  async think(
    devot: DevotEntity,
    profile: CognitionProfile,
    history: StoredMessage[],
    eventText: string,
  ): Promise<ThoughtResult> {
    const userTurn = buildEventBlock(devot, eventText);
    const transcript = renderTranscript(history);
    const prompt = transcript
      ? `## Ta mémoire (vécue jusqu'ici)\n${transcript}\n\n## Maintenant\n${userTurn}`
      : userTurn;

    const q = query({
      prompt,
      options: {
        systemPrompt: `${WORLD_RULES}\n\n${buildPersona(devot)}`,
        model: this.modelOverride ?? profile.model,
        maxTurns: 1,
        allowedTools: [],
        outputFormat: {
          type: "json_schema",
          schema: DECISION_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });

    for await (const message of q) {
      if (message.type !== "result") continue;
      if (message.subtype !== "success") {
        throw new Error(`agent-sdk: pensée échouée (${message.subtype})`);
      }
      const decision = parseDecision(
        message.structured_output ?? JSON.parse(message.result),
      );
      return {
        decision,
        usage: toUsage(message.usage),
        rawAssistantContent: [{ type: "text", text: JSON.stringify(decision) }],
        userTurn,
      };
    }
    throw new Error("agent-sdk: aucun résultat");
  }
}

/** Chroniqueur sur abonnement : condense les mémoires via une session Haiku. */
export class AgentSdkChronicler implements Chronicler {
  async chronicle(
    histories: Array<{ name: string; history: StoredMessage[] }>,
    purpose: "aging" | "inheritance",
  ): Promise<ChronicleResult> {
    const instruction =
      purpose === "aging"
        ? "Condense la vie de ce devot en un souvenir à la première personne (« je me souviens... »), 150 mots maximum. Garde l'essentiel : événements marquants, relations, leçons, peurs et espoirs."
        : "Fusionne les vies de ces parents en un héritage de souvenirs pour leur enfant, à la première personne (« je me souviens d'une vie que je n'ai pas vécue... »), 150 mots maximum.";

    const q = query({
      prompt: `${instruction}\n\n${histories
        .map((h) => `### Vie de ${h.name}\n${renderTranscript(h.history)}`)
        .join("\n\n")}`,
      options: {
        systemPrompt:
          "Tu es le chroniqueur d'un monde où des créatures pensantes vivent et meurent. Tu condenses leurs mémoires. Réponds uniquement par le souvenir condensé, sans préambule.",
        model: "claude-haiku-4-5",
        maxTurns: 1,
        allowedTools: [],
      },
    });

    for await (const message of q) {
      if (message.type !== "result") continue;
      if (message.subtype !== "success") {
        throw new Error(`agent-sdk: chronique échouée (${message.subtype})`);
      }
      return { summary: message.result.trim(), usage: toUsage(message.usage) };
    }
    throw new Error("agent-sdk: aucun résultat");
  }
}

function renderTranscript(history: StoredMessage[]): string {
  return history
    .map((m) => {
      const content =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${m.role === "user" ? "[événement]" : "[ta décision]"} ${content.slice(0, 500)}`;
    })
    .join("\n");
}

function toUsage(u: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): InferenceUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
  };
}
