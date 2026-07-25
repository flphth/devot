import { describe, expect, it } from "vitest";
import { parseDecision, UTTERANCE_MAX_CHARS } from "../src/index.js";

describe("parseDecision", () => {
  it("accepte une décision minimale", () => {
    expect(parseDecision({ action: "idle" })).toEqual({ action: "idle" });
  });

  it("accepte une décision complète", () => {
    const d = parseDecision({
      action: "speak",
      utterance: "Je vis.",
      emotion: "sérénité",
      direction: { x: 1, z: 0 },
      targetId: "food-1",
    });
    expect(d.action).toBe("speak");
    expect(d.utterance).toBe("Je vis.");
    expect(d.direction).toEqual({ x: 1, z: 0 });
  });

  it("tronque les paroles trop longues (règle des 140c)", () => {
    const d = parseDecision({ action: "speak", utterance: "a".repeat(500) });
    expect(d.utterance).toHaveLength(UTTERANCE_MAX_CHARS);
  });

  it("porte le monologue intérieur (thought), tronqué à 140c", () => {
    const d = parseDecision({ action: "idle", thought: "Je crains la nuit. " + "x".repeat(200) });
    expect(d.thought).toBeDefined();
    expect(d.thought!.length).toBeLessThanOrEqual(UTTERANCE_MAX_CHARS);
    expect(d.thought).toContain("Je crains la nuit.");
  });

  it("le schéma exige action ET thought", async () => {
    const { DECISION_SCHEMA } = await import("../src/index.js");
    expect(DECISION_SCHEMA.required).toContain("action");
    expect(DECISION_SCHEMA.required).toContain("thought");
  });

  it("rejette une action inconnue", () => {
    expect(() => parseDecision({ action: "fly" })).toThrow();
  });

  it("rejette une non-décision", () => {
    expect(() => parseDecision("idle")).toThrow();
    expect(() => parseDecision(null)).toThrow();
  });
});
