import { describe, expect, it } from "vitest";
import { hpCost } from "../src/hpCost.js";

describe("hpCost — vie ↔ tokens", () => {
  it("convertit l'usage Haiku en µ$ de HP", () => {
    // 1M in à 1$ + 1M out à 5$ = 6$ = 6e6 µ$
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

  it("un prophète (Opus) saigne 5× plus vite qu'un frugal (Haiku) en entrée", () => {
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

  it("les tokens lus depuis le cache coûtent ~0,1× l'entrée", () => {
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

  it("une pensée typique Haiku (~1200 in / 60 out) coûte ~1500 HP", () => {
    const loss = hpCost(
      { inputTokens: 1200, outputTokens: 60, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      "claude-haiku-4-5",
    );
    expect(loss).toBeCloseTo(1500, 0);
  });
});
