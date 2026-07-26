import { describe, expect, it } from "vitest";
import type { DevotEntity, FoodEntity } from "@devot/shared";
import {
  defaultIdentity,
  encodeIdentity,
  terrainHeight,
} from "@devot/shared";
import {
  applyDecision,
  legacyOf,
  monsterSystem,
  resolveReproduction,
  spawnMonster,
  tick,
  World,
} from "../src/index.js";

/**
 * WHAT A DEATH LEAVES BEHIND.
 *
 * The deposit that buys a devot never leaves LifeVault: nothing is withdrawn on
 * chain and the burn is only ever a number in this simulation. So thinking does
 * not destroy the principal, it destroys the CREATURE — and when the creature is
 * gone the principal comes back to the world for whoever is standing there.
 *
 * Before this, the rule was decided in four separate places that had already
 * drifted: combat and monsters dropped 15% of capacity, divine lightning dropped
 * the current balance, and dying of exhaustion dropped NOTHING — which is how
 * most devots die, so the relic system almost never fired at all.
 */

let seq = 0;
function makeDevot(overrides: Partial<DevotEntity> = {}): DevotEntity {
  const pos = overrides.pos ?? { x: 0, y: 0, z: 0 };
  return {
    id: `d${++seq}`,
    godId: "g1",
    isFounder: true,
    generation: 1,
    wallet: "",
    name: `D${seq}`,
    balance: 60_000,
    bornWith: overrides.bornWith ?? 60_000,
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

function relic(id: string, x: number, z: number, funds: number): FoodEntity {
  return {
    id,
    pos: { x, y: terrainHeight(x, z), z },
    type: "legacy",
    worth: 0,
    source: "spawn",
    spawnedAt: Date.now(),
    ttlMs: 180_000,
    funds,
    leftBy: "the dead",
  };
}

describe("every death leaves the whole of what it was given", () => {
  it("dying of exhaustion leaves everything, not nothing", () => {
    // The case that matters most, because it is how most devots die. It used to
    // drop zero, so the richest system in the game almost never ran.
    const world = new World();
    const devot = makeDevot({ balance: 0.5, bornWith: 60_000 });
    world.devots.set(devot.id, devot);

    const death = tick(world).deaths.find((d) => d.devotId === devot.id);
    expect(death?.cause).toBe("vital exhaustion");
    expect(death?.residue).toBe(60_000);
  });

  it("a devot killed at a fifth of its life still leaves all of it", () => {
    const world = new World();
    const attacker = makeDevot({ balance: 60_000 });
    const victim = makeDevot({ pos: { x: 0.5, y: 0, z: 0 }, balance: 12_000 });
    world.devots.set(attacker.id, attacker);
    world.devots.set(victim.id, victim);
    applyDecision(attacker, { action: "attack", targetId: victim.id }, world);

    let death;
    for (let i = 0; i < 500 && !death; i++) {
      death = tick(world).deaths.find((d) => d.devotId === victim.id);
    }
    expect(death?.residue).toBe(60_000);
  });

  it("a devot taken by a monster leaves the same estate as any other", () => {
    const world = new World();
    const prey = makeDevot({ balance: 20_000 });
    world.devots.set(prey.id, prey);
    spawnMonster(world, 0.4, 0);

    let kill;
    for (let i = 0; i < 500 && !kill; i++) {
      kill = monsterSystem(world).kills.find((k) => k.devotId === prey.id);
      tick(world);
    }
    expect(kill?.residue).toBe(60_000);
  });

  it("a child leaves what it was born with, not what its body could hold", () => {
    // The reason bornWith exists at all. A founder is born at exactly its
    // capacity; a child is born with whatever its parents could pay, against a
    // capacity derived from its own inherited vitality. Reading `capacity` here
    // would quietly hand every child an estate it never had.
    const world = new World();
    const parent = makeDevot({ balance: 50_000 });
    world.devots.set(parent.id, parent);

    const outcome = resolveReproduction(world, parent, undefined, () => 0.5);
    expect("child" in outcome).toBe(true);
    if (!("child" in outcome)) return;

    const child = outcome.child;
    expect(child.bornWith).toBe(child.balance);
    expect(child.bornWith).not.toBe(child.capacity);
    expect(legacyOf(child)).toBe(Math.round(child.balance));
  });

  it("divine lightning is no longer the odd one out", () => {
    // It used to drop the current balance while every other death dropped a
    // fraction of capacity. All four paths read the same function now.
    const devot = makeDevot({ balance: 3, bornWith: 60_000 });
    expect(legacyOf(devot)).toBe(60_000);
  });
});

describe("a relic goes to exactly one taker", () => {
  it("credits the finder in full, with no ceiling at its capacity", () => {
    const world = new World();
    const finder = makeDevot({ balance: 55_000 });
    world.devots.set(finder.id, finder);
    world.food.set("r1", relic("r1", 0, 0, 60_000));

    const claimed = tick(world).claimed;
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.funds).toBe(60_000);
    // The room adds it to the body without clamping — a devot may end up
    // carrying more than it was born with, which is the whole prize.
    expect(claimed[0]!.funds).toBeGreaterThan(finder.capacity - finder.balance);
  });

  it("cannot be taken twice by two devots standing on it", () => {
    const world = new World();
    const a = makeDevot({ pos: { x: 0, y: 0, z: 0 } });
    const b = makeDevot({ pos: { x: 0.1, y: 0, z: 0 } });
    world.devots.set(a.id, a);
    world.devots.set(b.id, b);
    world.food.set("r1", relic("r1", 0.05, 0, 60_000));

    const claimed = tick(world).claimed;
    expect(claimed).toHaveLength(1);
    expect(world.food.has("r1")).toBe(false);
  });

  it("cannot be taken by a devot and a monster in the same tick", () => {
    const world = new World();
    const devot = makeDevot({ pos: { x: 0, y: 0, z: 0 } });
    world.devots.set(devot.id, devot);
    spawnMonster(world, 0.1, 0);
    world.food.set("r1", relic("r1", 0.05, 0, 60_000));

    const claimed = tick(world).claimed;
    const scavenged = monsterSystem(world).scavenged;
    // Exactly one of them gets it, and it is gone either way. Not asserting
    // which: the beast is also mauling the devot on the same tick, so its hoard
    // is not a clean read of what the relic paid.
    expect(claimed.length + scavenged.length).toBe(1);
    expect(world.food.has("r1")).toBe(false);
  });

  it("a monster takes the whole relic into its hoard", () => {
    const world = new World();
    const beast = spawnMonster(world, 0, 0);
    world.food.set("r1", relic("r1", 0.1, 0, 60_000));

    const scavenged = monsterSystem(world).scavenged;
    expect(scavenged).toHaveLength(1);
    expect(scavenged[0]!.funds).toBe(60_000);
    expect(beast.hoard).toBe(60_000);
  });
});

describe("the books still balance", () => {
  it("value never appears from nowhere, and a death restores exactly once", () => {
    // Measured, not predicted. The first version of this test tried to model
    // every sink and was wrong by 23,298 — because two of them are invisible:
    // an attacker already at capacity has its winnings CLAMPED away (so a full
    // devot that kills someone destroys everything it drains), and a victim's
    // balance is zeroed on death while its relic is worth bornWith instead.
    //
    // So this asserts the property that actually matters and needs no model of
    // the sinks: between two ticks the world can only ever get POORER, except
    // by exactly what a death restored or a meal was worth. Nothing appears.
    const world = new World();
    const attacker = makeDevot({ balance: 60_000, pos: { x: 0, y: 0, z: 0 } });
    const victim = makeDevot({ balance: 30_000, pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(attacker.id, attacker);
    world.devots.set(victim.id, victim);
    applyDecision(attacker, { action: "attack", targetId: victim.id }, world);

    const worth = () =>
      world.aliveDevots().reduce((n, d) => n + d.balance, 0) +
      [...world.food.values()].reduce((n, f) => n + (f.funds ?? 0), 0) +
      world.aliveMonsters().reduce((n, m) => n + m.balance + m.hoard, 0);

    const restoredFor = new Map<string, number>();
    let seq = 0;

    for (let i = 0; i < 400; i++) {
      const before = worth();
      const r = tick(world);

      let restored = 0;
      for (const d of r.deaths) {
        const who = world.devots.get(d.devotId)!;
        // Exactly what it was given, and once per corpse. A devot reported dead
        // twice used to drop its estate twice with it.
        expect(d.residue).toBe(who.bornWith);
        expect(restoredFor.has(d.devotId)).toBe(false);
        restoredFor.set(d.devotId, d.residue);
        restored += d.residue;
        world.food.set(`legacy-${seq}`, relic(`legacy-${seq++}`, who.pos.x + 9, who.pos.z, d.residue));
      }
      for (const c of r.claimed) world.devots.get(c.devotId)!.balance += c.funds;
      const eaten = r.eaten.reduce((n, e) => n + e.worth, 0);

      // The only two ways the world may be richer than it was a tick ago.
      expect(worth()).toBeLessThanOrEqual(before + restored + eaten + 1e-6);
    }

    // And the fight really did end in a death, or the loop above proved nothing.
    expect([...restoredFor.values()]).toEqual([60_000]);
  });
});
