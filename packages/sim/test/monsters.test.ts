import { describe, expect, it } from "vitest";
import {
  MONSTER_HP_MAX,
  MONSTER_METABOLISM_HP_PER_TICK,
  defaultIdentity,
  encodeIdentity,
  type DevotEntity,
} from "@devot/shared";
import { applyDecision, monsterSystem, spawnMonster, tick, World } from "../src/index.js";

/**
 * Monsters are the one thing in this world that takes without ever paying for a
 * thought. These tests guard the two properties that keep that from breaking
 * the economy: it starves if it does not hunt, and everything it took comes
 * back when it dies.
 */

let seq = 0;
function makeDevot(over: Partial<DevotEntity> = {}): DevotEntity {
  return {
    id: `d${++seq}`,
    godId: "g1",
    isFounder: false,
    generation: 1,
    wallet: "",
    name: `Devot${seq}`,
    pos: { x: 0, y: 0, z: 0 },
    hp: 100_000,
    hpMax: 150_000,
    state: "alive",
    profile: "frugal",
    traits: [],
    identityJson: encodeIdentity(defaultIdentity()),
    items: [],
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "idle" },
    ...over,
  };
}

describe("a monster hunts", () => {
  it("closes on a devot in sight, then drains it", () => {
    const world = new World();
    const prey = makeDevot({ pos: { x: 6, y: 0, z: 0 } });
    world.devots.set(prey.id, prey);
    const monster = spawnMonster(world, 0, 0);

    for (let i = 0; i < 40; i++) monsterSystem(world);

    expect(monster.targetId).toBe(prey.id);
    expect(prey.hp, "the prey has been bled").toBeLessThan(100_000);
    expect(monster.hoard, "and the hoard has grown").toBeGreaterThan(0);
  });

  it("warns its prey, once, so the prey can decide", () => {
    const world = new World();
    const prey = makeDevot({ pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(prey.id, prey);
    spawnMonster(world, 0, 0);

    const first = monsterSystem(world).triggers;
    const second = monsterSystem(world).triggers;
    expect(first.filter((t) => t.kind === "threat")).toHaveLength(1);
    expect(second.filter((t) => t.kind === "threat"), "not once per tick").toHaveLength(0);
  });

  it("ignores a devot beyond its sight", () => {
    const world = new World(200);
    const far = makeDevot({ pos: { x: 150, y: 0, z: 150 } });
    world.devots.set(far.id, far);
    const monster = spawnMonster(world, 0, 0);
    monsterSystem(world);
    expect(monster.targetId).toBeUndefined();
    expect(far.hp).toBe(100_000);
  });
});

describe("a monster is not free to exist", () => {
  it("starves when there is nothing to hunt", () => {
    // The property that matters: without this, a monster is a one-way drain
    // that ends up holding everything anyone ever put in.
    const world = new World();
    const monster = spawnMonster(world, 0, 0);
    const ticks = Math.ceil(MONSTER_HP_MAX / MONSTER_METABOLISM_HP_PER_TICK);

    let death;
    for (let i = 0; i <= ticks; i++) {
      const r = monsterSystem(world);
      if (r.deaths.length > 0) death = r.deaths[0];
    }
    expect(death, "it died of hunger").toBeDefined();
    expect(monster.state).toBe("dead");
  });

  it("releases its whole hoard when it dies", () => {
    const world = new World();
    const monster = spawnMonster(world, 3, 4);
    monster.hoard = 12_345;
    monster.hp = MONSTER_METABOLISM_HP_PER_TICK;

    const death = monsterSystem(world).deaths[0];
    expect(death).toMatchObject({ hoard: 12_345, x: 3, z: 4 });
  });
});

describe("a devot can fight back", () => {
  it("may target a monster, and killing it releases the hoard where it fell", () => {
    const world = new World();
    const hero = makeDevot({ pos: { x: 0, y: 0, z: 0 } });
    world.devots.set(hero.id, hero);
    const monster = spawnMonster(world, 0.5, 0);
    monster.hoard = 9_000;
    monster.hp = 1; // one blow away

    applyDecision(hero, { action: "attack", targetId: monster.id }, world);
    expect(hero.currentGoal, "the goal really points at the monster").toEqual({
      kind: "attack",
      targetId: monster.id,
    });

    const result = tick(world);
    expect(result.monsterDeaths).toHaveLength(1);
    expect(result.monsterDeaths[0]).toMatchObject({ killerId: hero.id, hoard: 9_000 });
    expect(monster.state).toBe("dead");
  });
});
