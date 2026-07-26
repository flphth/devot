import type { DevotEntity, MonsterEntity, ThoughtSubject } from "./types.js";

/**
 * Adapters from simulation entities to the read-only view a mind is given.
 *
 * Devots and monsters share almost nothing in the simulation — one has a god,
 * a lineage and reproduction, the other has hunger and claws. They meet here,
 * at the one place where both are simply "something that thinks".
 */

export function devotSubject(devot: DevotEntity): ThoughtSubject {
  return {
    id: devot.id,
    kind: "devot",
    name: devot.name,
    pos: devot.pos,
    hp: devot.hp,
    hpMax: devot.hpMax,
    state: devot.state,
    age: devot.age,
    traits: devot.traits,
    isFounder: devot.isFounder,
  };
}

export function monsterSubject(monster: MonsterEntity): ThoughtSubject {
  return {
    id: monster.id,
    kind: "monster",
    name: monster.name,
    pos: monster.pos,
    hp: monster.hp,
    hpMax: monster.hpMax,
    state: monster.state,
    age: monster.age,
    traits: [],
    isFounder: false,
  };
}
