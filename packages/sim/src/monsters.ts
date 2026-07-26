import {
  ATTACK_RADIUS,
  MONSTER_ABSORB,
  MONSTER_DRAIN_PER_TICK,
  MONSTER_HP_MAX,
  MONSTER_METABOLISM_HP_PER_TICK,
  MONSTER_SIGHT,
  MONSTER_SPEED,
  TICK_MS,
  hasLineOfSight,
  resolveRockCollisions,
  slopeSpeedFactor,
  terrainGrade,
  terrainHeight,
  type MonsterEntity,
  type Trigger,
} from "@devot/shared";
import { clampToWorld, dist2, World } from "./world.js";

/**
 * MONSTERS: the danger that costs nothing to run.
 *
 * Devots are expensive — every decision they make is a real inference, paid for
 * in their own life. A world made dangerous by adding more devots would be a
 * world that costs more to be dangerous. A monster never thinks, so it is free.
 *
 * Which is exactly why it must not be free to EXIST. Without a metabolism a
 * monster would be a one-way drain: it takes and never spends, and given enough
 * time it holds everything anyone ever deposited, and the world stops. So it
 * starves like everything else. A monster that stops hunting dies.
 *
 * What it takes goes into a HOARD, and its death gives that hoard back to the
 * world as carrion. Nothing is created, nothing is destroyed — it only changes
 * hands, which is the rule the whole economy rests on.
 */

let seq = 0;

export function spawnMonster(world: World, x: number, z: number): MonsterEntity {
  const monster: MonsterEntity = {
    id: `monster-${Date.now()}-${++seq}`,
    name: `Beast-${seq}`,
    pos: { x, y: terrainHeight(x, z), z },
    hp: MONSTER_HP_MAX,
    hpMax: MONSTER_HP_MAX,
    hoard: 0,
    state: "alive",
  };
  world.monsters.set(monster.id, monster);
  return monster;
}

export interface MonsterTickResult {
  triggers: Trigger[];
  /** Drains to broadcast, so the client draws the same beam as devot combat. */
  combats: Array<{ attackerId: string; victimId: string; drained: number }>;
  deaths: Array<{ monsterId: string; hoard: number; x: number; z: number }>;
  kills: Array<{ monsterId: string; devotId: string }>;
}

export function monsterSystem(world: World, now: number = Date.now()): MonsterTickResult {
  const result: MonsterTickResult = { triggers: [], combats: [], deaths: [], kills: [] };
  const dt = TICK_MS / 1000;

  for (const monster of world.aliveMonsters()) {
    // Hunting is not optional: this is what it costs to be a monster.
    monster.hp -= MONSTER_METABOLISM_HP_PER_TICK;
    if (monster.hp <= 0) {
      monster.hp = 0;
      monster.state = "dead";
      result.deaths.push({
        monsterId: monster.id,
        hoard: monster.hoard,
        x: monster.pos.x,
        z: monster.pos.z,
      });
      continue;
    }

    const prey = acquireTarget(monster, world);
    monster.targetId = prey?.id;
    if (!prey) continue;

    const reach = ATTACK_RADIUS * ATTACK_RADIUS;
    if (dist2(monster.pos, prey.pos) > reach) {
      const dx = prey.pos.x - monster.pos.x;
      const dz = prey.pos.z - monster.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      // Slopes cost a monster exactly what they cost a devot: a hunt uphill
      // is a hunt that may not catch up.
      const grade = terrainGrade(monster.pos.x, monster.pos.z, dx / len, dz / len);
      const step = MONSTER_SPEED * dt * slopeSpeedFactor(grade);
      monster.pos.x += (dx / len) * step;
      monster.pos.z += (dz / len) * step;
      clampToWorld(monster.pos, world.size);
      resolveRockCollisions(monster.pos);
      monster.pos.y = terrainHeight(monster.pos.x, monster.pos.z);
      continue;
    }

    const drained = Math.min(MONSTER_DRAIN_PER_TICK, prey.hp);
    prey.hp -= drained;
    // It absorbs only a share; the rest swells the hoard, which is what makes a
    // long-lived monster worth hunting rather than merely worth avoiding.
    monster.hp = Math.min(monster.hpMax, monster.hp + drained * MONSTER_ABSORB);
    monster.hoard += drained * (1 - MONSTER_ABSORB);
    result.combats.push({ attackerId: monster.id, victimId: prey.id, drained });

    // Told once per hunter, like devot predation: it is up to the prey to decide.
    if (prey.underAttackBy !== monster.id) {
      prey.underAttackBy = monster.id;
      result.triggers.push({
        kind: "threat",
        devotId: prey.id,
        eventText: `A monster, ${monster.name} (id "${monster.id}"), has fallen upon you and is tearing your life away. It is at x=${monster.pos.x.toFixed(1)}, z=${monster.pos.z.toFixed(1)}. You can flee, or you can fight it — killing it would give you everything it has taken from others.`,
        createdAt: now,
      });
    }

    if (prey.hp <= 0) result.kills.push({ monsterId: monster.id, devotId: prey.id });
  }

  return result;
}

/**
 * Keeps its current prey while that prey is alive and in sight; else takes the
 * nearest. Hills blind a monster exactly as they blind a devot — prey that has
 * put a ridge between itself and the beast has genuinely escaped its notice.
 */
function acquireTarget(monster: MonsterEntity, world: World) {
  const r2 = MONSTER_SIGHT * MONSTER_SIGHT;
  const current = monster.targetId ? world.devots.get(monster.targetId) : undefined;
  if (
    current &&
    current.state !== "dead" &&
    dist2(monster.pos, current.pos) <= r2 &&
    hasLineOfSight(monster.pos, current.pos)
  ) {
    return current;
  }

  let best;
  let bestD = Infinity;
  for (const devot of world.aliveDevots()) {
    const d = dist2(monster.pos, devot.pos);
    if (d <= r2 && d < bestD && hasLineOfSight(monster.pos, devot.pos)) {
      bestD = d;
      best = devot;
    }
  }
  return best;
}
