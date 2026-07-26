import { describe, expect, it } from "vitest";
import type { DevotEntity } from "@devot/shared";
import {
  THREAT_REALERT_MS,
  defaultIdentity,
  encodeIdentity,
  terrainHeight,
} from "@devot/shared";
import { applyDecision, monsterSystem, spawnMonster, tick, World } from "../src/index.js";

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
    hp: 100_000,
    hpMax: 150_000,
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

/**
 * A devot being eaten used to keep grazing until a thought landed — which could
 * be seconds away, queued behind another devot or waiting on the budget. These
 * are the cases that were silently broken.
 */
describe("a body under attack reacts on its own", () => {
  it("strikes back at something weaker than it", () => {
    const world = new World();
    const victim = makeDevot({ hp: 100_000, pos: { x: 0, y: 0, z: 0 } });
    const bully = makeDevot({ hp: 20_000, pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(victim.id, victim);
    world.devots.set(bully.id, bully);

    applyDecision(bully, { action: "attack", targetId: victim.id }, world);
    tick(world); // the blow lands, the reflex is set

    expect(victim.currentGoal).toEqual({ kind: "attack", targetId: bully.id });
  });

  it("runs from something stronger than it", () => {
    const world = new World();
    const victim = makeDevot({ hp: 20_000, pos: { x: 0, y: 0, z: 0 } });
    const bully = makeDevot({ hp: 100_000, pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(victim.id, victim);
    world.devots.set(bully.id, bully);

    applyDecision(bully, { action: "attack", targetId: victim.id }, world);
    tick(world);

    expect(victim.currentGoal.kind).toBe("flee");
  });

  it("turns and fights a monster even when hopelessly outmatched", () => {
    // A monster moves faster than a devot, so running is a slower death with
    // the same ending. The body fights whatever the odds — which is also the
    // only way anyone ever collects a monster's hoard.
    const world = new World();
    const victim = makeDevot({ hp: 5_000, pos: { x: 0, y: 0, z: 0 } });
    world.devots.set(victim.id, victim);
    const monster = spawnMonster(world, 0.4, 0);

    monsterSystem(world);
    tick(world);
    expect(victim.currentGoal).toEqual({ kind: "attack", targetId: monster.id });
  });

  it("obeys a mind that has already chosen", () => {
    // The reflex is for a body with nothing better to do. A devot that decided
    // to walk somewhere keeps walking — overruling it would make the mind's
    // decisions meaningless.
    const world = new World();
    const victim = makeDevot({ hp: 20_000, pos: { x: 0, y: 0, z: 0 } });
    const bully = makeDevot({ hp: 100_000, pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(victim.id, victim);
    world.devots.set(bully.id, bully);
    applyDecision(bully, { action: "attack", targetId: victim.id }, world);

    victim.currentGoal = { kind: "move_to", target: { x: 20, y: 0, z: 20 } };
    tick(world);
    expect(victim.currentGoal.kind).toBe("move_to");
  });

  it("stops reacting once the attacker is gone", () => {
    const world = new World();
    const victim = makeDevot({ hp: 100_000, pos: { x: 0, y: 0, z: 0 } });
    const bully = makeDevot({ hp: 20_000, pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(victim.id, victim);
    world.devots.set(bully.id, bully);
    applyDecision(bully, { action: "attack", targetId: victim.id }, world);
    tick(world);

    bully.state = "dead";
    victim.currentGoal = { kind: "wander" };
    tick(world);
    expect(victim.underAttackBy).toBeUndefined();
    expect(victim.currentGoal.kind).toBe("wander");
  });
});

describe("an alert that was missed is raised again", () => {
  it("does not repeat itself tick after tick", () => {
    const world = new World();
    const victim = makeDevot({ pos: { x: 0, y: 0, z: 0 } });
    const bully = makeDevot({ pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(victim.id, victim);
    world.devots.set(bully.id, bully);
    applyDecision(bully, { action: "attack", targetId: victim.id }, world);

    const now = Date.now();
    const first = tick(world, now).triggers.filter((t) => t.kind === "threat");
    const second = tick(world, now + 250).triggers.filter((t) => t.kind === "threat");
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("but tells the victim again if it is still being torn apart", () => {
    const world = new World();
    const victim = makeDevot({ pos: { x: 0, y: 0, z: 0 } });
    const bully = makeDevot({ pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(victim.id, victim);
    world.devots.set(bully.id, bully);
    applyDecision(bully, { action: "attack", targetId: victim.id }, world);

    const now = Date.now();
    tick(world, now);
    const later = tick(world, now + THREAT_REALERT_MS + 1).triggers.filter(
      (t) => t.kind === "threat",
    );
    expect(later).toHaveLength(1);
  });
});
