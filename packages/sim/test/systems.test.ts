import { describe, expect, it } from "vitest";
import type { DevotEntity, FoodEntity } from "@devot/shared";
import { applyDecision, tick, World } from "../src/index.js";

function makeDevot(overrides: Partial<DevotEntity> = {}): DevotEntity {
  return {
    id: "d1",
    godId: "g1",
    isFounder: true,
    name: "Test",
    pos: { x: 0, y: 0, z: 0 },
    hp: 10_000,
    hpMax: 10_000,
    state: "alive",
    profile: "frugal",
    traits: [],
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "idle" },
    ...overrides,
  };
}

function makeFood(id: string, x: number, z: number, hpValue = 500): FoodEntity {
  return { id, pos: { x, y: 0, z }, type: "grain", hpValue, source: "spawn" };
}

describe("reactive layer (0 tokens)", () => {
  it("a devot seeking food gets closer to it every tick", () => {
    const world = new World();
    const devot = makeDevot({ currentGoal: { kind: "seek_food", foodId: "f1" } });
    world.devots.set(devot.id, devot);
    world.food.set("f1", makeFood("f1", 10, 0));

    const before = Math.abs(10 - devot.pos.x);
    tick(world);
    const after = Math.abs(10 - devot.pos.x);
    expect(after).toBeLessThan(before);
  });

  it("eating on contact restores HP and consumes the food", () => {
    const world = new World();
    const devot = makeDevot({ hp: 5000, pos: { x: 10, y: 0, z: 0 } });
    world.devots.set(devot.id, devot);
    world.food.set("f1", makeFood("f1", 10.1, 0, 500));

    const result = tick(world);
    expect(result.eaten).toHaveLength(1);
    expect(world.food.size).toBe(0);
    // +500 from food, -1 from metabolism
    expect(devot.hp).toBeCloseTo(5000 + 500 - 1, 5);
  });

  it("hp ≤ 0 → death detected by the DeathSystem", () => {
    const world = new World();
    const devot = makeDevot({ hp: 0.5 });
    world.devots.set(devot.id, devot);

    const result = tick(world);
    expect(result.deaths).toEqual([{ devotId: "d1", cause: "vital exhaustion" }]);
    expect(devot.state).toBe("dead");
    expect(devot.hp).toBe(0);
  });

  it("emits a survival trigger when the hunger threshold is crossed", () => {
    const world = new World();
    // Just above the starving threshold (40%): metabolism pushes it across.
    const devot = makeDevot({ hp: 4000.5, hpMax: 10_000 });
    world.devots.set(devot.id, devot);

    const result = tick(world);
    expect(devot.state).toBe("starving");
    expect(result.triggers.some((t) => t.kind === "survival")).toBe(true);

    // No re-trigger on the next tick (only on crossing).
    const result2 = tick(world);
    expect(result2.triggers.filter((t) => t.kind === "survival")).toHaveLength(0);
  });

  it("a dead devot no longer moves nor ages", () => {
    const world = new World();
    const devot = makeDevot({ hp: 0, state: "dead", age: 42 });
    world.devots.set(devot.id, devot);
    tick(world);
    expect(devot.age).toBe(42);
  });
});

describe("applyDecision — the mind drives the body", () => {
  it("eat targets the requested food", () => {
    const world = new World();
    const devot = makeDevot();
    world.food.set("f1", makeFood("f1", 5, 5));
    applyDecision(devot, { action: "eat", targetId: "f1" }, world);
    expect(devot.currentGoal).toEqual({ kind: "seek_food", foodId: "f1" });
  });

  it("eat with no valid target falls back to the nearest food", () => {
    const world = new World();
    const devot = makeDevot();
    world.food.set("f2", makeFood("f2", 3, 0));
    applyDecision(devot, { action: "eat", targetId: "inexistante" }, world);
    expect(devot.currentGoal).toEqual({ kind: "seek_food", foodId: "f2" });
  });

  it("speak sets the speech bubble", () => {
    const world = new World();
    const devot = makeDevot();
    applyDecision(devot, { action: "speak", utterance: "Je pense donc je meurs." }, world);
    expect(devot.utterance).toBe("Je pense donc je meurs.");
  });
});

describe("watertight perception — nothing outside the radius leaks", () => {
  it("no trigger for food out of range", async () => {
    const { perceptionSystem } = await import("../src/index.js");
    const world = new World();
    const devot = makeDevot();
    world.devots.set(devot.id, devot);
    world.food.set("far", makeFood("far", 25, 25));
    expect(perceptionSystem(world)).toHaveLength(0);
  });

  it("the eat fallback cannot reach food it cannot see", () => {
    const world = new World();
    const devot = makeDevot();
    world.devots.set(devot.id, devot);
    world.food.set("far", makeFood("far", 25, 25));
    applyDecision(devot, { action: "eat", targetId: "inexistante" }, world);
    expect(devot.currentGoal.kind).not.toBe("seek_food");
  });

  it("no encounter for a devot out of range", async () => {
    const { perceptionSystem } = await import("../src/index.js");
    const world = new World();
    const a = makeDevot({ id: "a" });
    const b = makeDevot({ id: "b", pos: { x: 25, y: 0, z: 25 } });
    world.devots.set(a.id, a);
    world.devots.set(b.id, b);
    expect(perceptionSystem(world)).toHaveLength(0);
  });

  it("wandering keeps a smoothed heading (no zigzag)", () => {
    const world = new World();
    const devot = makeDevot({ currentGoal: { kind: "wander" } });
    world.devots.set(devot.id, devot);

    // Directions of two consecutive ticks: almost collinear.
    const p0 = { ...devot.pos };
    tick(world);
    const p1 = { ...devot.pos };
    tick(world);
    const p2 = { ...devot.pos };
    const v1 = { x: p1.x - p0.x, z: p1.z - p0.z };
    const v2 = { x: p2.x - p1.x, z: p2.z - p1.z };
    const dot =
      (v1.x * v2.x + v1.z * v2.z) /
      (Math.hypot(v1.x, v1.z) * Math.hypot(v2.x, v2.z));
    expect(dot).toBeGreaterThan(0.95);
  });
});
