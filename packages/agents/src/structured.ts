import type { Decision, TokenUsage } from "@devot/shared";
import { buildSchemaInstruction, parseDecision } from "./parseDecision.ts";
import type { MindMessage } from "./types.ts";

/** One raw model turn: its text, token usage, and (0G) the chat id to verify. */
export interface RawCompletion {
  text: string;
  usage: TokenUsage;
  chatId?: string;
}

/** Given the full message list + system, produce one raw completion. */
export type CompleteFn = (messages: MindMessage[], system: string) => Promise<RawCompletion>;

export class MindParseError extends Error {
  constructor(
    message: string,
    readonly raw: string,
    readonly usage: TokenUsage,
  ) {
    super(message);
    this.name = "MindParseError";
  }
}

const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

export interface StructuredThought {
  decision: Decision;
  usage: TokenUsage;
  raw: string;
  repaired: boolean;
  chatId?: string;
}

/**
 * The portable structured-output path (the G1 "porte" made concrete).
 *
 * Works on any provider that only guarantees text (0G) as well as ones with
 * native schemas (Anthropic): the schema is injected into the prompt, the
 * output is parsed leniently, and on failure we re-ask ONCE with the exact
 * parse error. Usage from both calls is summed, so a devot pays for its own
 * repair. Throws {@link MindParseError} if the second attempt still fails.
 */
export async function completeWithRepair(
  req: { system: string; history: MindMessage[]; event: string },
  complete: CompleteFn,
): Promise<StructuredThought> {
  const messages: MindMessage[] = [
    ...req.history,
    { role: "user", content: `${req.event}\n\n${buildSchemaInstruction()}` },
  ];

  const first = await complete(messages, req.system);
  const firstParse = parseDecision(first.text);
  if (firstParse.ok) {
    return { decision: firstParse.decision, usage: first.usage, raw: first.text, repaired: false, chatId: first.chatId };
  }

  // Repair path: show the model its output and the exact error, ask again.
  const repairMessages: MindMessage[] = [
    ...messages,
    { role: "assistant", content: first.text },
    {
      role: "user",
      content:
        `That was not a valid decision (${firstParse.error}). ` +
        `Reply with ONLY the JSON object matching the schema — no prose, no fences.`,
    },
  ];

  const second = await complete(repairMessages, req.system);
  const total = addUsage(first.usage, second.usage);
  const secondParse = parseDecision(second.text);
  if (secondParse.ok) {
    return { decision: secondParse.decision, usage: total, raw: second.text, repaired: true, chatId: second.chatId };
  }

  throw new MindParseError(`decision unparseable after repair: ${secondParse.error}`, second.text, total);
}
