import { describe, expect, it } from "vitest";
import { defaultIdentity, encodeIdentity, type DevotEntity } from "@devot/shared";
import { describeSurroundings, World } from "../src/index.js";

/**
 * What a devot is told about its surroundings is what it can act on. These
 * tests guard the boundary: nothing beyond its own sight may leak into the
 * description, because that description goes straight into a prompt.
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
    capacity: 150_000,
    state: "alive",
    profile: "frugal",
    traits: [],
    identityJson: encodeIdentity(defaultIdentity()),
    items: [],
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "wander" },
    ...over,
  };
}

function worldWith(...devots: DevotEntity[]): World {
  const world = new World();
  for (const d of devots) world.devots.set(d.id, d);
  return world;
}

describe("describeSurroundings — the boundary of what a mind may know", () => {
  it("says plainly when nothing is in sight", () => {
    const me = makeDevot();
    expect(describeSurroundings(me, worldWith(me))).toContain("nothing and no one");
  });

  it("reports a devot standing close by", () => {
    const me = makeDevot();
    const near = makeDevot({ name: "Kain", pos: { x: 3, y: 0, z: 0 } });
    const text = describeSurroundings(me, worldWith(me, near));
    expect(text).toContain("Kain");
    expect(text).toContain(`id "${near.id}"`);
  });

  it("does NOT leak a devot beyond sight", () => {
    // The case that matters: everything in this string reaches the model, so a
    // devot 200 units away must be as absent as if it did not exist.
    const me = makeDevot();
    const far = makeDevot({ name: "Ghost", pos: { x: 200, y: 0, z: 200 } });
    expect(describeSurroundings(me, worldWith(me, far))).not.toContain("Ghost");
  });

  it("does not report the dead, nor the devot itself", () => {
    const me = makeDevot({ name: "Self" });
    const corpse = makeDevot({ name: "Corpse", pos: { x: 2, y: 0, z: 0 }, state: "dead" });
    const text = describeSurroundings(me, worldWith(me, corpse));
    expect(text).not.toContain("Corpse");
    expect(text).not.toContain(`id "${me.id}"`);
  });

  it("says outright when someone is attacking YOU", () => {
    // A devot that cannot tell it is being eaten cannot decide to flee.
    const me = makeDevot();
    const attacker = makeDevot({
      name: "Wolf",
      pos: { x: 2, y: 0, z: 0 },
      currentGoal: { kind: "attack", targetId: "" },
    });
    attacker.currentGoal = { kind: "attack", targetId: me.id };
    expect(describeSurroundings(me, worldWith(me, attacker))).toContain("ATTACKING YOU");
  });

  it("distinguishes a rival line from your own", () => {
    const me = makeDevot();
    const rival = makeDevot({ name: "Other", godId: "g2", pos: { x: 2, y: 0, z: 0 } });
    expect(describeSurroundings(me, worldWith(me, rival))).toContain("a rival line");
  });

  it("reports visible food with the id the model must quote back", () => {
    const me = makeDevot();
    const world = worldWith(me);
    world.food.set("f1", {
      id: "f1",
      pos: { x: 2, y: 0, z: 0 },
      type: "grain",
      worth: 800,
      source: "spawn",
      spawnedAt: Date.now(),
      ttlMs: 10 * 60_000,
    });
    expect(describeSurroundings(me, world)).toContain('id "f1"');
  });

  it("caps the list instead of pouring a crowd into the prompt", () => {
    // Every line costs the devot real life, so a crowd must be summarised.
    const me = makeDevot();
    const crowd = Array.from({ length: 10 }, (_, i) =>
      makeDevot({ pos: { x: 1 + i * 0.2, y: 0, z: 0 } }),
    );
    const text = describeSurroundings(me, worldWith(me, ...crowd));
    expect(text.split("\n").filter((l) => l.startsWith("- ")).length).toBeLessThanOrEqual(7);
    expect(text).toContain("more devots, further off");
  });

  it("keeps the self block bounded too — it rides in every single prompt", () => {
    const me = makeDevot();
    me.balanceAtLastThought = me.balance + 5000;
    me.attackedBy = ["a", "b", "c", "d"];
    const text = describeSurroundings(me, worldWith(me));
    expect(text.split("\n").filter((l) => l.startsWith("· ")).length).toBeLessThanOrEqual(4);
  });
});
