import type { DevotEntity } from "@devot/shared";
import {
  HP_MAX_DEFAULT,
  REPRO_MIN_HP,
  REPRO_PAIR_COST_FRACTION,
  REPRO_RADIUS,
  REPRO_SOLO_COST_FRACTION,
  REPRO_TRANSFER_EFFICIENCY,
  TRAIT_POOL,
  decodeIdentity,
  defaultIdentity,
  encodeIdentity,
  inheritIdentity,
  statMultiplier,
} from "@devot/shared";
import { dist2, World } from "./world.js";

export interface Birth {
  child: DevotEntity;
  parents: DevotEntity[];
  mode: "bourgeonnement" | "sexuee";
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
    // Sexual reproduction — including across the lines of different gods.
    if (partner.state === "dead") return { reason: "partenaire mort" };
    if (partner.hp < REPRO_MIN_HP) return { reason: "partenaire trop faible" };
    if (dist2(parent.pos, partner.pos) > REPRO_RADIUS * REPRO_RADIUS) {
      return { reason: "partner too far away" };
    }
    const costA = parent.hp * REPRO_PAIR_COST_FRACTION;
    const costB = partner.hp * REPRO_PAIR_COST_FRACTION;
    parent.hp -= costA;
    partner.hp -= costB;
    const childHp = (costA + costB) * REPRO_TRANSFER_EFFICIENCY;
    const child = makeChild(parent, partner, childHp, rng);
    return { child, parents: [parent, partner], mode: "sexuee" };
  }

  // Budding: a mutated clone.
  const cost = parent.hp * REPRO_SOLO_COST_FRACTION;
  parent.hp -= cost;
  const child = makeChild(parent, undefined, cost * REPRO_TRANSFER_EFFICIENCY, rng);
  return { child, parents: [parent], mode: "bourgeonnement" };
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
  // The child inherits the look AND the stats of its parents: a family is
  // recognisable on screen, and a line ends up with a physical temperament.
  const identity = inheritIdentity(
    decodeIdentity(a.identityJson) ?? defaultIdentity(a.traits),
    b ? (decodeIdentity(b.identityJson) ?? defaultIdentity(b.traits)) : undefined,
    traits,
    rng,
  );

  // Overlordship (an open design question): the child is born under the god of
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
    // Its max HP follow from the inherited vitality, not from the best-endowed
    // parent's: a frail child of sturdy parents stays frail.
    hpMax: Math.round(HP_MAX_DEFAULT * statMultiplier(identity.stats.vitality)),
    state: "alive",
    profile: a.profile,
    traits,
    // One deeper than the parent who started it — the line's depth is the
    // thing being scored, so it has to be carried, not recomputed.
    generation: a.generation + 1,
    // Its own address, assigned by the server: a line is many wallets.
    wallet: "",
    identityJson: encodeIdentity(identity),
    // A child is born empty-handed: an item is forged at the price of ITS OWN
    // life, it is not handed down (T6 will deal with what drops on death).
    items: [],
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
  const root = (b && rng() < 0.5 ? b : a).name.replace(/-(fils|fille) .*$/, "");
  return `${root}-${rng() < 0.5 ? "fils" : "fille"} ${Math.floor(rng() * 900 + 100)}`;
}
