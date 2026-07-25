import { describe, expect, it } from "vitest";
import { parseDecision, UTTERANCE_MAX_CHARS } from "../src/index.js";

describe("parseDecision", () => {
  it("accepts a minimal decision", () => {
    expect(parseDecision({ action: "idle" })).toEqual({ action: "idle" });
  });

  it("accepts a complete decision", () => {
    const d = parseDecision({
      action: "speak",
      utterance: "Je vis.",
      emotion: "serenity",
      direction: { x: 1, z: 0 },
      targetId: "food-1",
    });
    expect(d.action).toBe("speak");
    expect(d.utterance).toBe("Je vis.");
    expect(d.direction).toEqual({ x: 1, z: 0 });
  });

  it("truncates over-long speech (the 140-char rule)", () => {
    const d = parseDecision({ action: "speak", utterance: "a".repeat(500) });
    expect(d.utterance).toHaveLength(UTTERANCE_MAX_CHARS);
  });

  it("carries the inner monologue (thought), truncated to 140 chars", () => {
    const d = parseDecision({ action: "idle", thought: "I fear the night. " + "x".repeat(200) });
    expect(d.thought).toBeDefined();
    expect(d.thought!.length).toBeLessThanOrEqual(UTTERANCE_MAX_CHARS);
    expect(d.thought).toContain("I fear the night.");
  });

  it("the schema requires action AND thought", async () => {
    const { DECISION_SCHEMA } = await import("../src/index.js");
    expect(DECISION_SCHEMA.required).toContain("action");
    expect(DECISION_SCHEMA.required).toContain("thought");
  });

  it("rejects an unknown action", () => {
    expect(() => parseDecision({ action: "fly" })).toThrow();
  });

  it("rejects a non-decision", () => {
    expect(() => parseDecision("idle")).toThrow();
    expect(() => parseDecision(null)).toThrow();
  });
});
