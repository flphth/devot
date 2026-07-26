import { describe, expect, it } from "vitest";
import type { DevotEntity } from "@devot/shared";
import {
  CARRION_HP_FRACTION,
  MONSTER_ATTACK_DRAIN_PER_TICK,
  MONSTER_HP_MAX,
  MONSTER_METABOLISM_HP_PER_TICK,
  MONSTER_THINK_INTERVAL_MS,
  TICK_MS,
} from "@devot/shared";
import {
  applyMonsterDecision,
  monsterPerception,
  spawnMonster,
  tick,
  World,
} from "../src/index.js";

let seq = 0;
function makeDevot(overrides: Partial<DevotEntity> = {}): DevotEntity {
  return {
    id: `d${++seq}`,
    godId: "g1",
    isFounder: true,
    name: "Prey",
    pos: { x: 0, y: 0, z: 0 },
    hp: 40_000,
    hpMax: 50_000,
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

describe("monsters hunt", () => {
  it("drains a devot's life on contact, and grows on it", () => {
    const world = new World();
    const devot = makeDevot({ pos: { x: 0, y: 0, z: 0 } });
    world.devots.set(devot.id, devot);
    const monster = spawnMonster(world, 0.3, 0);
    monster.currentGoal = { kind: "hunt", targetId: devot.id };

    const hpBefore = devot.hp;
    const monsterBefore = monster.hp;
    const result = tick(world);

    expect(result.monsterAttacks).toHaveLength(1);
    expect(devot.hp).toBeLessThan(hpBefore);
    // The monster gains from the kill, net of its own heavy metabolism.
    expect(monster.hp).toBeGreaterThan(monsterBefore - MONSTER_METABOLISM_HP_PER_TICK);
    // The drain, plus the devot's own metabolism for the tick.
    expect(hpBefore - devot.hp).toBeCloseTo(MONSTER_ATTACK_DRAIN_PER_TICK + 1, 5);
  });

  it("warns the prey once, not on every tick of the mauling", () => {
    const world = new World();
    const devot = makeDevot({ pos: { x: 0, y: 0, z: 0 } });
    world.devots.set(devot.id, devot);
    const monster = spawnMonster(world, 0.3, 0);
    monster.currentGoal = { kind: "hunt", targetId: devot.id };

    const first = tick(world).triggers.filter((t) => t.creatureId === devot.id);
    const second = tick(world).triggers.filter((t) => t.creatureId === devot.id);
    expect(first.some((t) => t.kind === "threat")).toBe(true);
    expect(second.some((t) => t.kind === "threat")).toBe(false);
  });

  it("gives up on prey that has died", () => {
    const world = new World();
    const devot = makeDevot({ state: "dead", hp: 0 });
    world.devots.set(devot.id, devot);
    const monster = spawnMonster(world, 0.3, 0);
    monster.currentGoal = { kind: "hunt", targetId: devot.id };

    tick(world);
    expect(monster.currentGoal.kind).toBe("prowl");
  });
});

describe("monsters starve", () => {
  it("bleeds life every tick, hunting or not", () => {
    const world = new World();
    const monster = spawnMonster(world, 5, 5);
    const before = monster.hp;
    tick(world);
    expect(monster.hp).toBe(before - MONSTER_METABOLISM_HP_PER_TICK);
  });

  it("dies of it, and leaves carrion behind", () => {
    const world = new World();
    const monster = spawnMonster(world, 5, 5);
    monster.hp = MONSTER_METABOLISM_HP_PER_TICK / 2;

    const result = tick(world);
    expect(result.monsterDeaths).toEqual([
      { monsterId: monster.id, cause: "starvation" },
    ]);
    expect(monster.state).toBe("dead");

    const carrion = [...world.food.values()].filter((f) => f.type === "carrion");
    expect(carrion).toHaveLength(1);
    expect(carrion[0]!.hpValue).toBeCloseTo(MONSTER_HP_MAX * CARRION_HP_FRACTION, 5);
  });
});

describe("devots can fight back", () => {
  it("a devot may target a monster, and killing it is worth a fortune", () => {
    const world = new World();
    const devot = makeDevot({ pos: { x: 0, y: 0, z: 0 }, hp: 50_000 });
    world.devots.set(devot.id, devot);
    const monster = spawnMonster(world, 0.3, 0);
    monster.hp = 100; // already all but dead

    applyMonsterDecision(monster, { action: "idle" }, world);
    devot.currentGoal = { kind: "attack", targetId: monster.id };

    const result = tick(world);
    expect(result.monsterDeaths.map((d) => d.monsterId)).toContain(monster.id);
    expect([...world.food.values()].some((f) => f.type === "carrion")).toBe(true);
  });
});

describe("monsters do not graze", () => {
  it("ignores grain lying at its feet", () => {
    const world = new World();
    const monster = spawnMonster(world, 0, 0);
    world.food.set("g1", {
      id: "g1",
      pos: { ...monster.pos },
      type: "grain",
      hpValue: 5_000,
      source: "spawn",
      spawnedAt: Date.now(),
      ttlMs: 600_000,
    });

    const before = monster.hp;
    tick(world);
    expect(world.food.has("g1")).toBe(true);
    expect(monster.hp).toBe(before - MONSTER_METABOLISM_HP_PER_TICK);
  });

  it("but feeds on carrion", () => {
    const world = new World();
    const monster = spawnMonster(world, 0, 0);
    monster.hp = 10_000;
    world.food.set("c1", {
      id: "c1",
      pos: { ...monster.pos },
      type: "carrion",
      hpValue: 5_000,
      source: "spawn",
      spawnedAt: Date.now(),
      ttlMs: 600_000,
    });

    tick(world);
    expect(world.food.has("c1")).toBe(false);
    expect(monster.hp).toBeGreaterThan(10_000);
  });
});

describe("a monster's mind drives its body", () => {
  it("turns an attack decision into a hunt", () => {
    const world = new World();
    const devot = makeDevot();
    world.devots.set(devot.id, devot);
    const monster = spawnMonster(world, 3, 3);

    applyMonsterDecision(monster, { action: "attack", targetId: devot.id }, world);
    expect(monster.currentGoal).toEqual({ kind: "hunt", targetId: devot.id });
  });

  it("refuses to reproduce — there will be no others like it", () => {
    const world = new World();
    const monster = spawnMonster(world, 3, 3);
    monster.currentGoal = { kind: "prowl" };
    applyMonsterDecision(monster, { action: "reproduce" }, world);
    expect(monster.currentGoal).toEqual({ kind: "prowl" });
    expect(world.monsters.size).toBe(1);
  });

  it("cannot hunt a devot it named but that does not exist", () => {
    const world = new World();
    const monster = spawnMonster(world, 3, 3);
    applyMonsterDecision(monster, { action: "attack", targetId: "ghost" }, world);
    expect(monster.currentGoal.kind).toBe("prowl");
  });
});

describe("what a monster notices", () => {
  it("reports prey it can see", () => {
    const world = new World();
    const devot = makeDevot({ pos: { x: 1, y: 0, z: 0 } });
    world.devots.set(devot.id, devot);
    const monster = spawnMonster(world, 0, 0);
    monster.lastThoughtAt = 0; // long overdue for a thought

    const triggers = monsterPerception(world);
    expect(triggers.some((t) => t.creatureId === monster.id)).toBe(true);
  });

  it("will not think again before its cadence allows it", () => {
    // The guard that keeps a pack of monsters from emptying the inference
    // budget. A predator that can see prey is in an interesting situation on
    // every tick; without this it thinks four times a second and dies of it.
    const world = new World();
    const devot = makeDevot({ pos: { x: 1, y: 0, z: 0 } });
    world.devots.set(devot.id, devot);
    const monster = spawnMonster(world, 0, 0);
    monster.lastThoughtAt = 0;

    const now = Date.now();
    expect(monsterPerception(world, now)).toHaveLength(1);
    // Same situation a tick later: silence.
    expect(monsterPerception(world, now + TICK_MS)).toHaveLength(0);
    expect(monsterPerception(world, now + MONSTER_THINK_INTERVAL_MS - 1)).toHaveLength(0);
    // And once the cadence has elapsed, it may think again.
    expect(monsterPerception(world, now + MONSTER_THINK_INTERVAL_MS)).toHaveLength(1);
  });

  it("says nothing about prey far out of its range", () => {
    const world = new World();
    const devot = makeDevot({ pos: { x: 28, y: 0, z: 28 } });
    world.devots.set(devot.id, devot);
    spawnMonster(world, -28, -28);
    expect(monsterPerception(world)).toHaveLength(0);
  });

  it("stays quiet while already hunting — it has made its choice", () => {
    const world = new World();
    const devot = makeDevot({ pos: { x: 1, y: 0, z: 0 } });
    world.devots.set(devot.id, devot);
    const monster = spawnMonster(world, 0, 0);
    monster.currentGoal = { kind: "hunt", targetId: devot.id };
    expect(monsterPerception(world)).toHaveLength(0);
  });
});
