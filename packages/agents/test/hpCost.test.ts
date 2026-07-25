import type { Price, TokenUsage } from "@devot/shared";
import { describe, expect, it } from "vitest";
import { costMicroUsd, hpCost } from "../src/hpCost.ts";
import { PRICE_PER_MTOK, anthropicPrice } from "../src/pricing.ts";

const usage = (i: number, o: number): TokenUsage => ({ inputTokens: i, outputTokens: o });

describe("costMicroUsd", () => {
  it("computes real µ$ cost from an explicit price", () => {
    // Opus: 5 $/1M in, 25 $/1M out. 1M in + 1M out = 5 + 25 = 30 $ = 30_000_000 µ$.
    expect(costMicroUsd(usage(1_000_000, 1_000_000), PRICE_PER_MTOK["claude-opus-4-8"])).toBe(30_000_000);
  });

  it("rounds UP so a thought is never free", () => {
    // Haiku: 1 $/1M in. 1 input token = 1e-6 $ = 1 µ$ exactly; 0 tokens rounds to 0.
    expect(costMicroUsd(usage(1, 0), PRICE_PER_MTOK["claude-haiku-4-5"])).toBe(1);
    // A sub-µ$ amount still ceils to 1.
    expect(costMicroUsd(usage(0, 1), { in: 0, out: 0.4 })).toBe(1);
  });

  it("takes an arbitrary price (0G-style), not a frozen table", () => {
    // A price that exists in no Anthropic table — the 0G path.
    const zg: Price = { in: 0.2, out: 0.9 };
    expect(costMicroUsd(usage(2_000_000, 1_000_000), zg)).toBe(0.2 * 2 * 1e6 + 0.9 * 1e6);
  });
});

describe("hpCost", () => {
  it("defaults to lethality 1 (HP == real µ$ cost)", () => {
    const u = usage(500_000, 100_000);
    expect(hpCost(u, PRICE_PER_MTOK["claude-sonnet-4-6"])).toBe(costMicroUsd(u, PRICE_PER_MTOK["claude-sonnet-4-6"]));
  });

  it("scales with lethality", () => {
    const u = usage(1_000_000, 0);
    const base = costMicroUsd(u, PRICE_PER_MTOK["claude-haiku-4-5"]); // 1_000_000 µ$
    expect(hpCost(u, PRICE_PER_MTOK["claude-haiku-4-5"], 3)).toBe(base * 3);
  });
});

describe("anthropicPrice", () => {
  it("returns the table price for known models", () => {
    expect(anthropicPrice("claude-haiku-4-5")).toEqual({ in: 1, out: 5 });
  });
  it("falls back to Opus (most expensive) for unknown ids", () => {
    expect(anthropicPrice("some-0g-model")).toEqual(PRICE_PER_MTOK["claude-opus-4-8"]);
  });
});
