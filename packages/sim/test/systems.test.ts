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
    state: "vivant",
    profile: "frugal",
    traits: [],
    identityJson: "",
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

describe("couche réactive (0 token)", () => {
  it("un devot qui cherche la nourriture s'en rapproche à chaque tick", () => {
    const world = new World();
    const devot = makeDevot({ currentGoal: { kind: "seek_food", foodId: "f1" } });
    world.devots.set(devot.id, devot);
    world.food.set("f1", makeFood("f1", 10, 0));

    const before = Math.abs(10 - devot.pos.x);
    tick(world);
    const after = Math.abs(10 - devot.pos.x);
    expect(after).toBeLessThan(before);
  });

  it("manger au contact recharge les HP et consomme la nourriture", () => {
    const world = new World();
    const devot = makeDevot({ hp: 5000, pos: { x: 10, y: 0, z: 0 } });
    world.devots.set(devot.id, devot);
    world.food.set("f1", makeFood("f1", 10.1, 0, 500));

    const result = tick(world);
    expect(result.eaten).toHaveLength(1);
    expect(world.food.size).toBe(0);
    // +500 de nourriture, -1 de métabolisme
    expect(devot.hp).toBeCloseTo(5000 + 500 - 1, 5);
  });

  it("hp ≤ 0 → mort détectée par le DeathSystem", () => {
    const world = new World();
    const devot = makeDevot({ hp: 0.5 });
    world.devots.set(devot.id, devot);

    const result = tick(world);
    expect(result.deaths).toEqual([{ devotId: "d1", cause: "épuisement vital" }]);
    expect(devot.state).toBe("mort");
    expect(devot.hp).toBe(0);
  });

  it("émet un déclencheur de survie au franchissement du seuil de faim", () => {
    const world = new World();
    // Juste au-dessus du seuil affamé (40%) : le métabolisme le fait franchir.
    const devot = makeDevot({ hp: 4000.5, hpMax: 10_000 });
    world.devots.set(devot.id, devot);

    const result = tick(world);
    expect(devot.state).toBe("affame");
    expect(result.triggers.some((t) => t.kind === "survival")).toBe(true);

    // Pas de re-déclenchement au tick suivant (seulement au franchissement).
    const result2 = tick(world);
    expect(result2.triggers.filter((t) => t.kind === "survival")).toHaveLength(0);
  });

  it("un devot mort ne bouge plus et ne vieillit plus", () => {
    const world = new World();
    const devot = makeDevot({ hp: 0, state: "mort", age: 42 });
    world.devots.set(devot.id, devot);
    tick(world);
    expect(devot.age).toBe(42);
  });
});

describe("applyDecision — l'esprit pilote le corps", () => {
  it("eat vise la nourriture demandée", () => {
    const world = new World();
    const devot = makeDevot();
    world.food.set("f1", makeFood("f1", 5, 5));
    applyDecision(devot, { action: "eat", targetId: "f1" }, world);
    expect(devot.currentGoal).toEqual({ kind: "seek_food", foodId: "f1" });
  });

  it("eat sans cible valide retombe sur la nourriture la plus proche", () => {
    const world = new World();
    const devot = makeDevot();
    world.food.set("f2", makeFood("f2", 3, 0));
    applyDecision(devot, { action: "eat", targetId: "inexistante" }, world);
    expect(devot.currentGoal).toEqual({ kind: "seek_food", foodId: "f2" });
  });

  it("speak pose la bulle de parole", () => {
    const world = new World();
    const devot = makeDevot();
    applyDecision(devot, { action: "speak", utterance: "Je pense donc je meurs." }, world);
    expect(devot.utterance).toBe("Je pense donc je meurs.");
  });
});

describe("perception étanche — rien hors du rayon ne fuit", () => {
  it("pas de déclencheur pour une nourriture hors de portée", async () => {
    const { perceptionSystem } = await import("../src/index.js");
    const world = new World();
    const devot = makeDevot();
    world.devots.set(devot.id, devot);
    world.food.set("far", makeFood("far", 25, 25));
    expect(perceptionSystem(world)).toHaveLength(0);
  });

  it("le repli eat n'atteint pas une nourriture invisible", () => {
    const world = new World();
    const devot = makeDevot();
    world.devots.set(devot.id, devot);
    world.food.set("far", makeFood("far", 25, 25));
    applyDecision(devot, { action: "eat", targetId: "inexistante" }, world);
    expect(devot.currentGoal.kind).not.toBe("seek_food");
  });

  it("pas de rencontre pour un devot hors de portée", async () => {
    const { perceptionSystem } = await import("../src/index.js");
    const world = new World();
    const a = makeDevot({ id: "a" });
    const b = makeDevot({ id: "b", pos: { x: 25, y: 0, z: 25 } });
    world.devots.set(a.id, a);
    world.devots.set(b.id, b);
    expect(perceptionSystem(world)).toHaveLength(0);
  });

  it("l'errance garde un cap lissé (pas de zigzag)", () => {
    const world = new World();
    const devot = makeDevot({ currentGoal: { kind: "wander" } });
    world.devots.set(devot.id, devot);

    // Directions de deux ticks consécutifs : presque colinéaires.
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
