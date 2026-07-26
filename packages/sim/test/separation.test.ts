import { describe, expect, it } from "vitest";
import type { DevotEntity } from "@devot/shared";
import {
  ATTACK_RADIUS,
  BODY_RADIUS_DEVOT,
  BODY_RADIUS_MONSTER,
  defaultIdentity,
  encodeIdentity,
  terrainHeight,
} from "@devot/shared";
import { monsterSystem, separateBodies, spawnMonster, tick, World } from "../src/index.js";

/**
 * Nothing used to stop two creatures standing in the exact same spot: bodies
 * slid through one another, a fight looked like one model wearing another, and
 * a crowd rendered as a single lump.
 */

let seq = 0;
function makeDevot(x: number, z = 0): DevotEntity {
  return {
    id: `d${++seq}`, godId: "g1", isFounder: false, generation: 1, wallet: "",
    name: `D${seq}`, pos: { x, y: terrainHeight(x, z), z },
    balance: 60_000, bornWith: 60_000, capacity: 60_000, state: "alive",
    profile: "frugal", traits: [], identityJson: encodeIdentity(defaultIdentity([])),
    items: [], age: 0, thinking: false, utterance: "", currentGoal: { kind: "idle" },
  };
}

const gap = (a: { pos: { x: number; z: number } }, b: { pos: { x: number; z: number } }) =>
  Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

describe("no two bodies stand in the same place", () => {
  it("pushes two overlapping devots apart", () => {
    const world = new World(30);
    const a = makeDevot(0);
    const b = makeDevot(0.1);
    world.devots.set(a.id, a);
    world.devots.set(b.id, b);

    tick(world);
    expect(gap(a, b)).toBeGreaterThanOrEqual(BODY_RADIUS_DEVOT * 2 - 1e-6);
  });

  it("gives a monster more room than a devot", () => {
    const world = new World(30);
    const d = makeDevot(0);
    world.devots.set(d.id, d);
    const m = spawnMonster(world, 0.1, 0);

    tick(world);
    monsterSystem(world);
    expect(gap(d, m)).toBeGreaterThanOrEqual(BODY_RADIUS_DEVOT + BODY_RADIUS_MONSTER - 1e-6);
  });

  it("still lets them reach each other to fight", () => {
    // The whole risk of this feature: separation wider than ATTACK_RADIUS and
    // nothing could ever get in range again, so combat would silently stop.
    expect(BODY_RADIUS_DEVOT * 2).toBeLessThan(ATTACK_RADIUS);
    expect(BODY_RADIUS_DEVOT + BODY_RADIUS_MONSTER).toBeLessThan(ATTACK_RADIUS);
  });

  it("survives two bodies at exactly the same point", () => {
    // Dividing by a zero distance turns both positions into NaN, and a NaN body
    // is gone from the world for good — it can never be drawn, reached or hit.
    const world = new World(30);
    const a = makeDevot(3);
    const b = makeDevot(3);
    world.devots.set(a.id, a);
    world.devots.set(b.id, b);

    separateBodies(world);
    for (const p of [a.pos, b.pos]) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }
    expect(gap(a, b)).toBeGreaterThan(0);
  });

  it("settles a crowd instead of jittering forever", () => {
    const world = new World(30);
    const crowd = Array.from({ length: 8 }, (_, i) => makeDevot(i * 0.05, 0));
    for (const d of crowd) world.devots.set(d.id, d);

    for (let i = 0; i < 30; i++) tick(world);

    for (let i = 0; i < crowd.length; i++) {
      for (let j = i + 1; j < crowd.length; j++) {
        expect(gap(crowd[i]!, crowd[j]!)).toBeGreaterThanOrEqual(BODY_RADIUS_DEVOT * 2 - 0.02);
      }
    }
  });

  it("never shoves anybody off the map or into a boulder", () => {
    const world = new World(30);
    // Jammed into a corner, where the only way out of each other is out of
    // the world.
    for (let i = 0; i < 6; i++) world.devots.set(`c${i}`, makeDevot(29.9, 29.9));

    for (let i = 0; i < 10; i++) tick(world);
    for (const d of world.aliveDevots()) {
      expect(Math.abs(d.pos.x)).toBeLessThanOrEqual(30);
      expect(Math.abs(d.pos.z)).toBeLessThanOrEqual(30);
      expect(d.pos.y).toBeCloseTo(terrainHeight(d.pos.x, d.pos.z), 6);
    }
  });

  it("lets the dead be walked over", () => {
    // A gravestone is scenery. A battlefield full of them must not become a
    // wall the living cannot cross.
    const world = new World(30);
    const corpse = makeDevot(5);
    corpse.state = "dead";
    const walker = makeDevot(5.05);
    world.devots.set(corpse.id, corpse);
    world.devots.set(walker.id, walker);

    const before = { ...corpse.pos };
    tick(world);
    expect(corpse.pos.x).toBeCloseTo(before.x, 6);
    expect(gap(corpse, walker)).toBeLessThan(BODY_RADIUS_DEVOT * 2);
  });
});
