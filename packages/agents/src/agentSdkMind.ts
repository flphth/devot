import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CognitionProfile, InferenceUsage, ThoughtSubject } from "@devot/shared";
import { DECISION_SCHEMA, parseDecision } from "@devot/shared";
import type { StoredMessage } from "@devot/db";
import type { Chronicler, ChronicleResult } from "./chronicler.js";
import type { MindProvider, ThoughtResult } from "./mind.js";
import { buildEventBlock, buildPersona, rulesFor } from "./prompts.js";

/**
 * Minds driven by the Claude Code subscription (Agent SDK): no pay-per-token
 * API key — every thought goes through the machine's Claude Code credentials.
 * Real usage (tokens) is still taken out of the balance.
 *
 * Each thought is an ephemeral session: the devot's history is replayed into
 * the prompt as a transcript (its memory lives in our database).
 */
/**
 * Environment for the Claude Code subprocess, stripped of API keys: in
 * subscription mode a leftover ANTHROPIC_API_KEY (shell, .env, placeholder)
 * would take precedence over OAuth and cause `invalid x-api-key`.
 */
function subscriptionEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
  };
}

export class AgentSdkMind implements MindProvider {
  constructor(private modelOverride?: string) {}

  async think(
    subject: ThoughtSubject,
    profile: CognitionProfile,
    history: StoredMessage[],
    eventText: string,
  ): Promise<ThoughtResult> {
    const userTurn = buildEventBlock(subject, eventText);
    const transcript = renderTranscript(history);
    const prompt = transcript
      ? `## Your memory (lived so far)\n${transcript}\n\n## Now\n${userTurn}`
      : userTurn;

    const q = query({
      prompt,
      options: {
        systemPrompt: `${rulesFor(subject)}\n\n${buildPersona(subject)}`,
        model: this.modelOverride ?? profile.model,
        maxTurns: 1,
        allowedTools: [],
        env: subscriptionEnv(),
        outputFormat: {
          type: "json_schema",
          schema: DECISION_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });

    for await (const message of q) {
      if (message.type !== "result") continue;
      if (message.subtype !== "success") {
        throw new Error(`agent-sdk: thought failed (${message.subtype})`);
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
    throw new Error("agent-sdk: no result");
  }
}

/** Chronicler on the subscription: condenses memories through a Haiku session. */
export class AgentSdkChronicler implements Chronicler {
  async chronicle(
    histories: Array<{ name: string; history: StoredMessage[] }>,
    purpose: "aging" | "inheritance",
  ): Promise<ChronicleResult> {
    const instruction =
      purpose === "aging"
        ? 'Condense this devot\'s life into a first-person memory ("I remember..."), 150 words maximum. Keep what matters: defining events, relationships, lessons, fears and hopes.'
        : 'Merge these parents\' lives into an inheritance of memories for their child, in the first person ("I remember a life I never lived..."), 150 words maximum.';

    const q = query({
      prompt: `${instruction}\n\n${histories
        .map((h) => `### Life of ${h.name}\n${renderTranscript(h.history)}`)
        .join("\n\n")}`,
      options: {
        systemPrompt:
          "You are the chronicler of a world where thinking creatures live and die. You condense their memories. Reply only with the condensed memory, with no preamble.",
        model: "claude-haiku-4-5",
        maxTurns: 1,
        allowedTools: [],
        env: subscriptionEnv(),
      },
    });

    for await (const message of q) {
      if (message.type !== "result") continue;
      if (message.subtype !== "success") {
        throw new Error(`agent-sdk: chronicle failed (${message.subtype})`);
      }
      return { summary: message.result.trim(), usage: toUsage(message.usage) };
    }
    throw new Error("agent-sdk: no result");
  }
}

function renderTranscript(history: StoredMessage[]): string {
  return history
    .map((m) => {
      const content =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${m.role === "user" ? "[event]" : "[your decision]"} ${content.slice(0, 500)}`;
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
