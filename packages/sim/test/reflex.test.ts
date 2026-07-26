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
    hp: 55_000,
    hpMax: 60_000,
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
    const victim = makeDevot({ hp: 55_000, pos: { x: 0, y: 0, z: 0 } });
    const bully = makeDevot({ hp: 20_000, pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(victim.id, victim);
    world.devots.set(bully.id, bully);

    applyDecision(bully, { action: "attack", targetId: victim.id }, world);
    tick(world); // the blow lands, the reflex is set

    expect(victim.currentGoal).toEqual({ kind: "attack", targetId: bully.id });
  });

  it("runs from something stronger than it", () => {
    const world = new World();
    const victim = makeDevot({ hp: 30_000, pos: { x: 0, y: 0, z: 0 } });
    const bully = makeDevot({ hp: 55_000, pos: { x: 0.5, y: 0, z: 0 } });
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
    const victim = makeDevot({ hp: 30_000, pos: { x: 0, y: 0, z: 0 } });
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
    const victim = makeDevot({ hp: 30_000, pos: { x: 0, y: 0, z: 0 } });
    const bully = makeDevot({ hp: 55_000, pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(victim.id, victim);
    world.devots.set(bully.id, bully);
    applyDecision(bully, { action: "attack", targetId: victim.id }, world);

    victim.currentGoal = { kind: "move_to", target: { x: 20, y: 0, z: 20 } };
    tick(world);
    expect(victim.currentGoal.kind).toBe("move_to");
  });

  it("stops reacting once the attacker is gone", () => {
    const world = new World();
    const victim = makeDevot({ hp: 55_000, pos: { x: 0, y: 0, z: 0 } });
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

describe("a monster on you overrides what the mind decided", () => {
  it("fights back even when the mind keeps choosing to run", () => {
    // This is the bug that made devots look passive in play: the reflex only
    // overrode PASSIVE goals, and with a devot thinking every ten seconds one
    // decision to flee stuck forever. It ran, the beast followed, and it never
    // fought back once — all the way to being eaten.
    const world = new World();
    const victim = makeDevot({ hp: 55_000, pos: { x: 0, y: 0, z: 0 } });
    world.devots.set(victim.id, victim);
    spawnMonster(world, 0.4, 0);

    let fought = 0;
    for (let i = 0; i < 12; i++) {
      applyDecision(victim, { action: "flee", direction: { x: 1, z: 0 } }, world);
      tick(world);
      monsterSystem(world);
      if (victim.currentGoal.kind === "attack") fought++;
    }
    expect(fought).toBeGreaterThanOrEqual(10);
  });

  it("but lets a devot run from a monster that is not on it yet", () => {
    // Choosing to leave before it closes is a real decision, and it keeps it.
    const world = new World();
    const victim = makeDevot({ hp: 55_000, pos: { x: 0, y: 0, z: 0 } });
    world.devots.set(victim.id, victim);
    spawnMonster(world, 25, 25);

    applyDecision(victim, { action: "flee", direction: { x: -1, z: -1 } }, world);
    tick(world);
    monsterSystem(world);
    expect(victim.currentGoal.kind).toBe("flee");
  });
});
