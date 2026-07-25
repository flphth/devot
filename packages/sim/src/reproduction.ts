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
 * Concrétise une décision de reproduction (mécanique pure, 0 token).
 * L'héritage de contexte (chroniqueur) est fait ensuite par l'appelant.
 * `rng` injectable pour des tests déterministes.
 */
export function resolveReproduction(
  world: World,
  parent: DevotEntity,
  partnerId: string | undefined,
  rng: () => number = Math.random,
): Birth | ReproFailure {
  if (parent.state === "mort") return { reason: "mort" };
  if (parent.hp < REPRO_MIN_HP) {
    return { reason: "trop faible pour procréer" };
  }

  const partner = partnerId ? world.devots.get(partnerId) : undefined;

  if (partner && partner.id !== parent.id) {
    // Reproduction sexuée — y compris entre lignées de dieux différents.
    if (partner.state === "mort") return { reason: "partenaire mort" };
    if (partner.hp < REPRO_MIN_HP) return { reason: "partenaire trop faible" };
    if (dist2(parent.pos, partner.pos) > REPRO_RADIUS * REPRO_RADIUS) {
      return { reason: "partenaire trop éloigné" };
    }
    const costA = parent.hp * REPRO_PAIR_COST_FRACTION;
    const costB = partner.hp * REPRO_PAIR_COST_FRACTION;
    parent.hp -= costA;
    partner.hp -= costB;
    const childHp = (costA + costB) * REPRO_TRANSFER_EFFICIENCY;
    const child = makeChild(parent, partner, childHp, rng);
    return { child, parents: [parent, partner], mode: "sexuee" };
  }

  // Bourgeonnement : clone muté.
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
  // L'enfant hérite de l'allure ET des stats de ses parents : on reconnaît une
  // famille à l'écran, et une lignée finit par avoir un tempérament physique.
  const identity = inheritIdentity(
    decodeIdentity(a.identityJson) ?? defaultIdentity(a.traits),
    b ? (decodeIdentity(b.identityJson) ?? defaultIdentity(b.traits)) : undefined,
    traits,
    rng,
  );

  // Suzeraineté (question ouverte du design) : l'enfant naît sous le dieu
  // du parent initiateur — son allégeance réelle reste un ressort narratif.
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
    // Ses PV maximaux découlent de la vigueur héritée, pas de celle du parent
    // le mieux doté : un enfant frêle de parents robustes reste frêle.
    hpMax: Math.round(HP_MAX_DEFAULT * statMultiplier(identity.stats.vitality)),
    state: "vivant",
    profile: a.profile,
    traits,
    identityJson: encodeIdentity(identity),
    // Un enfant naît les mains nues : un objet se forge au prix de SA vie,
    // il ne se transmet pas (T6 traitera de ce qui tombe à la mort).
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
