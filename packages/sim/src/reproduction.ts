import type { DevotEntity } from "@devot/shared";
import {
  REPRO_MIN_HP,
  REPRO_PAIR_COST_FRACTION,
  REPRO_RADIUS,
  REPRO_SOLO_COST_FRACTION,
  REPRO_TRANSFER_EFFICIENCY,
  TRAIT_POOL,
} from "@devot/shared";
import { dist2, World } from "./world.js";

export interface Birth {
  child: DevotEntity;
  parents: DevotEntity[];
  mode: "budding" | "sexual";
}

export interface ReproFailure {
  reason: string;
}

let childSeq = 0;

/**
 * Carries out a reproduction decision (pure mechanics, 0 tokens).
 * Context inheritance (the chronicler) is done afterwards by the caller.
 * `rng` is injectable for deterministic tests.
 */
export function resolveReproduction(
  world: World,
  parent: DevotEntity,
  partnerId: string | undefined,
  rng: () => number = Math.random,
): Birth | ReproFailure {
  if (parent.state === "dead") return { reason: "dead" };
  if (parent.hp < REPRO_MIN_HP) {
    return { reason: "too weak to procreate" };
  }

  const partner = partnerId ? world.devots.get(partnerId) : undefined;

  if (partner && partner.id !== parent.id) {
    // Sexual reproduction — including across the lineages of different gods.
    if (partner.state === "dead") return { reason: "partner is dead" };
    if (partner.hp < REPRO_MIN_HP) return { reason: "partner too weak" };
    if (dist2(parent.pos, partner.pos) > REPRO_RADIUS * REPRO_RADIUS) {
      return { reason: "partner too far away" };
    }
    const costA = parent.hp * REPRO_PAIR_COST_FRACTION;
    const costB = partner.hp * REPRO_PAIR_COST_FRACTION;
    parent.hp -= costA;
    partner.hp -= costB;
    const childHp = (costA + costB) * REPRO_TRANSFER_EFFICIENCY;
    const child = makeChild(parent, partner, childHp, rng);
    return { child, parents: [parent, partner], mode: "sexual" };
  }

  // Budding: a mutated clone.
  const cost = parent.hp * REPRO_SOLO_COST_FRACTION;
  parent.hp -= cost;
  const child = makeChild(parent, undefined, cost * REPRO_TRANSFER_EFFICIENCY, rng);
  return { child, parents: [parent], mode: "budding" };
}

function makeChild(
  a: DevotEntity,
  b: DevotEntity | undefined,
  hp: number,
  rng: () => number,
): DevotEntity {
  const traits = mutateTraits(
    b ? mixTraits(a.traits, b.traits, rng) : [...a.traits],
    rng,
  );
  // Suzerainty (an open design question): the child is born under the god of
  // the initiating parent — its real allegiance stays a narrative device.
  return {
    id: `devot-child-${Date.now()}-${childSeq++}`,
    godId: a.godId,
    isFounder: false,
    name: childName(a, b, rng),
    pos: {
      x: a.pos.x + (rng() - 0.5) * 2,
      y: 0,
      z: a.pos.z + (rng() - 0.5) * 2,
    },
    hp,
    hpMax: Math.max(a.hpMax, b?.hpMax ?? 0),
    state: "alive",
    profile: a.profile,
    traits,
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "wander" },
  };
}

function mixTraits(a: string[], b: string[], rng: () => number): string[] {
  const all = [...new Set([...a, ...b])];
  return all.filter(() => rng() < 0.6);
}

function mutateTraits(traits: string[], rng: () => number): string[] {
  const out = [...traits];
  if (rng() < 0.5) {
    const candidate = TRAIT_POOL[Math.floor(rng() * TRAIT_POOL.length)]!;
    if (!out.includes(candidate)) out.push(candidate);
  }
  if (out.length > 2 && rng() < 0.3) {
    out.splice(Math.floor(rng() * out.length), 1);
  }
  return out;
}

function childName(a: DevotEntity, b: DevotEntity | undefined, rng: () => number): string {
  const root = (b && rng() < 0.5 ? b : a).name.replace(/-(son|daughter) .*$/, "");
  return `${root}-${rng() < 0.5 ? "son" : "daughter"} ${Math.floor(rng() * 900 + 100)}`;
}
