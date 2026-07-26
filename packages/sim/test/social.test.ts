import { describe, expect, it } from "vitest";
import type { DevotEntity } from "@devot/shared";
import {
  ATTACK_DRAIN_PER_TICK,
  ATTACK_EFFICIENCY,
  REPRO_MIN_BALANCE,
  REPRO_PAIR_COST_FRACTION,
  REPRO_SOLO_COST_FRACTION,
  REPRO_TRANSFER_EFFICIENCY,
  encodeIdentity,
  COMBAT_RESIDUE_FRACTION,
} from "@devot/shared";
import { applyDecision, perceptionSystem, resolveReproduction, tick, World } from "../src/index.js";

let seq = 0;
function makeDevot(overrides: Partial<DevotEntity> = {}): DevotEntity {
  return {
    id: `d${++seq}`,
    godId: "g1",
    isFounder: false,
    generation: 1,
    wallet: "",
    name: `Devot${seq}`,
    pos: { x: 0, y: 0, z: 0 },
    balance: 20_000,
    // Born at its capacity, like a founder, unless a test says otherwise.
    bornWith: overrides.bornWith ?? 50_000,
    capacity: 50_000,
    state: "alive",
    profile: "frugal",
    traits: ["curious"],
    identityJson: "",
    items: [],
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "idle" },
    ...overrides,
  };
}

describe("combat — vital predation", () => {
  it("transfers balance from victim to attacker (with loss)", () => {
    const world = new World();
    const attacker = makeDevot({ pos: { x: 0, y: 0, z: 0 } });
    const victim = makeDevot({ pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(attacker.id, attacker);
    world.devots.set(victim.id, victim);

    applyDecision(attacker, { action: "attack", targetId: victim.id }, world);
    const result = tick(world);

    expect(result.combats).toHaveLength(1);
    // Victim: -drain -metabolism; attacker: +drain*efficiency -metabolism.
    expect(victim.balance).toBeCloseTo(20_000 - ATTACK_DRAIN_PER_TICK - 1, 5);
    expect(attacker.balance).toBeCloseTo(
      20_000 + ATTACK_DRAIN_PER_TICK * ATTACK_EFFICIENCY - 1,
      5,
    );
  });

  it("alerts the victim only once (threat trigger)", () => {
    const world = new World();
    const attacker = makeDevot();
    const victim = makeDevot({ pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(attacker.id, attacker);
    world.devots.set(victim.id, victim);
    applyDecision(attacker, { action: "attack", targetId: victim.id }, world);

    const r1 = tick(world);
    expect(r1.triggers.filter((t) => t.kind === "threat")).toHaveLength(1);
    const r2 = tick(world);
    expect(r2.triggers.filter((t) => t.kind === "threat")).toHaveLength(0);
  });

  it("the attacker chases a target out of range", () => {
    const world = new World();
    const attacker = makeDevot();
    const victim = makeDevot({ pos: { x: 10, y: 0, z: 0 } });
    world.devots.set(attacker.id, attacker);
    world.devots.set(victim.id, victim);
    applyDecision(attacker, { action: "attack", targetId: victim.id }, world);

    const before = attacker.pos.x;
    const result = tick(world);
    expect(attacker.pos.x).toBeGreaterThan(before);
    expect(result.combats).toHaveLength(0); // not in contact yet
  });

  it("a victim killed in combat dies once, holding its estate", () => {
    const world = new World();
    const attacker = makeDevot();
    const victim = makeDevot({ pos: { x: 0.5, y: 0, z: 0 }, balance: 100 });
    world.devots.set(attacker.id, attacker);
    world.devots.set(victim.id, victim);
    applyDecision(attacker, { action: "attack", targetId: victim.id }, world);

    const result = tick(world);
    // Once. hungerSystem used to recompute a dead devot's state from its balance
    // before deathSystem ran, resurrecting it just long enough to be killed a
    // second time — and its estate dropped twice with it.
    expect(result.deaths).toHaveLength(1);
    expect(result.deaths[0]!.cause).toContain("killed by");
    // It dies holding 100 and still leaves everything it was given: a killer
    // takes a life, it does not take the deposit that bought one.
    expect(result.deaths[0]!.residue).toBe(victim.bornWith);
    expect(result.deaths[0]!.residue).toBeGreaterThan(victim.balance);
  });

  it("an attacker cannot drain a victim below the residue floor", () => {
    // What a killer cannot take is exactly what will be lying on the ground
    // afterwards, for anyone who saw the fight — the killer included, if it
    // stays. Draining someone is no longer the efficient way to take a life.
    const world = new World();
    const attacker = makeDevot({ balance: 60_000, capacity: 60_000 });
    const victim = makeDevot({ pos: { x: 0.5, y: 0, z: 0 }, balance: 60_000, capacity: 60_000 });
    world.devots.set(attacker.id, attacker);
    world.devots.set(victim.id, victim);
    applyDecision(attacker, { action: "attack", targetId: victim.id }, world);

    const floor = Math.round(60_000 * COMBAT_RESIDUE_FRACTION);
    let death;
    for (let i = 0; i < 4000 && !death; i++) {
      death = tick(world).deaths.find((d) => d.devotId === victim.id);
      // While it lives, the attacker has never pushed it under the floor.
      if (!death) expect(victim.balance).toBeGreaterThanOrEqual(floor - 1);
    }

    expect(death).toBeDefined();
    expect(death!.cause).toContain("killed by");
    // The floor governs what the KILLER may take. What lands on the ground is a
    // separate rule now — the whole of what the victim was given — so the two
    // are asserted apart. They used to be the same number, and reading one as
    // the other is exactly the confusion this test exists to prevent.
    expect(death!.residue).toBe(victim.bornWith);
  });

  it("you cannot attack yourself", () => {
    const world = new World();
    const devot = makeDevot();
    world.devots.set(devot.id, devot);
    applyDecision(devot, { action: "attack", targetId: devot.id }, world);
    expect(devot.currentGoal.kind).not.toBe("attack");
  });
});

describe("reproduction", () => {
  it("budding: cost to the parent, life passed to the child, mutated traits", () => {
    const world = new World();
    const parent = makeDevot({ balance: 20_000, traits: ["curious", "pious"] });
    world.devots.set(parent.id, parent);

    const outcome = resolveReproduction(world, parent, undefined, () => 0.99);
    expect("child" in outcome).toBe(true);
    if (!("child" in outcome)) return;

    const cost = 20_000 * REPRO_SOLO_COST_FRACTION;
    expect(parent.balance).toBeCloseTo(20_000 - cost, 5);
    expect(outcome.child.balance).toBeCloseTo(cost * REPRO_TRANSFER_EFFICIENCY, 5);
    expect(outcome.mode).toBe("budding");
    expect(outcome.child.isFounder).toBe(false);
    expect(outcome.child.godId).toBe(parent.godId);
  });

  it("sexual: both parents pay, the child accumulates", () => {
    const world = new World();
    const a = makeDevot({ balance: 20_000, godId: "g1" });
    const b = makeDevot({ balance: 30_000, godId: "g2", pos: { x: 1, y: 0, z: 0 } });
    world.devots.set(a.id, a);
    world.devots.set(b.id, b);

    const outcome = resolveReproduction(world, a, b.id, () => 0.4);
    expect("child" in outcome).toBe(true);
    if (!("child" in outcome)) return;

    const costA = 20_000 * REPRO_PAIR_COST_FRACTION;
    const costB = 30_000 * REPRO_PAIR_COST_FRACTION;
    expect(a.balance).toBeCloseTo(20_000 - costA, 5);
    expect(b.balance).toBeCloseTo(30_000 - costB, 5);
    expect(outcome.child.balance).toBeCloseTo((costA + costB) * REPRO_TRANSFER_EFFICIENCY, 5);
    expect(outcome.mode).toBe("sexual");
    // Overlordship: the child is born under the initiator's god.
    expect(outcome.child.godId).toBe("g1");
  });

  it("refuses if the parent is too weak", () => {
    const world = new World();
    const parent = makeDevot({ balance: REPRO_MIN_BALANCE - 1 });
    world.devots.set(parent.id, parent);
    const outcome = resolveReproduction(world, parent, undefined);
    expect(outcome).toEqual({ reason: "too weak to procreate" });
  });

  it("refuses if the partner is too far away", () => {
    const world = new World();
    const a = makeDevot();
    const b = makeDevot({ pos: { x: 20, y: 0, z: 0 } });
    world.devots.set(a.id, a);
    world.devots.set(b.id, b);
    const outcome = resolveReproduction(world, a, b.id);
    expect(outcome).toEqual({ reason: "partner too far away" });
  });

  it("a reproduce decision leaves a consumable intent", () => {
    const world = new World();
    const devot = makeDevot();
    world.devots.set(devot.id, devot);
    applyDecision(devot, { action: "reproduce", targetId: "autre" }, world);
    expect(devot.pendingReproduction).toEqual({ partnerId: "autre" });
  });
});

describe("perception — appearance carries social weight", () => {
  it("an encounter describes what the other WEARS, not just their id", () => {
    // This is the whole point of T2: the appearance chosen at creation must reach
    // the neighbour's prompt. Without that it stays decorative.
    const world = new World();
    const king = makeDevot({
      name: "King",
      pos: { x: 0, y: 0, z: 0 },
      identityJson: encodeIdentity({
        appearance: {
          hat: "crown",
          shirt: "#e0b34c",
          pants: "#5a3a4a",
          cape: "long",
          face: "none",
          skin: "#f0c9a4",
          build: "heavy",
        },
        stats: { vitality: 5, power: 4, speed: 2, sight: 1 },
        soul: "",
        signature: "DVT-000-0000",
      }),
    });
    const pauper = makeDevot({ name: "Pauper", godId: "g2", pos: { x: 1, y: 0, z: 0 } });
    world.devots.set(king.id, king);
    world.devots.set(pauper.id, pauper);

    const triggers = perceptionSystem(world);
    const seen = triggers.find((t) => t.devotId === pauper.id);
    expect(seen, "the pauper must spot the king").toBeDefined();
    expect(seen!.eventText).toContain("crown");
    expect(seen!.eventText).toContain("saffron"); // the named colour, not the hex code
    expect(seen!.eventText).toContain("long cape");
    expect(seen!.eventText).toContain("heavy");
    // And never a raw colour code: "#e0b34c" means nothing to a model.
    expect(seen!.eventText).not.toContain("#");
  });

  it("a devot with no identity is still described, without breaking perception", () => {
    // A devot from before this version, or born in god mode, has no identity.
    const world = new World();
    const a = makeDevot({ pos: { x: 0, y: 0, z: 0 }, identityJson: "" });
    const b = makeDevot({ godId: "g2", pos: { x: 1, y: 0, z: 0 }, identityJson: "" });
    world.devots.set(a.id, a);
    world.devots.set(b.id, b);
    const triggers = perceptionSystem(world);
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers[0]!.eventText).toContain("unremarkable appearance");
  });
});
