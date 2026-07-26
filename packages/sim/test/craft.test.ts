import { describe, expect, it } from "vitest";
import {
  CRAFT_BALANCE_FLOOR,
  CAPACITY_DEFAULT,
  MAX_CARRIED,
  RECIPES,
  canCraft,
  defaultIdentity,
  encodeIdentity,
  statsWithItems,
  type DevotEntity,
} from "@devot/shared";
import { applyDecision, drainOf, sightOf, speedOf, statsOf, World } from "../src/index.js";

/**
 * T5: forging costs LIFE, and therefore thinking time. These tests cover the two
 * things that matter — that the price is really taken, and that one cannot forge
 * oneself to death.
 */

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
    balance: 40_000,
    // Born at its capacity, like a founder, unless a test says otherwise.
    bornWith: overrides.bornWith ?? 50_000,
    capacity: 50_000,
    state: "alive",
    profile: "frugal",
    traits: [],
    identityJson: encodeIdentity(defaultIdentity()),
    items: [],
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "wander" },
    ...overrides,
  };
}

describe("forging — thought becomes matter", () => {
  it("takes exactly the recipe cost", () => {
    const world = new World();
    const devot = makeDevot({ balance: 40_000 });
    applyDecision(devot, { action: "craft", item: "spear" }, world);

    expect(devot.items).toEqual(["spear"]);
    expect(devot.balance).toBe(40_000 - RECIPES.spear.cost);
  });

  it("the item really strengthens the advertised stat", () => {
    const world = new World();
    const nu = makeDevot();
    const arme = makeDevot();
    applyDecision(arme, { action: "craft", item: "spear" }, world);

    expect(drainOf(arme)).toBeGreaterThan(drainOf(nu));
    expect(statsOf(arme).power).toBe(statsOf(nu).power + RECIPES.spear.bonus);
  });

  it("each recipe acts on its own stat", () => {
    const world = new World();
    const rapide = makeDevot();
    const percant = makeDevot();
    applyDecision(rapide, { action: "craft", item: "boots" }, world);
    applyDecision(percant, { action: "craft", item: "scope" }, world);

    expect(speedOf(rapide)).toBeGreaterThan(speedOf(makeDevot()));
    expect(sightOf(percant)).toBeGreaterThan(sightOf(makeDevot()));
  });
});

describe("forging has limits, and the server holds them", () => {
  it("you cannot forge if you would not survive it", () => {
    // The case that matters: a model that does not yet grasp this world's
    // economy would forge itself to exhaustion. That is suicide in disguise.
    const pauvre = makeDevot({ balance: CRAFT_BALANCE_FLOOR + RECIPES.shield.cost - 1 });
    const refus = canCraft("shield", pauvre.balance, pauvre.items);
    expect(refus).not.toBeNull();
    expect(refus!.reason).toContain("live on");

    const world = new World();
    const avant = pauvre.balance;
    applyDecision(pauvre, { action: "craft", item: "shield" }, world);
    expect(pauvre.items, "nothing was forged").toEqual([]);
    expect(pauvre.balance, "and nothing was taken").toBe(avant);
  });

  it("you carry no more than two items", () => {
    const world = new World();
    const devot = makeDevot({ balance: 200_000 });
    applyDecision(devot, { action: "craft", item: "spear" }, world);
    applyDecision(devot, { action: "craft", item: "shield" }, world);
    const apresDeux = devot.balance;
    applyDecision(devot, { action: "craft", item: "boots" }, world);

    expect(devot.items).toHaveLength(MAX_CARRIED);
    expect(devot.balance, "the third cost nothing since it was refused").toBe(apresDeux);
  });

  it("you cannot forge the same item twice", () => {
    const world = new World();
    const devot = makeDevot({ balance: 200_000 });
    applyDecision(devot, { action: "craft", item: "spear" }, world);
    const apres = devot.balance;
    applyDecision(devot, { action: "craft", item: "spear" }, world);
    expect(devot.items).toEqual(["spear"]);
    expect(devot.balance).toBe(apres);
  });

  it("a made-up item is refused", () => {
    const world = new World();
    const devot = makeDevot();
    const avant = devot.balance;
    applyDecision(devot, { action: "craft", item: "lightsaber" as never }, world);
    expect(devot.items).toEqual([]);
    expect(devot.balance).toBe(avant);
    expect(canCraft("lightsaber", 40_000, [])).not.toBeNull();
  });
});

describe("the bargain is real", () => {
  it("carrying two items costs a real, but modest, share of a life", () => {
    // This test states the TRUTH OF THE MOMENT, and that is the point: it reads
    // against CAPACITY_DEFAULT, so it changes meaning the moment the pool changes.
    //
    // The costs were calibrated on 50,000 balance (two items = 20% of a life). The
    // pool was tripled to 150,000: the same pair now weighs only 6.7%. Power is
    // still paid for in lifespan, but far more cheaply.
    const total = RECIPES.spear.cost + RECIPES.shield.cost;
    const part = total / CAPACITY_DEFAULT;
    expect(part).toBeGreaterThan(0.05);
    expect(part, `two items cost ${(part * 100).toFixed(1)}% of a life`).toBeLessThan(0.1);
  });

  it("stats with items never mutate the underlying body", () => {
    const base = defaultIdentity().stats;
    const avec = statsWithItems(base, ["spear", "boots"]);
    expect(avec.power).toBe(base.power + 1);
    expect(avec.speed).toBe(base.speed + 1);
    expect(base.power, "the original body stays intact").toBe(3);
  });
});
