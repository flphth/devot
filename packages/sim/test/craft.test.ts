import { describe, expect, it } from "vitest";
import {
  CRAFT_HP_FLOOR,
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
 * T5 : forger coûte de la VIE, donc du temps de pensée. Ces tests vérifient les
 * deux choses qui comptent — que le prix est réellement prélevé, et qu'on ne
 * peut pas forger jusqu'au suicide.
 */

let seq = 0;
function makeDevot(overrides: Partial<DevotEntity> = {}): DevotEntity {
  return {
    id: `d${++seq}`,
    godId: "g1",
    isFounder: false,
    name: `Devot${seq}`,
    pos: { x: 0, y: 0, z: 0 },
    hp: 40_000,
    hpMax: 50_000,
    state: "vivant",
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

describe("forger — la pensée devient matière", () => {
  it("prélève exactement le coût de la recette", () => {
    const world = new World();
    const devot = makeDevot({ hp: 40_000 });
    applyDecision(devot, { action: "craft", item: "lance" }, world);

    expect(devot.items).toEqual(["lance"]);
    expect(devot.hp).toBe(40_000 - RECIPES.lance.cost);
  });

  it("l'objet renforce vraiment la stat annoncée", () => {
    const world = new World();
    const nu = makeDevot();
    const arme = makeDevot();
    applyDecision(arme, { action: "craft", item: "lance" }, world);

    expect(drainOf(arme)).toBeGreaterThan(drainOf(nu));
    expect(statsOf(arme).power).toBe(statsOf(nu).power + RECIPES.lance.bonus);
  });

  it("chaque recette agit sur sa propre stat", () => {
    const world = new World();
    const rapide = makeDevot();
    const percant = makeDevot();
    applyDecision(rapide, { action: "craft", item: "bottes" }, world);
    applyDecision(percant, { action: "craft", item: "lunette" }, world);

    expect(speedOf(rapide)).toBeGreaterThan(speedOf(makeDevot()));
    expect(sightOf(percant)).toBeGreaterThan(sightOf(makeDevot()));
  });
});

describe("forger a des limites, et le serveur les tient", () => {
  it("on ne forge pas si l'on n'y survivrait pas", () => {
    // Le cas important : un modèle qui ne comprend pas encore l'économie du
    // monde forgerait jusqu'à l'épuisement. C'est un suicide déguisé.
    const pauvre = makeDevot({ hp: CRAFT_HP_FLOOR + RECIPES.bouclier.cost - 1 });
    const refus = canCraft("bouclier", pauvre.hp, pauvre.items);
    expect(refus).not.toBeNull();
    expect(refus!.reason).toContain("vivre");

    const world = new World();
    const avant = pauvre.hp;
    applyDecision(pauvre, { action: "craft", item: "bouclier" }, world);
    expect(pauvre.items, "rien n'a été forgé").toEqual([]);
    expect(pauvre.hp, "et rien n'a été prélevé").toBe(avant);
  });

  it("on ne porte pas plus de deux objets", () => {
    const world = new World();
    const devot = makeDevot({ hp: 200_000 });
    applyDecision(devot, { action: "craft", item: "lance" }, world);
    applyDecision(devot, { action: "craft", item: "bouclier" }, world);
    const apresDeux = devot.hp;
    applyDecision(devot, { action: "craft", item: "bottes" }, world);

    expect(devot.items).toHaveLength(MAX_CARRIED);
    expect(devot.hp, "le troisième n'a rien coûté puisqu'il est refusé").toBe(apresDeux);
  });

  it("on ne forge pas deux fois le même objet", () => {
    const world = new World();
    const devot = makeDevot({ hp: 200_000 });
    applyDecision(devot, { action: "craft", item: "lance" }, world);
    const apres = devot.hp;
    applyDecision(devot, { action: "craft", item: "lance" }, world);
    expect(devot.items).toEqual(["lance"]);
    expect(devot.hp).toBe(apres);
  });

  it("un objet inventé est refusé", () => {
    const world = new World();
    const devot = makeDevot();
    const avant = devot.hp;
    applyDecision(devot, { action: "craft", item: "épée laser" as never }, world);
    expect(devot.items).toEqual([]);
    expect(devot.hp).toBe(avant);
    expect(canCraft("épée laser", 40_000, [])).not.toBeNull();
  });
});

describe("le marché est réel", () => {
  it("porter deux objets ampute une part sensible d'une vie", () => {
    // C'est le sens du jalon : la puissance se paie en durée. On l'énonce en
    // test pour que personne ne rende plus tard la forge indolore sans le voir.
    const total = RECIPES.lance.cost + RECIPES.bouclier.cost;
    expect(total).toBeGreaterThan(50_000 * 0.15);
  });

  it("les stats avec objets ne modifient jamais le corps d'origine", () => {
    const base = defaultIdentity().stats;
    const avec = statsWithItems(base, ["lance", "bottes"]);
    expect(avec.power).toBe(base.power + 1);
    expect(avec.speed).toBe(base.speed + 1);
    expect(base.power, "le corps d'origine reste intact").toBe(3);
  });
});
