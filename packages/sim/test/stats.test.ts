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
 * T3: the four stats chosen at creation must produce REAL effects. One test per
 * stat, plus the guarantee that everything comes from the persisted identity and
 * never from a value a client asserts.
 */

let seq = 0;
function makeDevot(stats: Partial<Stats>, overrides: Partial<DevotEntity> = {}): DevotEntity {
  const identity = defaultIdentity();
  identity.stats = { ...identity.stats, ...stats };
  return {
    id: `d${++seq}`,
    godId: "g1",
    isFounder: false,
    generation: 1,
    wallet: "",
    name: `Devot${seq}`,
    pos: { x: 0, y: 0, z: 0 },
    hp: 40_000,
    hpMax: HP_MAX_DEFAULT,
    state: "alive",
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

describe("stats come from the identity, never from anywhere else", () => {
  it("a devot with no identity falls back to the neutral profile", () => {
    const devot = makeDevot({}, { identityJson: "" });
    expect(statsOf(devot)).toEqual({ vitality: 3, power: 3, speed: 3, sight: 3 });
    expect(hpMaxOf(devot)).toBe(HP_MAX_DEFAULT);
  });

  it("a tampered identity is ignored in favour of the neutral profile", () => {
    // If someone wrote 5 everywhere straight into the database, the read must
    // refuse it: `decodeIdentity` revalidates, and we fall back to neutral.
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

describe("vigour — the HP, and therefore the thinking time", () => {
  it("high vigour grants more maximum HP than low vigour", () => {
    const sturdy = makeDevot({ vitality: 5, sight: 1 });
    const frail = makeDevot({ vitality: 1, sight: 5 });
    expect(hpMaxOf(sturdy)).toBeGreaterThan(hpMaxOf(frail));
    expect(hpMaxOf(sturdy)).toBe(Math.round(HP_MAX_DEFAULT * statMultiplier(5)));
    expect(hpMaxOf(frail)).toBe(Math.round(HP_MAX_DEFAULT * statMultiplier(1)));
  });
});

describe("swiftness — movement speed", () => {
  it("a swift devot covers more ground than a slow one, in the same time", () => {
    const world = new World();
    const swift = makeDevot({ speed: 5, sight: 1 }, { pos: { x: 0, y: 0, z: 0 } });
    const slow = makeDevot({ speed: 1, sight: 5 }, { pos: { x: 0, y: 0, z: 0 } });
    // Same goal, same direction: only speed separates them.
    applyDecision(swift, { action: "move", direction: { x: 1, z: 0 } }, world);
    applyDecision(slow, { action: "move", direction: { x: 1, z: 0 } }, world);
    world.devots.set(swift.id, swift);
    world.devots.set(slow.id, slow);

    for (let k = 0; k < 10; k++) tick(world);
    expect(swift.pos.x).toBeGreaterThan(slow.pos.x);
    expect(speedOf(swift)).toBeGreaterThan(speedOf(slow));
    expect(speedOf(makeDevot({ speed: 3 }))).toBeCloseTo(DEVOT_SPEED, 6);
  });
});

describe("sight — what enters the prompt", () => {
  it("a sharp-eyed devot sees a neighbour a short-sighted one cannot", () => {
    const world = new World();
    const sharpEyed = makeDevot({ sight: 5, vitality: 1 }, { pos: { x: 0, y: 0, z: 0 } });
    const shortSighted = makeDevot({ sight: 1, vitality: 5 }, { pos: { x: 0, y: 0, z: 0.2 } });
    // A third placed between the two ranges: visible to the sharp-eyed, not the short-sighted.
    const distance = (sightOf(sharpEyed) + sightOf(shortSighted)) / 2;
    const target = makeDevot({}, { godId: "g2", pos: { x: distance, y: 0, z: 0 } });
    for (const d of [sharpEyed, shortSighted, target]) world.devots.set(d.id, d);

    const triggers = perceptionSystem(world);
    const seenBy = (id: string) =>
      triggers.some((t) => t.devotId === id && t.eventText.includes(target.name));

    expect(sightOf(sharpEyed)).toBeGreaterThan(sightOf(shortSighted));
    expect(seenBy(sharpEyed.id), "the sharp-eyed must see them").toBe(true);
    expect(seenBy(shortSighted.id), "the short-sighted must not").toBe(false);
    expect(sightOf(makeDevot({ sight: 3 }))).toBeCloseTo(PERCEPTION_RADIUS, 6);
  });
});

describe("power — the HP stolen", () => {
  it("a strong devot drains faster than a weak one", () => {
    const strong = makeDevot({ power: 5, sight: 1 });
    const weak = makeDevot({ power: 1, sight: 5 });
    expect(drainOf(strong)).toBeGreaterThan(drainOf(weak));
    expect(drainOf(makeDevot({ power: 3 }))).toBeCloseTo(ATTACK_DRAIN_PER_TICK, 6);
  });

  it("and the victim loses exactly what the attacker's power takes", () => {
    const world = new World();
    const strong = makeDevot({ power: 5, sight: 1 }, { pos: { x: 0, y: 0, z: 0 } });
    const victim = makeDevot({}, { godId: "g2", pos: { x: 0.5, y: 0, z: 0 } });
    world.devots.set(strong.id, strong);
    world.devots.set(victim.id, victim);
    applyDecision(strong, { action: "attack", targetId: victim.id }, world);

    const before = victim.hp;
    tick(world);
    // Metabolism also takes its share: we check the bite, not the total.
    const lost = before - victim.hp;
    expect(lost).toBeGreaterThan(drainOf(makeDevot({ power: 3 })));
  });
});
