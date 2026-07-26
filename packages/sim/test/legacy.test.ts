import { describe, expect, it } from "vitest";
import type { DevotEntity, FoodEntity } from "@devot/shared";
import { defaultIdentity, encodeIdentity, terrainHeight } from "@devot/shared";
import { applyDecision, nearestVisibleFood, tick, World } from "../src/index.js";

let seq = 0;
function makeDevot(overrides: Partial<DevotEntity> = {}): DevotEntity {
  const pos = overrides.pos ?? { x: 0, y: 0, z: 0 };
  return {
    id: `d${++seq}`,
    godId: "g1",
    isFounder: false,
    generation: 1,
    wallet: "",
    name: `D${seq}`,
    balance: 20_000,
    capacity: 60_000,
    state: "alive",
    profile: "frugal",
    traits: [],
    identityJson: encodeIdentity(defaultIdentity([])),
    items: [],
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "wander" },
    ...overrides,
    pos: { ...pos, y: terrainHeight(pos.x, pos.z) },
  };
}

function relic(id: string, x: number, z: number, funds = 21_000): FoodEntity {
  return {
    id,
    pos: { x, y: terrainHeight(x, z), z },
    type: "legacy",
    worth: 0,
    source: "spawn",
    spawnedAt: Date.now(),
    ttlMs: 180_000,
    funds,
    leftBy: "Someone",
  };
}

function grain(id: string, x: number, z: number): FoodEntity {
  return {
    id,
    pos: { x, y: terrainHeight(x, z), z },
    type: "grain",
    worth: 2_000,
    source: "spawn",
    spawnedAt: Date.now(),
    ttlMs: 600_000,
  };
}

/**
 * A relic holds the funds a death released. It is NOT a meal, and everything
 * that treats food as interchangeable had to learn the difference.
 */
describe("a relic is funds, not food", () => {
  it("is never offered to a devot looking for something to eat", () => {
    // Left in, a starving devot walked the width of the map to something that
    // could not feed it, and then stood there.
    const world = new World();
    world.food.set("r1", relic("r1", 1, 0));
    expect(nearestVisibleFood(world, { x: 0, y: 0, z: 0 }, 400)).toBeUndefined();
  });

  it("is passed over in favour of real food, however far", () => {
    const world = new World();
    world.food.set("r1", relic("r1", 1, 0));
    world.food.set("g1", grain("g1", 6, 0));
    expect(nearestVisibleFood(world, { x: 0, y: 0, z: 0 }, 400)?.id).toBe("g1");
  });

  it("a body told to walk to one gives up instead of standing over it", () => {
    const world = new World();
    const devot = makeDevot({ currentGoal: { kind: "seek_food", foodId: "r1" } });
    world.devots.set(devot.id, devot);
    world.food.set("r1", relic("r1", 5, 0));

    tick(world);
    expect(devot.currentGoal.kind).toBe("wander");
  });

  it("cannot be reached through the eat fallback either", () => {
    const world = new World();
    const devot = makeDevot();
    world.devots.set(devot.id, devot);
    world.food.set("r1", relic("r1", 2, 0));

    applyDecision(devot, { action: "eat", targetId: "nothing-real" }, world);
    expect(devot.currentGoal.kind).not.toBe("seek_food");
  });

  it("is claimed on contact, and reports the funds rather than feeding", () => {
    const world = new World();
    const devot = makeDevot({ balance: 20_000, pos: { x: 0, y: 0, z: 0 } });
    world.devots.set(devot.id, devot);
    world.food.set("r1", relic("r1", 0.1, 0, 21_000));

    const before = devot.balance;
    const result = tick(world);

    expect(result.claimed).toHaveLength(1);
    expect(result.claimed[0]!.funds).toBe(21_000);
    expect(result.claimed[0]!.godId).toBe("g1");
    expect(result.eaten).toHaveLength(0);
    // It gained nothing to live on: the funds go to its god, not its body.
    expect(devot.balance).toBeLessThan(before);
    expect(world.food.has("r1")).toBe(false);
  });

  it("can be claimed by a devot of any god — the dead do not choose their heirs", () => {
    const world = new World();
    const rival = makeDevot({ godId: "g2", pos: { x: 0, y: 0, z: 0 } });
    world.devots.set(rival.id, rival);
    world.food.set("r1", relic("r1", 0.1, 0));

    expect(tick(world).claimed[0]!.godId).toBe("g2");
  });
});
