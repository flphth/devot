import { describe, expect, it } from "vitest";
import { hpCost } from "../src/hpCost.js";

describe("hpCost — life <-> tokens", () => {
  it("convertit l'usage Haiku en µ$ de HP", () => {
    // 1M in at $1 + 1M out at $5 = $6 = 6e6 µ$
    const loss = hpCost(
      {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      "claude-haiku-4-5",
    );
    expect(loss).toBeCloseTo(6_000_000, 0);
  });

  it("a prophet (Opus) bleeds 5× faster than a frugal one (Haiku) on input", () => {
    const usage = {
      inputTokens: 10_000,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
    expect(hpCost(usage, "claude-opus-4-8")).toBeCloseTo(
      5 * hpCost(usage, "claude-haiku-4-5"),
      6,
    );
  });

  it("tokens read from cache cost ~0.1× the input price", () => {
    const cached = hpCost(
      { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 10_000, cacheCreationInputTokens: 0 },
      "claude-sonnet-4-6",
    );
    const raw = hpCost(
      { inputTokens: 10_000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      "claude-sonnet-4-6",
    );
    expect(cached).toBeCloseTo(raw * 0.1, 6);
  });

  it("a typical Haiku thought (~1200 in / 60 out) costs ~1500 HP", () => {
    const loss = hpCost(
      { inputTokens: 1200, outputTokens: 60, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      "claude-haiku-4-5",
    );
    expect(loss).toBeCloseTo(1500, 0);
  });
});
