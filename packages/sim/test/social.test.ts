import { describe, expect, it } from "vitest";
import type { DevotEntity } from "@devot/shared";
import {
  ATTACK_DRAIN_PER_TICK,
  ATTACK_EFFICIENCY,
  REPRO_MIN_HP,
  REPRO_PAIR_COST_FRACTION,
  REPRO_SOLO_COST_FRACTION,
  REPRO_TRANSFER_EFFICIENCY,
  encodeIdentity,
} from "@devot/shared";
import { applyDecision, perceptionSystem, resolveReproduction, tick, World } from "../src/index.js";

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
    state: "vivant",
    profile: "frugal",
    traits: ["curieux"],
    identityJson: "",
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "idle" },
    ...overrides,
  };
}

describe("combat — prédation vitale", () => {
  it("transfère les HP de la victime vers l'agresseur (avec perte)", () => {
    const world = new World();
    const attacker = makeDevot({ pos: { x: 0, y: 0, z: 0 } });
    const victim = makeDevot({ pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(attacker.id, attacker);
    world.devots.set(victim.id, victim);

    applyDecision(attacker, { action: "attack", targetId: victim.id }, world);
    const result = tick(world);

    expect(result.combats).toHaveLength(1);
    // Victime : -drain -métabolisme ; agresseur : +drain×efficacité -métabolisme.
    expect(victim.hp).toBeCloseTo(20_000 - ATTACK_DRAIN_PER_TICK - 1, 5);
    expect(attacker.hp).toBeCloseTo(
      20_000 + ATTACK_DRAIN_PER_TICK * ATTACK_EFFICIENCY - 1,
      5,
    );
  });

  it("alerte la victime une seule fois (déclencheur threat)", () => {
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

  it("l'agresseur poursuit une cible hors de portée", () => {
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

  it("une victime tuée au combat meurt 'dévorée'", () => {
    const world = new World();
    const attacker = makeDevot();
    const victim = makeDevot({ pos: { x: 0.5, y: 0, z: 0 }, hp: 100 });
    world.devots.set(attacker.id, attacker);
    world.devots.set(victim.id, victim);
    applyDecision(attacker, { action: "attack", targetId: victim.id }, world);

    const result = tick(world);
    expect(result.deaths).toHaveLength(1);
    expect(result.deaths[0]!.cause).toContain("dévoré");
  });

  it("on ne peut pas s'attaquer soi-même", () => {
    const world = new World();
    const devot = makeDevot();
    world.devots.set(devot.id, devot);
    applyDecision(devot, { action: "attack", targetId: devot.id }, world);
    expect(devot.currentGoal.kind).not.toBe("attack");
  });
});

describe("reproduction", () => {
  it("bourgeonnement : coût au parent, vie transmise à l'enfant, traits mutés", () => {
    const world = new World();
    const parent = makeDevot({ hp: 20_000, traits: ["curieux", "pieux"] });
    world.devots.set(parent.id, parent);

    const outcome = resolveReproduction(world, parent, undefined, () => 0.99);
    expect("child" in outcome).toBe(true);
    if (!("child" in outcome)) return;

    const cost = 20_000 * REPRO_SOLO_COST_FRACTION;
    expect(parent.hp).toBeCloseTo(20_000 - cost, 5);
    expect(outcome.child.hp).toBeCloseTo(cost * REPRO_TRANSFER_EFFICIENCY, 5);
    expect(outcome.mode).toBe("bourgeonnement");
    expect(outcome.child.isFounder).toBe(false);
    expect(outcome.child.godId).toBe(parent.godId);
  });

  it("sexuée : les deux parents paient, l'enfant cumule", () => {
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
    expect(outcome.mode).toBe("sexuee");
    // Suzeraineté : l'enfant naît sous le dieu de l'initiateur.
    expect(outcome.child.godId).toBe("g1");
  });

  it("refuse si le parent est trop faible", () => {
    const world = new World();
    const parent = makeDevot({ hp: REPRO_MIN_HP - 1 });
    world.devots.set(parent.id, parent);
    const outcome = resolveReproduction(world, parent, undefined);
    expect(outcome).toEqual({ reason: "trop faible pour procréer" });
  });

  it("refuse si le partenaire est trop éloigné", () => {
    const world = new World();
    const a = makeDevot();
    const b = makeDevot({ pos: { x: 20, y: 0, z: 0 } });
    world.devots.set(a.id, a);
    world.devots.set(b.id, b);
    const outcome = resolveReproduction(world, a, b.id);
    expect(outcome).toEqual({ reason: "partenaire trop éloigné" });
  });

  it("une décision reproduce pose une intention consommable", () => {
    const world = new World();
    const devot = makeDevot();
    world.devots.set(devot.id, devot);
    applyDecision(devot, { action: "reproduce", targetId: "autre" }, world);
    expect(devot.pendingReproduction).toEqual({ partnerId: "autre" });
  });
});

describe("perception — l'allure pèse socialement", () => {
  it("une rencontre décrit ce que l'autre PORTE, pas seulement son identifiant", () => {
    // C'est tout l'enjeu de T2 : l'apparence choisie à la création doit arriver
    // dans le prompt du voisin. Sans cela elle reste décorative.
    const world = new World();
    const royal = makeDevot({
      name: "Roi",
      pos: { x: 0, y: 0, z: 0 },
      identityJson: encodeIdentity({
        appearance: {
          hat: "couronne",
          shirt: "#e0b34c",
          pants: "#5a3a4a",
          cape: "longue",
          face: "aucun",
          skin: "#f0c9a4",
          build: "massif",
        },
        stats: { vitality: 5, power: 4, speed: 2, sight: 1 },
        soul: "",
        signature: "DVT-000-0000",
      }),
    });
    const gueux = makeDevot({ name: "Gueux", godId: "g2", pos: { x: 1, y: 0, z: 0 } });
    world.devots.set(royal.id, royal);
    world.devots.set(gueux.id, gueux);

    const triggers = perceptionSystem(world);
    const seen = triggers.find((t) => t.devotId === gueux.id);
    expect(seen, "le gueux doit apercevoir le roi").toBeDefined();
    expect(seen!.eventText).toContain("couronne");
    expect(seen!.eventText).toContain("safran"); // la couleur nommée, pas le code hexadécimal
    expect(seen!.eventText).toContain("cape longue");
    expect(seen!.eventText).toContain("massif");
    // Et jamais de code couleur brut : « #e0b34c » ne dit rien à un modèle.
    expect(seen!.eventText).not.toContain("#");
  });

  it("un devot sans identité reste décrit, sans faire échouer la perception", () => {
    // Un devot d'avant cette version, ou né en mode god, n'a pas d'identité.
    const world = new World();
    const a = makeDevot({ pos: { x: 0, y: 0, z: 0 }, identityJson: "" });
    const b = makeDevot({ godId: "g2", pos: { x: 1, y: 0, z: 0 }, identityJson: "" });
    world.devots.set(a.id, a);
    world.devots.set(b.id, b);
    const triggers = perceptionSystem(world);
    expect(triggers.length).toBeGreaterThan(0);
    expect(triggers[0]!.eventText).toContain("allure ordinaire");
  });
});
