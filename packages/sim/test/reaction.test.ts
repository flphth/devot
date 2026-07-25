import type { Decision } from "@devot/shared";
import { describe, expect, it } from "vitest";
import {
  NO_STIMULUS,
  demandsReaction,
  enforceReaction,
  fallbackReaction,
  food,
  isReaction,
  reactionInstruction,
  threat,
} from "../src/index.ts";

const d = (action: Decision["action"]): Decision => ({ action });

describe("demandsReaction", () => {
  it("is false when nothing is happening", () => {
    expect(demandsReaction(NO_STIMULUS)).toBe(false);
  });
  it("is true for a threat or food in the immediate environment", () => {
    expect(demandsReaction(threat("mon-1", "un monstre"))).toBe(true);
    expect(demandsReaction(food("f-1", "un fruit"))).toBe(true);
  });
});

describe("isReaction", () => {
  it("never counts idle as reacting to a stimulus", () => {
    expect(isReaction(d("idle"), threat("mon-1", "monstre"))).toBe(false);
    expect(isReaction(d("idle"), food("f-1", "fruit"))).toBe(false);
  });
  it("allows fight/flee/move against a threat", () => {
    expect(isReaction(d("flee"), threat("m", "x"))).toBe(true);
    expect(isReaction(d("attack"), threat("m", "x"))).toBe(true);
    expect(isReaction(d("move"), threat("m", "x"))).toBe(true);
  });
  it("does not count speaking or reproducing as reacting to a threat", () => {
    expect(isReaction(d("speak"), threat("m", "x"))).toBe(false);
    expect(isReaction(d("reproduce"), threat("m", "x"))).toBe(false);
  });
  it("allows eat/move toward food", () => {
    expect(isReaction(d("eat"), food("f", "x"))).toBe(true);
    expect(isReaction(d("move"), food("f", "x"))).toBe(true);
    expect(isReaction(d("attack"), food("f", "x"))).toBe(false);
  });
  it("permits anything (incl. idle) when there is no stimulus", () => {
    expect(isReaction(d("idle"), NO_STIMULUS)).toBe(true);
  });
});

describe("enforceReaction (server authority)", () => {
  it("leaves a genuine reaction untouched", () => {
    const r = enforceReaction(d("flee"), threat("mon-1", "monstre"));
    expect(r.coerced).toBe(false);
    expect(r.decision.action).toBe("flee");
  });

  it("overrides idle-under-threat with a flee, targeted at the monster", () => {
    const r = enforceReaction(d("idle"), threat("mon-1", "monstre"));
    expect(r.coerced).toBe(true);
    expect(r.decision.action).toBe("flee");
    expect(r.decision.targetId).toBe("mon-1");
  });

  it("overrides idle-near-food with an eat, targeted at the food", () => {
    const r = enforceReaction(d("idle"), food("f-9", "manne"));
    expect(r.coerced).toBe(true);
    expect(r.decision.action).toBe("eat");
    expect(r.decision.targetId).toBe("f-9");
  });

  it("overrides a non-reaction (speak) under a stimulus", () => {
    const r = enforceReaction(d("speak"), threat("mon-1", "monstre"));
    expect(r.coerced).toBe(true);
    expect(r.decision.action).toBe("flee");
  });

  it("never coerces when nothing is happening", () => {
    const r = enforceReaction(d("idle"), NO_STIMULUS);
    expect(r.coerced).toBe(false);
    expect(r.decision.action).toBe("idle");
  });
});

describe("fallbackReaction / reactionInstruction", () => {
  it("flees threats, eats food", () => {
    expect(fallbackReaction(threat("m", "x")).action).toBe("flee");
    expect(fallbackReaction(food("f", "x")).action).toBe("eat");
  });
  it("produces an urgent instruction only under a stimulus", () => {
    expect(reactionInstruction(threat("m", "x"))).toMatch(/immobile/i);
    expect(reactionInstruction(food("f", "x"))).toMatch(/attendre/i);
    expect(reactionInstruction(NO_STIMULUS)).toBe("");
  });
});
