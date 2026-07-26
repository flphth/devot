import { describe, expect, it } from "vitest";
import type { DevotEntity } from "@devot/shared";
import { defaultIdentity, encodeIdentity, terrainHeight } from "@devot/shared";
import {
  applyMonsterDecision,
  describeMonsterSurroundings,
  monsterSystem,
  spawnMonster,
  World,
} from "../src/index.js";

let seq = 0;
function makeDevot(overrides: Partial<DevotEntity> = {}): DevotEntity {
  const pos = overrides.pos ?? { x: 0, y: 0, z: 0 };
  return {
    id: `d${++seq}`,
    godId: "g1",
    isFounder: false,
    generation: 1,
    wallet: "",
    name: `Prey${seq}`,
    balance: 100_000,
    // Born at its capacity, like a founder, unless a test says otherwise.
    bornWith: overrides.bornWith ?? 150_000,
    capacity: 150_000,
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

describe("a monster's mind steers a body that already hunts", () => {
  it("hunts on instinct when it has never had a thought", () => {
    // The point of keeping instinct: a monster is still dangerous when the
    // inference budget is spent, exactly as it was before it had a mind.
    const world = new World();
    const prey = makeDevot({ pos: { x: 2, y: 0, z: 0 } });
    world.devots.set(prey.id, prey);
    const monster = spawnMonster(world, 0, 0);

    monsterSystem(world);
    expect(monster.targetId).toBe(prey.id);
  });

  it("obeys a mind that named a different target", () => {
    const world = new World();
    const near = makeDevot({ pos: { x: 1, y: 0, z: 0 } });
    const far = makeDevot({ pos: { x: 6, y: 0, z: 0 } });
    world.devots.set(near.id, near);
    world.devots.set(far.id, far);
    const monster = spawnMonster(world, 0, 0);

    applyMonsterDecision(monster, { action: "attack", targetId: far.id }, world);
    monsterSystem(world);
    expect(monster.targetId).toBe(far.id);
  });

  it("lies in wait when it chose to, instead of taking the nearest thing", () => {
    const world = new World();
    const prey = makeDevot({ pos: { x: 2, y: 0, z: 0 } });
    world.devots.set(prey.id, prey);
    const monster = spawnMonster(world, 0, 0);

    applyMonsterDecision(monster, { action: "idle" }, world);
    monsterSystem(world);
    expect(monster.targetId).toBeUndefined();
  });

  it("breaks off and runs when it chose to flee", () => {
    const world = new World();
    const prey = makeDevot({ pos: { x: 2, y: 0, z: 0 } });
    world.devots.set(prey.id, prey);
    const monster = spawnMonster(world, 0, 0);
    const before = monster.pos.x;

    // Same convention as a devot's flee: the direction given is the way it runs.
    applyMonsterDecision(monster, { action: "flee", direction: { x: 1, z: 0 } }, world);
    monsterSystem(world);
    expect(monster.targetId).toBeUndefined();
    expect(monster.pos.x).toBeGreaterThan(before);
  });

  it("falls back to instinct when the prey it named is dead", () => {
    const world = new World();
    const chosen = makeDevot({ pos: { x: 6, y: 0, z: 0 } });
    const other = makeDevot({ pos: { x: 1, y: 0, z: 0 } });
    world.devots.set(chosen.id, chosen);
    world.devots.set(other.id, other);
    const monster = spawnMonster(world, 0, 0);

    applyMonsterDecision(monster, { action: "attack", targetId: chosen.id }, world);
    chosen.state = "dead";
    monsterSystem(world);
    expect(monster.targetId).toBe(other.id);
  });

  it("never breeds, whatever it answers", () => {
    const world = new World();
    const monster = spawnMonster(world, 0, 0);
    applyMonsterDecision(monster, { action: "reproduce" }, world);
    expect(world.monsters.size).toBe(1);
    expect(monster.intent).toBeUndefined();
  });
});

describe("what a monster is shown", () => {
  it("ranks the living by distance and says how weak they are", () => {
    const world = new World();
    const weak = makeDevot({ pos: { x: 1, y: 0, z: 0 }, balance: 15_000, state: "dying" });
    world.devots.set(weak.id, weak);
    const monster = spawnMonster(world, 0, 0);

    const text = describeMonsterSurroundings(monster, world);
    expect(text).toContain(`id "${weak.id}"`);
    expect(text).toContain("dying");
  });

  it("flags a devot that is coming for it — the fact that decides everything", () => {
    const world = new World();
    const hunter = makeDevot({ pos: { x: 1, y: 0, z: 0 } });
    world.devots.set(hunter.id, hunter);
    const monster = spawnMonster(world, 0, 0);
    hunter.currentGoal = { kind: "attack", targetId: monster.id };

    expect(describeMonsterSurroundings(monster, world)).toContain("COMING FOR YOU");
  });

  it("says plainly when there is nothing to eat", () => {
    const world = new World();
    const monster = spawnMonster(world, 0, 0);
    expect(describeMonsterSurroundings(monster, world)).toContain("Nothing living");
  });
});
