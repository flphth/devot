import Anthropic from "@anthropic-ai/sdk";
import type { InferenceUsage } from "@devot/shared";
import type { StoredMessage } from "@devot/db";

export interface ChronicleResult {
  summary: string;
  usage: InferenceUsage;
}

/**
 * The chronicler: a cheap Haiku call that condenses histories.
 * Two uses: ageing (compacting one's own past) and inheritance (merging the
 * parents' memories into memories for the child).
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
    return `${m.role === "user" ? "event" : "thought"}: ${content.slice(0, 400)}`;
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
        ? 'Condense this devot\'s life into a first-person memory ("I remember..."), 150 words maximum. Keep what matters: defining events, relationships, lessons learned, fears and hopes.'
        : 'Merge these parents\' lives into an inheritance of memories for their child, in the first person ("I remember a life I never lived..."), 150 words maximum. Keep what will help the child survive and what forges an identity.';

    const res = await this.client.messages.create({
      model: CHRONICLER_MODEL,
      max_tokens: 400,
      system:
        "You are the chronicler of a world where thinking creatures live and die. You condense their memories. Reply only with the condensed memory, with no preamble.",
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

/** Fake chronicler: condenses naively (tests / demo without a key). */
export class MockChronicler implements Chronicler {
  async chronicle(
    histories: Array<{ name: string; history: StoredMessage[] }>,
    purpose: "aging" | "inheritance",
  ): Promise<ChronicleResult> {
    const names = histories.map((h) => h.name).join(" et ");
    const eventCount = histories.reduce((n, h) => n + h.history.length, 0);
    const summary =
      purpose === "aging"
        ? `I remember my life: ${eventCount} moments lived, condensed into a single memory.`
        : `I remember a life I never lived: that of ${names}, ${eventCount} moments passed on at my birth.`;
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
