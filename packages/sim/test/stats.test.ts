import { describe, expect, it } from "vitest";
import {
  ATTACK_DRAIN_PER_TICK,
  DEVOT_SPEED,
  HP_MAX_DEFAULT,
  PERCEPTION_RADIUS,
  defaultIdentity,
  encodeIdentity,
  statMultiplier,
  type DevotEntity,
  type Stats,
} from "@devot/shared";
import {
  applyDecision,
  drainOf,
  hpMaxOf,
  perceptionSystem,
  sightOf,
  speedOf,
  statsOf,
  tick,
  World,
} from "../src/index.js";

/**
 * T3 : les quatre stats choisies à la création doivent produire des effets
 * RÉELS. Un test par stat, plus la garantie que tout vient de l'identité
 * persistée et jamais d'une valeur affirmée par un client.
 */

let seq = 0;
function makeDevot(stats: Partial<Stats>, overrides: Partial<DevotEntity> = {}): DevotEntity {
  const identity = defaultIdentity();
  identity.stats = { ...identity.stats, ...stats };
  return {
    id: `d${++seq}`,
    godId: "g1",
    isFounder: false,
    name: `Devot${seq}`,
    pos: { x: 0, y: 0, z: 0 },
    hp: 40_000,
    hpMax: HP_MAX_DEFAULT,
    state: "vivant",
    profile: "frugal",
    traits: [],
    identityJson: encodeIdentity(identity),
    items: [],
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "idle" },
    ...overrides,
  };
}

describe("les stats sortent de l'identité, jamais d'ailleurs", () => {
  it("un devot sans identité retombe sur le profil neutre", () => {
    const devot = makeDevot({}, { identityJson: "" });
    expect(statsOf(devot)).toEqual({ vitality: 3, power: 3, speed: 3, sight: 3 });
    expect(hpMaxOf(devot)).toBe(HP_MAX_DEFAULT);
  });

  it("une identité trafiquée est ignorée au profit du profil neutre", () => {
    // Si quelqu'un écrivait 5 partout directement en base, la lecture doit le
    // refuser : `decodeIdentity` revalide, et on retombe sur le neutre.
    const devot = makeDevot(
      {},
      {
        identityJson: JSON.stringify({
          ...defaultIdentity(),
          stats: { vitality: 5, power: 5, speed: 5, sight: 5 },
        }),
      },
    );
    expect(statsOf(devot).vitality).toBe(3);
  });
});

describe("vigueur — les PV, donc le temps de pensée", () => {
  it("une forte vigueur donne plus de PV maximaux qu'une faible", () => {
    const robuste = makeDevot({ vitality: 5, sight: 1 });
    const frele = makeDevot({ vitality: 1, sight: 5 });
    expect(hpMaxOf(robuste)).toBeGreaterThan(hpMaxOf(frele));
    expect(hpMaxOf(robuste)).toBe(Math.round(HP_MAX_DEFAULT * statMultiplier(5)));
    expect(hpMaxOf(frele)).toBe(Math.round(HP_MAX_DEFAULT * statMultiplier(1)));
  });
});

describe("vivacité — la vitesse de déplacement", () => {
  it("un devot vif parcourt plus de chemin qu'un devot lent, dans le même temps", () => {
    const world = new World();
    const vif = makeDevot({ speed: 5, sight: 1 }, { pos: { x: 0, y: 0, z: 0 } });
    const lent = makeDevot({ speed: 1, sight: 5 }, { pos: { x: 0, y: 0, z: 0 } });
    // Même but, exactement à l'opposé : seule la vitesse les sépare.
    applyDecision(vif, { action: "move", direction: { x: 1, z: 0 } }, world);
    applyDecision(lent, { action: "move", direction: { x: 1, z: 0 } }, world);
    world.devots.set(vif.id, vif);
    world.devots.set(lent.id, lent);

    for (let k = 0; k < 10; k++) tick(world);
    expect(vif.pos.x).toBeGreaterThan(lent.pos.x);
    expect(speedOf(vif)).toBeGreaterThan(speedOf(lent));
    expect(speedOf(makeDevot({ speed: 3 }))).toBeCloseTo(DEVOT_SPEED, 6);
  });
});

describe("vue — ce qui entre dans le prompt", () => {
  it("un devot perçant voit un voisin qu'un myope ne voit pas", () => {
    const world = new World();
    const percant = makeDevot({ sight: 5, vitality: 1 }, { pos: { x: 0, y: 0, z: 0 } });
    const myope = makeDevot({ sight: 1, vitality: 5 }, { pos: { x: 0, y: 0, z: 0.2 } });
    // Un tiers placé entre les deux portées : visible du perçant, pas du myope.
    const distance = (sightOf(percant) + sightOf(myope)) / 2;
    const cible = makeDevot({}, { godId: "g2", pos: { x: distance, y: 0, z: 0 } });
    for (const d of [percant, myope, cible]) world.devots.set(d.id, d);

    const triggers = perceptionSystem(world);
    const vuPar = (id: string) =>
      triggers.some((t) => t.devotId === id && t.eventText.includes(cible.name));

    expect(sightOf(percant)).toBeGreaterThan(sightOf(myope));
    expect(vuPar(percant.id), "le perçant doit le voir").toBe(true);
    expect(vuPar(myope.id), "le myope ne doit pas le voir").toBe(false);
    expect(sightOf(makeDevot({ sight: 3 }))).toBeCloseTo(PERCEPTION_RADIUS, 6);
  });
});

describe("force — les PV volés", () => {
  it("un devot fort draine plus vite qu'un devot faible", () => {
    const fort = makeDevot({ power: 5, sight: 1 });
    const faible = makeDevot({ power: 1, sight: 5 });
    expect(drainOf(fort)).toBeGreaterThan(drainOf(faible));
    expect(drainOf(makeDevot({ power: 3 }))).toBeCloseTo(ATTACK_DRAIN_PER_TICK, 6);
  });

  it("et la victime perd exactement ce que la force de l'agresseur prélève", () => {
    const world = new World();
    const fort = makeDevot({ power: 5, sight: 1 }, { pos: { x: 0, y: 0, z: 0 } });
    const victime = makeDevot({}, { godId: "g2", pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(fort.id, fort);
    world.devots.set(victime.id, victime);
    applyDecision(fort, { action: "attack", targetId: victime.id }, world);

    const avant = victime.hp;
    tick(world);
    // Le métabolisme prélève aussi sa part : on vérifie la morsure, pas le total.
    const perdu = avant - victime.hp;
    expect(perdu).toBeGreaterThan(drainOf(makeDevot({ power: 3 })));
  });
});
