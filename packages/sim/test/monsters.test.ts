import { describe, expect, it } from "vitest";
import {
  CAPACITY_DEFAULT,
  MONSTER_CAPACITY,
  MONSTER_MAX,
  TICK_MS,
  MONSTER_METABOLISM_PER_TICK,
  MONSTER_SPAWN_MIN_DISTANCE,
  defaultIdentity,
  encodeIdentity,
  type DevotEntity,
} from "@devot/shared";
import {
  applyDecision,
  dist2,
  findMonsterSpawn,
  monsterCeiling,
  monsterSystem,
  spawnMonster,
  tick,
  World,
} from "../src/index.js";

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
    balance: 100_000,
    bornWith: 100_000,
    capacity: 150_000,
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
    expect(prey.balance, "the prey has been bled").toBeLessThan(100_000);
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
    expect(far.balance).toBe(100_000);
  });
});

describe("a monster is not free to exist", () => {
  it("starves when there is nothing to hunt", () => {
    // The property that matters: without this, a monster is a one-way drain
    // that ends up holding everything anyone ever put in.
    const world = new World();
    const monster = spawnMonster(world, 0, 0);
    const ticks = Math.ceil(MONSTER_CAPACITY / MONSTER_METABOLISM_PER_TICK);

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
    monster.balance = MONSTER_METABOLISM_PER_TICK;

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
    monster.balance = 1; // one blow away

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

/**
 * The whole predator system was unreachable in a real game: `spawnMonster` was
 * called from the debug message and nowhere else, so unless a developer clicked
 * the button, no monster had ever existed — and the hunting, the hoards, the
 * scavenging and the fight-back reflex were all dead weight.
 */
describe("the world produces its own predators", () => {
  it("holds none at all while nothing is alive to hunt", () => {
    // A monster with no prey starves within the minute. Spawning one into an
    // empty world is pure waste, and it would think on the way down.
    expect(monsterCeiling(0)).toBe(0);
  });

  it("scales with the living, and stops", () => {
    expect(monsterCeiling(1)).toBe(1);
    expect(monsterCeiling(4)).toBe(2);
    expect(monsterCeiling(100)).toBe(MONSTER_MAX);
  });

  it("never puts one within sight of anybody", () => {
    const world = new World(30);
    const devot = makeDevot({ pos: { x: 0, y: 0, z: 0 } });
    world.devots.set(devot.id, devot);

    // Every candidate the rng offers lands right on top of the devot.
    expect(findMonsterSpawn(world, () => 0.5)).toBeUndefined();
  });

  it("gives up for this tick rather than spinning", () => {
    // On a crowded map there may be no far-enough spot at all. Looping until
    // one appears would hang the tick; skipping a spawn costs nothing.
    const world = new World(30);
    for (let i = 0; i < 40; i++) {
      const d = makeDevot({ pos: { x: (i % 7) * 8 - 24, y: 0, z: Math.floor(i / 7) * 8 - 24 } });
      world.devots.set(d.id, d);
    }
    let calls = 0;
    findMonsterSpawn(world, () => {
      calls++;
      return Math.random();
    });
    expect(calls).toBeLessThanOrEqual(24); // 12 attempts, two draws each
  });

  it("finds ground far from a lone devot in a corner", () => {
    const world = new World(30);
    const devot = makeDevot({ pos: { x: -27, y: 0, z: -27 } });
    world.devots.set(devot.id, devot);

    const at = findMonsterSpawn(world);
    expect(at).toBeDefined();
    expect(dist2({ ...at!, y: 0 }, devot.pos)).toBeGreaterThanOrEqual(
      MONSTER_SPAWN_MIN_DISTANCE * MONSTER_SPAWN_MIN_DISTANCE,
    );
  });

  it("refuses to spawn into a world with no devots at all", () => {
    expect(findMonsterSpawn(new World(30))).toBeUndefined();
  });
});

/**
 * THE THREE OUTCOMES THAT MAKE A MONSTER WORTH FIGHTING.
 *
 * These are the balance, stated as behaviour rather than as constants. A devot
 * used to need a hundred seconds of unbroken contact to bring one down while the
 * monster needed forty-nine to kill it — so a devot could never win, and a soak
 * over twenty-five minutes of world time killed exactly zero monsters. "Killing
 * a monster is the one act that pays" was unreachable by construction.
 *
 * Asserted as outcomes on purpose: anyone retuning ATTACK_DRAIN_PER_TICK or
 * MONSTER_DRAIN_PER_TICK will hear about it here, in the language of the design
 * rather than in numbers that mean nothing on their own.
 */
function duel(devots: number, monsterBalance: number) {
  const world = new World(30);
  const ds: DevotEntity[] = [];
  for (let i = 0; i < devots; i++) {
    // Today's real numbers, not the helper's: its defaults date from the
    // 150,000-capacity era and give a devot two and a half lives, which wins
    // duels it has no business winning.
    const d = makeDevot({
      pos: { x: 0.6 + i * 0.2, y: 0, z: 0 },
      balance: CAPACITY_DEFAULT,
      bornWith: CAPACITY_DEFAULT,
      capacity: CAPACITY_DEFAULT,
    });
    world.devots.set(d.id, d);
    ds.push(d);
  }
  const monster = spawnMonster(world, 0, 0);
  monster.balance = monsterBalance;

  for (let t = 0; t < 2000; t++) {
    for (const d of ds) {
      if (d.state !== "dead") applyDecision(d, { action: "attack", targetId: monster.id }, world);
    }
    tick(world);
    monsterSystem(world);
    const standing = ds.filter((d) => d.state !== "dead").length;
    if (monster.state === "dead") {
      return { winner: "devots" as const, seconds: (t * TICK_MS) / 1000, lost: devots - standing };
    }
    if (standing === 0) return { winner: "monster" as const, seconds: (t * TICK_MS) / 1000, lost: devots };
  }
  return { winner: "stalemate" as const, seconds: Infinity, lost: 0 };
}

describe("a monster is worth fighting, and worth fearing", () => {
  it("beats a lone devot when it is healthy", () => {
    const r = duel(1, MONSTER_CAPACITY);
    expect(r.winner).toBe("monster");
  });

  it("loses to a lone devot once it is wounded", () => {
    // The prize the whole economy points at: a beast carrying a hoard, hurt
    // enough to be taken. Without this the hoard is unreachable and every
    // monster simply starves back into the ground.
    const r = duel(1, MONSTER_CAPACITY * 0.6);
    expect(r.winner).toBe("devots");
  });

  it("loses to two devots together, and takes neither of them", () => {
    const r = duel(2, MONSTER_CAPACITY);
    expect(r.winner).toBe("devots");
    expect(r.lost).toBe(0);
  });

  it("settles in seconds, not in minutes", () => {
    // A fight used to be a hundred seconds of attrition that nobody watched.
    for (const r of [duel(1, MONSTER_CAPACITY), duel(2, MONSTER_CAPACITY)]) {
      expect(r.seconds).toBeLessThan(20);
      expect(r.seconds).toBeGreaterThan(3); // nor an instant, invisible blink
    }
  });
});
