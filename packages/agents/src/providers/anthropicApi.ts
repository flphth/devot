import type { TokenUsage } from "@devot/shared";
import { anthropicPrice } from "../pricing.ts";
import { completeWithRepair, type CompleteFn } from "../structured.ts";
import type { MindProvider, ThinkRequest, ThinkResult } from "../types.ts";

/**
 * Dynamic import through a variable specifier so `tsc` never tries to resolve
 * the optional SDK at build time (keeps typecheck green when it isn't
 * installed). Returns `any`; the shape is asserted at the call site.
 */
async function dynamicImport(spec: string): Promise<any> {
  return import(spec);
}

function extractText(res: any): string {
  const blocks = Array.isArray(res?.content) ? res.content : [];
  return blocks
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();
}

/**
 * `api` — Anthropic pay-per-token via the official SDK. Priced from
 * `PRICE_PER_MTOK`. Uses the same portable structured path as the 0G mind so a
 * missing `additionalProperties`/schema quirk never breaks a tick.
 */
export class AnthropicApiMind implements MindProvider {
  readonly name = "api" as const;
  private client: any;

  constructor(private readonly apiKey = process.env.ANTHROPIC_API_KEY ?? "") {}

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is required for MIND=api");
    let mod: any;
    try {
      mod = await dynamicImport("@anthropic-ai/sdk");
    } catch {
      throw new Error("`@anthropic-ai/sdk` not installed — run `pnpm install` to use MIND=api");
    }
    const Anthropic = mod.default ?? mod.Anthropic;
    this.client = new Anthropic({ apiKey: this.apiKey });
    return this.client;
  }

  async think(req: ThinkRequest): Promise<ThinkResult> {
    const client = await this.getClient();
    const complete: CompleteFn = async (messages, system) => {
      const res = await client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens ?? 512,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const usage: TokenUsage = {
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
      };
      return { text: extractText(res), usage };
    };

    const t = await completeWithRepair(req, complete);
    return {
      decision: t.decision,
      usage: t.usage,
      price: anthropicPrice(req.model),
      raw: t.raw,
      repaired: t.repaired,
      model: req.model,
    };
  }
}
