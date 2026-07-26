import { describe, expect, it } from "vitest";
import type { DevotEntity } from "@devot/shared";
import { DEFAULT_IDENTITY, attackDrainFor } from "@devot/shared";
import {
  ATTACK_DRAIN_PER_TICK,
  ATTACK_EFFICIENCY,
  REPRO_MIN_HP,
  REPRO_PAIR_COST_FRACTION,
  REPRO_SOLO_COST_FRACTION,
  REPRO_TRANSFER_EFFICIENCY,
} from "@devot/shared";
import { applyDecision, resolveReproduction, tick, World } from "../src/index.js";

let seq = 0;
function makeDevot(overrides: Partial<DevotEntity> = {}): DevotEntity {
  return {
    id: `d${++seq}`,
    godId: "g1",
    isFounder: false,
    name: `Devot${seq}`,
    pos: { x: 0, y: 0, z: 0 },
    hp: 20_000,
    hpMax: 50_000,
    state: "alive",
    profile: "frugal",
    traits: ["curious"],
    identity: DEFAULT_IDENTITY,
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "idle" },
    ...overrides,
  };
}

describe("combat — vital predation", () => {
  it("transfers HP from the victim to the attacker (with loss)", () => {
    const world = new World();
    const attacker = makeDevot({ pos: { x: 0, y: 0, z: 0 } });
    const victim = makeDevot({ pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(attacker.id, attacker);
    world.devots.set(victim.id, victim);

    applyDecision(attacker, { action: "attack", targetId: victim.id }, world);
    const result = tick(world);

    expect(result.combats).toHaveLength(1);
    // The drain is the attacker's own, not the species': its power stat.
    const drain = attackDrainFor(attacker.identity.stats);
    // Victim: -drain -metabolism; attacker: +drain×efficiency -metabolism.
    expect(victim.hp).toBeCloseTo(20_000 - drain - 1, 5);
    expect(attacker.hp).toBeCloseTo(20_000 + drain * ATTACK_EFFICIENCY - 1, 5);
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
    expect(result.combats).toHaveLength(0); // pas encore au contact
  });

  it("a victim killed in combat dies 'devoured'", () => {
    const world = new World();
    const attacker = makeDevot();
    const victim = makeDevot({ pos: { x: 0.5, y: 0, z: 0 }, hp: 100 });
    world.devots.set(attacker.id, attacker);
    world.devots.set(victim.id, victim);
    applyDecision(attacker, { action: "attack", targetId: victim.id }, world);

    const result = tick(world);
    expect(result.deaths).toHaveLength(1);
    expect(result.deaths[0]!.cause).toContain("devoured");
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
    const parent = makeDevot({ hp: 20_000, traits: ["curious", "pious"] });
    world.devots.set(parent.id, parent);

    const outcome = resolveReproduction(world, parent, undefined, () => 0.99);
    expect("child" in outcome).toBe(true);
    if (!("child" in outcome)) return;

    const cost = 20_000 * REPRO_SOLO_COST_FRACTION;
    expect(parent.hp).toBeCloseTo(20_000 - cost, 5);
    expect(outcome.child.hp).toBeCloseTo(cost * REPRO_TRANSFER_EFFICIENCY, 5);
    expect(outcome.mode).toBe("budding");
    expect(outcome.child.isFounder).toBe(false);
    expect(outcome.child.godId).toBe(parent.godId);
  });

  it("sexual: both parents pay, the child accumulates", () => {
    const world = new World();
    const a = makeDevot({ hp: 20_000, godId: "g1" });
    const b = makeDevot({ hp: 30_000, godId: "g2", pos: { x: 1, y: 0, z: 0 } });
    world.devots.set(a.id, a);
    world.devots.set(b.id, b);

    const outcome = resolveReproduction(world, a, b.id, () => 0.4);
    expect("child" in outcome).toBe(true);
    if (!("child" in outcome)) return;

    const costA = 20_000 * REPRO_PAIR_COST_FRACTION;
    const costB = 30_000 * REPRO_PAIR_COST_FRACTION;
    expect(a.hp).toBeCloseTo(20_000 - costA, 5);
    expect(b.hp).toBeCloseTo(30_000 - costB, 5);
    expect(outcome.child.hp).toBeCloseTo((costA + costB) * REPRO_TRANSFER_EFFICIENCY, 5);
    expect(outcome.mode).toBe("sexual");
    // Suzerainty: the child is born under the initiator's god.
    expect(outcome.child.godId).toBe("g1");
  });

  it("refuses if the parent is too weak", () => {
    const world = new World();
    const parent = makeDevot({ hp: REPRO_MIN_HP - 1 });
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

  it("a reproduce decision records a consumable intent", () => {
    const world = new World();
    const devot = makeDevot();
    world.devots.set(devot.id, devot);
    applyDecision(devot, { action: "reproduce", targetId: "autre" }, world);
    expect(devot.pendingReproduction).toEqual({ partnerId: "autre" });
  });
});
