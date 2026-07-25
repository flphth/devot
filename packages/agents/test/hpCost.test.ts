import type { Price, TokenUsage } from "@devot/shared";
import { describe, expect, it } from "vitest";
import { costMicro, hpCost } from "../src/hpCost.ts";
import { PRICE_PER_MTOK, anthropicPrice } from "../src/pricing.ts";

const usage = (i: number, o: number): TokenUsage => ({ inputTokens: i, outputTokens: o });

describe("costMicro (µ-units of the deposited token)", () => {
  it("computes cost from an explicit µ-units/1M price", () => {
    // Opus: 5e6 / 25e6 µ per 1M. 1M in + 1M out = 5e6 + 25e6 = 30_000_000 µ.
    expect(costMicro(usage(1_000_000, 1_000_000), PRICE_PER_MTOK["claude-opus-4-8"])).toBe(30_000_000);
  });

  it("rounds UP so a thought is never free", () => {
    expect(costMicro(usage(1, 0), PRICE_PER_MTOK["claude-haiku-4-5"])).toBe(1);
    expect(costMicro(usage(0, 1), { in: 0, out: 0.4 })).toBe(1);
  });

  it("takes an arbitrary 0G-style price (neuron-derived), not a frozen table", () => {
    // The real qwen2.5-omni-7b price in µ/1M (neurons/token ÷ 1e6).
    const zg: Price = { in: 992_000, out: 3_960_000 };
    // 356 in + 8 out ≈ the real measured G1 cost.
    expect(costMicro(usage(356, 8), zg)).toBe(385);
  });
});

describe("hpCost", () => {
  it("defaults to lethality 1 (balance == real µ cost)", () => {
    const u = usage(500_000, 100_000);
    expect(hpCost(u, PRICE_PER_MTOK["claude-sonnet-4-6"])).toBe(costMicro(u, PRICE_PER_MTOK["claude-sonnet-4-6"]));
  });

  it("scales with lethality", () => {
    const u = usage(1_000_000, 0);
    const base = costMicro(u, PRICE_PER_MTOK["claude-haiku-4-5"]); // 1_000_000 µ
    expect(hpCost(u, PRICE_PER_MTOK["claude-haiku-4-5"], 3)).toBe(base * 3);
  });
});

describe("anthropicPrice", () => {
  it("returns the table price (µ-units/1M) for known models", () => {
    expect(anthropicPrice("claude-haiku-4-5")).toEqual({ in: 1_000_000, out: 5_000_000 });
  });
  it("falls back to Opus (most expensive) for unknown ids", () => {
    expect(anthropicPrice("some-0g-model")).toEqual(PRICE_PER_MTOK["claude-opus-4-8"]);
  });
});
