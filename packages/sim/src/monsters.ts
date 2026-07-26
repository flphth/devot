import type { Decision, DevotEntity, FoodEntity, MonsterEntity, Trigger } from "@devot/shared";
import {
  ATTACK_RADIUS,
  CARRION_HP_FRACTION,
  EAT_RADIUS,
  MONSTER_ATTACK_DRAIN_PER_TICK,
  MONSTER_ATTACK_EFFICIENCY,
  MONSTER_HP_MAX,
  MONSTER_HP_START,
  MONSTER_METABOLISM_HP_PER_TICK,
  MONSTER_PERCEPTION_RADIUS,
  MONSTER_SPEED,
  MONSTER_THINK_INTERVAL_MS,
  hasLineOfSight,
  resolveRockCollisions,
  slopeSpeedFactor,
  terrainGrade,
  terrainHeight,
} from "@devot/shared";
import { clampToWorld, dist2, World } from "./world.js";

/**
 * Monsters: predators that hunt devots, feed on what they kill, and starve if
 * they stop. They think like devots do — same economy, same mortality — but on
 * a far slower clock, which is what keeps a pack of them affordable.
 */

const MONSTER_NAMES = [
  "Gnaw",
  "Hollow",
  "Rasp",
  "Maul",
  "Sallow",
  "Grist",
  "Thresh",
  "Vane",
];

let monsterSeq = 0;

export function spawnMonster(
  world: World,
  x: number,
  z: number,
  now: number = Date.now(),
): MonsterEntity {
  const monster: MonsterEntity = {
    id: `monster-${now}-${++monsterSeq}`,
    name: `${MONSTER_NAMES[monsterSeq % MONSTER_NAMES.length]}-${monsterSeq}`,
    pos: { x, y: terrainHeight(x, z), z },
    hp: MONSTER_HP_START,
    hpMax: MONSTER_HP_MAX,
    state: "alive",
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "prowl" },
    // Staggered, so a pack that spawns together does not think in lockstep.
    lastThoughtAt: now - Math.floor(Math.random() * 6000),
  };
  resolveRockCollisions(monster.pos);
  monster.pos.y = terrainHeight(monster.pos.x, monster.pos.z);
  world.monsters.set(monster.id, monster);
  return monster;
}

export interface MonsterTickResult {
  triggers: Trigger[];
  attacks: Array<{ monsterId: string; devotId: string; drained: number }>;
}

/** Carrion dropped by the fallen — a dead monster is a great deal of food. */
export interface MonsterReaping {
  deaths: Array<{ monsterId: string; cause: string }>;
  carrion: FoodEntity[];
}

export function monsterTick(
  world: World,
  dt: number,
  now: number = Date.now(),
): MonsterTickResult {
  const result: MonsterTickResult = { triggers: [], attacks: [] };

  for (const monster of world.aliveMonsters()) {
    monster.age += 1;
    // Hunger is not a threshold for a monster, it is a constant bleed.
    monster.hp -= MONSTER_METABOLISM_HP_PER_TICK;

    monsterMovement(monster, world, dt);
    monsterFeeding(monster, world);
    monsterCombat(monster, world, result, now);
  }

  return result;
}

/**
 * Collects the monsters whose life has run out, whatever emptied it.
 *
 * Deliberately separate from monsterTick and run AFTER the devots have acted:
 * a devot landing the killing blow should see the beast fall on that same tick,
 * and its carcass appear at once. Folded into the monster phase, every kill by
 * a devot was reported one tick late.
 */
export function reapMonsters(world: World, now: number = Date.now()): MonsterReaping {
  const deaths: Array<{ monsterId: string; cause: string }> = [];
  const carrion: FoodEntity[] = [];

  for (const monster of world.aliveMonsters()) {
    if (monster.hp > 0) continue;
    monster.hp = 0;
    monster.state = "dead";
    deaths.push({
      monsterId: monster.id,
      cause: monster.underAttackBy ? "killed" : "starvation",
    });

    // What dies feeds what lives: the carcass is the richest food in the world.
    carrion.push({
      id: `food-carrion-${monster.id}`,
      pos: { ...monster.pos },
      type: "carrion",
      hpValue: monster.hpMax * CARRION_HP_FRACTION,
      source: "spawn",
      spawnedAt: now,
      ttlMs: 90_000,
    });
  }

  return { deaths, carrion };
}

function advance(monster: MonsterEntity, ux: number, uz: number, step: number): void {
  const grade = terrainGrade(monster.pos.x, monster.pos.z, ux, uz);
  const s = step * slopeSpeedFactor(grade);
  monster.pos.x += ux * s;
  monster.pos.z += uz * s;
}

function stepToward(monster: MonsterEntity, tx: number, tz: number, step: number): void {
  const dx = tx - monster.pos.x;
  const dz = tz - monster.pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  advance(monster, dx / len, dz / len, Math.min(step, len));
}

function monsterMovement(monster: MonsterEntity, world: World, dt: number): void {
  const step = MONSTER_SPEED * dt;

  switch (monster.currentGoal.kind) {
    case "idle":
      break;
    case "prowl": {
      const angle = monster.id.length * 2.3 + monster.age * 0.03;
      advance(monster, Math.cos(angle), Math.sin(angle), step * 0.55);
      break;
    }
    case "move_to": {
      const t = monster.currentGoal.target;
      stepToward(monster, t.x, t.z, step);
      if (dist2(monster.pos, t) < 0.25) monster.currentGoal = { kind: "prowl" };
      break;
    }
    case "flee": {
      const dx = monster.pos.x - monster.currentGoal.from.x;
      const dz = monster.pos.z - monster.currentGoal.from.z;
      const len = Math.hypot(dx, dz) || 1;
      advance(monster, dx / len, dz / len, step * 1.3);
      break;
    }
    case "hunt": {
      const prey = world.devots.get(monster.currentGoal.targetId);
      if (!prey || prey.state === "dead") {
        monster.currentGoal = { kind: "prowl" };
        break;
      }
      if (dist2(monster.pos, prey.pos) > ATTACK_RADIUS * ATTACK_RADIUS) {
        stepToward(monster, prey.pos.x, prey.pos.z, step);
      }
      break;
    }
  }

  clampToWorld(monster.pos, world.size);
  resolveRockCollisions(monster.pos);
  monster.pos.y = terrainHeight(monster.pos.x, monster.pos.z);
}

/** Monsters do not graze. Only carrion feeds them off the ground. */
function monsterFeeding(monster: MonsterEntity, world: World): void {
  for (const food of world.food.values()) {
    if (food.type !== "carrion") continue;
    if (dist2(monster.pos, food.pos) > EAT_RADIUS * EAT_RADIUS) continue;
    monster.hp = Math.min(monster.hpMax, monster.hp + food.hpValue);
    world.food.delete(food.id);
    break;
  }
}

function monsterCombat(
  monster: MonsterEntity,
  world: World,
  result: MonsterTickResult,
  now: number,
): void {
  if (monster.currentGoal.kind !== "hunt") return;
  const prey = world.devots.get(monster.currentGoal.targetId);
  if (!prey || prey.state === "dead") {
    monster.currentGoal = { kind: "prowl" };
    return;
  }
  if (dist2(monster.pos, prey.pos) > ATTACK_RADIUS * ATTACK_RADIUS) return;

  const drained = Math.min(MONSTER_ATTACK_DRAIN_PER_TICK, prey.hp);
  prey.hp -= drained;
  monster.hp = Math.min(monster.hpMax, monster.hp + drained * MONSTER_ATTACK_EFFICIENCY);
  result.attacks.push({ monsterId: monster.id, devotId: prey.id, drained });

  // The prey is warned once per attacker, and then it is its own problem.
  if (prey.underAttackBy !== monster.id) {
    prey.underAttackBy = monster.id;
    result.triggers.push({
      kind: "threat",
      creatureId: prey.id,
      eventText: `A monster, ${monster.name} (id "${monster.id}"), has closed on you and is tearing your life away. It is at x=${monster.pos.x.toFixed(1)}, z=${monster.pos.z.toFixed(1)}. It is faster than you are.`,
      createdAt: now,
    });
  }
}

/**
 * What a monster notices. Its senses reach further than a devot's, but hills
 * blind it exactly the same way.
 */
export function monsterPerception(world: World, now: number = Date.now()): Trigger[] {
  const triggers: Trigger[] = [];
  const r2 = MONSTER_PERCEPTION_RADIUS * MONSTER_PERCEPTION_RADIUS;

  for (const monster of world.aliveMonsters()) {
    if (monster.thinking) continue;
    if (monster.currentGoal.kind === "hunt") continue;
    // The cadence guard belongs HERE, not only where the server nudges idle
    // monsters. A predator that can see prey is in an interesting situation on
    // every single tick, so without this it fires a trigger four times a second
    // and thinks itself to death in seconds — which is exactly what it did.
    if (now - monster.lastThoughtAt < MONSTER_THINK_INTERVAL_MS) continue;

    const prey = nearestVisibleDevot(world, monster, r2);
    if (!prey) continue;

    monster.lastThoughtAt = now;
    const ratio = Math.round((monster.hp / monster.hpMax) * 100);
    triggers.push({
      kind: "encounter",
      creatureId: monster.id,
      eventText: `You catch sight of a devot, ${prey.name} (id "${prey.id}"), at x=${prey.pos.x.toFixed(1)}, z=${prey.pos.z.toFixed(1)}. It looks ${prey.state}. You are at ${ratio}% of your own life, and it is draining.`,
      createdAt: now,
    });
  }
  return triggers;
}

function nearestVisibleDevot(
  world: World,
  monster: MonsterEntity,
  maxDist2: number,
): DevotEntity | undefined {
  let best: DevotEntity | undefined;
  let bestD = maxDist2;
  for (const devot of world.aliveDevots()) {
    const d = dist2(monster.pos, devot.pos);
    if (d > bestD) continue;
    if (!hasLineOfSight(monster.pos, devot.pos)) continue;
    bestD = d;
    best = devot;
  }
  return best;
}

/** Applies a monster's decision to its body. It cannot reproduce, ever. */
export function applyMonsterDecision(
  monster: MonsterEntity,
  decision: Decision,
  world: World,
): void {
  if (monster.state === "dead") return;
  switch (decision.action) {
    case "idle":
      monster.currentGoal = { kind: "idle" };
      break;
    case "move":
      if (decision.direction) {
        monster.currentGoal = {
          kind: "move_to",
          target: {
            x: monster.pos.x + decision.direction.x * 12,
            y: 0,
            z: monster.pos.z + decision.direction.z * 12,
          },
        };
      }
      break;
    case "attack":
    case "eat": {
      // Both mean the same thing to a predator: go and take that life. A
      // monster that names a devot hunts it; anything else, it keeps prowling.
      const prey = decision.targetId ? world.devots.get(decision.targetId) : undefined;
      if (prey && prey.state !== "dead") {
        monster.currentGoal = { kind: "hunt", targetId: prey.id };
      }
      break;
    }
    case "flee":
      if (decision.direction) {
        monster.currentGoal = {
          kind: "flee",
          from: {
            x: monster.pos.x - decision.direction.x,
            y: 0,
            z: monster.pos.z - decision.direction.z,
          },
        };
      }
      break;
    case "speak":
      monster.utterance = decision.utterance ?? "";
      break;
    case "reproduce":
      // There will be no others like it.
      break;
  }
}
