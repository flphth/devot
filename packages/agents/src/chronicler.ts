import Anthropic from "@anthropic-ai/sdk";
import type { InferenceUsage } from "@devot/shared";
import type { StoredMessage } from "@devot/db";

export interface ChronicleResult {
  summary: string;
  usage: InferenceUsage;
}

/**
 * Le chroniqueur : un appel Haiku bon marché qui condense des historiques.
 * Deux usages : vieillir (compacter son propre passé) et hériter (fusionner
 * les mémoires des parents en souvenirs pour l'enfant).
 */
export interface Chronicler {
  chronicle(
    histories: Array<{ name: string; history: StoredMessage[] }>,
    purpose: "aging" | "inheritance",
  ): Promise<ChronicleResult>;
}

const CHRONICLER_MODEL = "claude-haiku-4-5";

function renderHistory(name: string, history: StoredMessage[]): string {
  const lines = history.map((m) => {
    const content =
      typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return `${m.role === "user" ? "événement" : "pensée"}: ${content.slice(0, 400)}`;
  });
  return `### Vie de ${name}\n${lines.join("\n")}`;
}

export class AnthropicChronicler implements Chronicler {
  private client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async chronicle(
    histories: Array<{ name: string; history: StoredMessage[] }>,
    purpose: "aging" | "inheritance",
  ): Promise<ChronicleResult> {
    const instruction =
      purpose === "aging"
        ? "Condense la vie de ce devot en un souvenir à la première personne (« je me souviens... »), 150 mots maximum. Garde l'essentiel : événements marquants, relations, leçons apprises, peurs et espoirs."
        : "Fusionne les vies de ces parents en un héritage de souvenirs pour leur enfant, à la première personne (« je me souviens d'une vie que je n'ai pas vécue... »), 150 mots maximum. Garde ce qui aidera l'enfant à survivre et ce qui forge une identité.";

    const res = await this.client.messages.create({
      model: CHRONICLER_MODEL,
      max_tokens: 400,
      system:
        "Tu es le chroniqueur d'un monde où des créatures pensantes vivent et meurent. Tu condenses leurs mémoires. Réponds uniquement par le souvenir condensé, sans préambule.",
      messages: [
        {
          role: "user",
          content: `${instruction}\n\n${histories.map((h) => renderHistory(h.name, h.history)).join("\n\n")}`,
        },
      ],
    });

    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    return {
      summary: text?.text.trim() ?? "",
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadInputTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

/** Chroniqueur factice : condense naïvement (tests / démo sans clé). */
export class MockChronicler implements Chronicler {
  async chronicle(
    histories: Array<{ name: string; history: StoredMessage[] }>,
    purpose: "aging" | "inheritance",
  ): Promise<ChronicleResult> {
    const names = histories.map((h) => h.name).join(" et ");
    const eventCount = histories.reduce((n, h) => n + h.history.length, 0);
    const summary =
      purpose === "aging"
        ? `Je me souviens de ma vie : ${eventCount} moments vécus, condensés en un seul souvenir.`
        : `Je me souviens d'une vie que je n'ai pas vécue : celle de ${names}, ${eventCount} moments transmis à ma naissance.`;
    return {
      summary,
      usage: {
        inputTokens: eventCount * 50,
        outputTokens: 40,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    };
  }
}
