import type { Decision } from "@devot/shared";
import {
  ATTACK_RADIUS,
  MONSTER_ABSORB,
  MONSTER_DRAIN_PER_TICK,
  MONSTER_HP_MAX,
  MONSTER_METABOLISM_HP_PER_TICK,
  MONSTER_SIGHT,
  MONSTER_SPEED,
  EAT_RADIUS,
  TICK_MS,
  hasLineOfSight,
  monsterSightMultiplier,
  resolveRockCollisions,
  slopeSpeedFactor,
  terrainGrade,
  terrainHeight,
  type MonsterEntity,
  type Trigger,
} from "@devot/shared";
import { rememberAggressor, shouldAlert } from "./systems.js";
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
    age: 0,
    thinking: false,
    utterance: "",
    // Staggered, so a pack that arrives together does not think in lockstep.
    lastThoughtAt: Date.now() - Math.floor(Math.random() * 6000),
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
  /** Relics a monster took off the ground, into its hoard. */
  scavenged: Array<{ monsterId: string; foodId: string; funds: number; leftBy: string }>;
}

export function monsterSystem(world: World, now: number = Date.now()): MonsterTickResult {
  const result: MonsterTickResult = {
    triggers: [],
    combats: [],
    deaths: [],
    kills: [],
    scavenged: [],
  };
  const dt = TICK_MS / 1000;

  for (const monster of world.aliveMonsters()) {
    // Hunting is not optional: this is what it costs to be a monster.
    monster.hp -= MONSTER_METABOLISM_HP_PER_TICK;
    scavenge(monster, world, result);
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

    monster.age += 1;

    // A mind that chose to break off or to lie in wait is obeyed. With no
    // intent — never thought, or the budget was spent — the body hunts on
    // instinct exactly as it did before monsters had minds at all.
    if (monster.intent?.kind === "lurk") {
      monster.targetId = undefined;
      continue;
    }
    if (monster.intent?.kind === "flee") {
      const dx = monster.pos.x - monster.intent.from.x;
      const dz = monster.pos.z - monster.intent.from.z;
      const len = Math.hypot(dx, dz) || 1;
      const step = MONSTER_SPEED * dt;
      monster.pos.x += (dx / len) * step;
      monster.pos.z += (dz / len) * step;
      clampToWorld(monster.pos, world.size);
      resolveRockCollisions(monster.pos);
      monster.pos.y = terrainHeight(monster.pos.x, monster.pos.z);
      monster.targetId = undefined;
      continue;
    }

    const chosen =
      monster.intent?.kind === "hunt" ? world.devots.get(monster.intent.targetId) : undefined;
    const prey = chosen && chosen.state !== "dead" ? chosen : acquireTarget(monster, world);
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
    if (shouldAlert(prey, monster.id, now)) {
      rememberAggressor(prey, monster.id);
      result.triggers.push({
        kind: "threat",
        devotId: prey.id,
        eventText: `A monster, ${monster.name} (id "${monster.id}"), has fallen upon you and is tearing your life away. It is at x=${monster.pos.x.toFixed(1)}, z=${monster.pos.z.toFixed(1)}. It is FASTER than you: running only postpones this. Killing it would give you everything it has taken from others.`,
        createdAt: now,
      });
    }

    if (prey.hp <= 0) result.kills.push({ monsterId: monster.id, devotId: prey.id });
  }

  return result;
}

/**
 * What a monster takes off the ground.
 *
 * A relic does not feed it — the funds go into its HOARD. That matters: a
 * monster is the one thing in this world that takes money OUT of circulation,
 * and the only way it comes back is if something kills the monster. A god whose
 * relic was scavenged has not lost it forever; it has been moved somewhere
 * dangerous.
 */
function scavenge(monster: MonsterEntity, world: World, result: MonsterTickResult): void {
  for (const item of world.food.values()) {
    if (item.type !== "legacy") continue;
    if (dist2(monster.pos, item.pos) > EAT_RADIUS * EAT_RADIUS) continue;
    world.food.delete(item.id);
    monster.hoard += item.funds ?? 0;
    result.scavenged.push({
      monsterId: monster.id,
      foodId: item.id,
      funds: item.funds ?? 0,
      leftBy: item.leftBy ?? "",
    });
    break; // one relic per tick, like everything else it takes
  }
}

/**
 * Keeps its current prey while that prey is alive and in sight; else takes the
 * nearest. Hills blind a monster exactly as they blind a devot — prey that has
 * put a ridge between itself and the beast has genuinely escaped its notice.
 */
function acquireTarget(monster: MonsterEntity, world: World) {
  // Predators see further in the dark; devots do not. Night is the beast's.
  const sight = MONSTER_SIGHT * monsterSightMultiplier(world.worldMs);
  const r2 = sight * sight;
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

/**
 * Applies a monster's decision to its body. It cannot reproduce, ever, and it
 * cannot graze: everything it does comes down to whose life it takes next.
 */
export function applyMonsterDecision(
  monster: MonsterEntity,
  decision: Decision,
  world: World,
): void {
  if (monster.state === "dead") return;
  switch (decision.action) {
    case "attack":
    case "eat": {
      // Both mean the same thing to a predator: go and take that life.
      const prey = decision.targetId ? world.devots.get(decision.targetId) : undefined;
      if (prey && prey.state !== "dead") {
        monster.intent = { kind: "hunt", targetId: prey.id };
      }
      break;
    }
    case "flee":
      if (decision.direction) {
        monster.intent = {
          kind: "flee",
          from: {
            x: monster.pos.x - decision.direction.x,
            y: 0,
            z: monster.pos.z - decision.direction.z,
          },
        };
      }
      break;
    case "idle":
      monster.intent = { kind: "lurk" };
      break;
    case "move":
      // A monster that wants to be elsewhere simply stops hunting and drifts;
      // its instinct will pick up whatever it runs into.
      monster.intent = undefined;
      break;
    case "speak":
      monster.utterance = decision.utterance ?? "";
      break;
    default:
      // reproduce, craft: there will be no others like it, and it forges nothing.
      break;
  }
}

/**
 * WHAT A MONSTER CAN SEE.
 *
 * Its own panorama, not the devots': a predator does not care about lines,
 * gods or flowers. It needs to know what is close, how weak it is, and whether
 * anything nearby is coming for it.
 */
export function describeMonsterSurroundings(monster: MonsterEntity, world: World): string {
  const sight = MONSTER_SIGHT * monsterSightMultiplier(world.worldMs);
  const r2 = sight * sight;

  const prey = world
    .aliveDevots()
    .filter((d) => dist2(monster.pos, d.pos) <= r2 && hasLineOfSight(monster.pos, d.pos))
    .sort((a, b) => dist2(monster.pos, a.pos) - dist2(monster.pos, b.pos))
    .slice(0, 5);

  if (prey.length === 0) return "Nothing living is in sight.";

  const lines = prey.map((d) => {
    const dist = Math.sqrt(dist2(monster.pos, d.pos));
    const share = Math.round((d.hp / d.hpMax) * 100);
    // Whether it is coming for you is the fact that decides everything.
    const coming =
      d.currentGoal.kind === "attack" && d.currentGoal.targetId === monster.id
        ? " — COMING FOR YOU"
        : "";
    const condition = d.state === "dying" ? ", dying" : d.state === "starving" ? ", starving" : "";
    return `- ${d.name} (id "${d.id}"), ${dist.toFixed(1)} away, at ${share}% of its life${condition}${coming}`;
  });

  return `Living things within reach:\n${lines.join("\n")}`;
}
