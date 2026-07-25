import { DEVOT_ACTIONS } from "@devot/shared";
import { describe, expect, it } from "vitest";
import { hpCost } from "../src/hpCost.ts";
import { MockMind } from "../src/providers/mock.ts";
import { AnthropicApiMind } from "../src/providers/anthropicApi.ts";
import { ClaudeAgentMind } from "../src/providers/claudeAgent.ts";
import { ZgMind } from "../src/zgMind.ts";
import { selectMind } from "../src/select.ts";
import type { ThinkRequest } from "../src/types.ts";

const req: ThinkRequest = {
  system: "You are a mortal devot. Thinking costs you life.",
  history: [{ role: "assistant", content: "I awoke." }],
  event: "A voice from the sky says: survive.",
  model: "claude-haiku-4-5",
};

describe("MockMind", () => {
  it("is deterministic: same input → same decision & usage", async () => {
    const m = new MockMind();
    const a = await m.think(req);
    const b = await m.think(req);
    expect(a.decision).toEqual(b.decision);
    expect(a.usage).toEqual(b.usage);
  });

  it("returns a valid action and non-zero cost that drops a balance", async () => {
    const r = await new MockMind().think(req);
    expect(DEVOT_ACTIONS).toContain(r.decision.action);
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    const cost = hpCost(r.usage, r.price);
    expect(cost).toBeGreaterThan(0);
  });

  it("has no TEE proof (not a verifiable provider)", async () => {
    const r = await new MockMind().think(req);
    expect(r.tee).toBeUndefined();
    expect(r.repaired).toBe(false);
  });
});

describe("selectMind", () => {
  it("maps each MIND value to the right provider", () => {
    expect(selectMind("mock")).toBeInstanceOf(MockMind);
    expect(selectMind("api")).toBeInstanceOf(AnthropicApiMind);
    expect(selectMind("claude")).toBeInstanceOf(ClaudeAgentMind);
    expect(selectMind("0g")).toBeInstanceOf(ZgMind);
  });

  it("exposes the provider name", () => {
    expect(selectMind("mock").name).toBe("mock");
    expect(selectMind("0g").name).toBe("0g");
  });

  it("throws on an unknown MIND", () => {
    expect(() => selectMind("gpt")).toThrow(/unknown MIND/);
  });
});

describe("ClaudeAgentMind", () => {
  it("fails loudly instead of pretending (not wired in P0)", async () => {
    await expect(new ClaudeAgentMind().think(req)).rejects.toThrow(/not wired/i);
  });
});

describe("AnthropicApiMind", () => {
  it("requires an API key", async () => {
    await expect(new AnthropicApiMind("").think(req)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("ZgMind", () => {
  it("requires a private key for a live run", async () => {
    const saved = process.env.ZG_PRIVATE_KEY;
    delete process.env.ZG_PRIVATE_KEY;
    await expect(new ZgMind().think(req)).rejects.toThrow(/ZG_PRIVATE_KEY/);
    if (saved !== undefined) process.env.ZG_PRIVATE_KEY = saved;
  });
});
