import type { Decision, DevotEntity, FoodEntity, Trigger, Vec3 } from "@devot/shared";
import {
  AGONIZING_THRESHOLD,
  ATTACK_DRAIN_PER_TICK,
  ATTACK_EFFICIENCY,
  ATTACK_RADIUS,
  DEVOT_SPEED,
  EAT_RADIUS,
  HUNGRY_THRESHOLD,
  METABOLISM_HP_PER_TICK,
  PERCEPTION_RADIUS,
  TICK_MS,
  hasLineOfSight,
  slopeSpeedFactor,
  terrainGrade,
  terrainHeight,
} from "@devot/shared";
import { clampToWorld, dist2, World } from "./world.js";

export interface TickResult {
  triggers: Trigger[];
  deaths: Array<{ devotId: string; cause: string }>;
  eaten: Array<{ devotId: string; foodId: string; hpValue: number }>;
  combats: Array<{ attackerId: string; victimId: string; drained: number }>;
}

/**
 * Reactive layer: one deterministic simulation step (0 tokens).
 * Keeps the bodies alive and detects the triggers that will wake the minds.
 */
export function tick(world: World, now: number = Date.now()): TickResult {
  const result: TickResult = { triggers: [], deaths: [], eaten: [], combats: [] };
  const dt = TICK_MS / 1000;

  for (const devot of world.aliveDevots()) {
    devot.age += 1;
    devot.hp -= METABOLISM_HP_PER_TICK;

    movementSystem(devot, world, dt);
    feedingSystem(devot, world, result);
    combatSystem(devot, world, result, now);
    hungerSystem(devot, result, now);
    deathSystem(devot, result);
  }

  return result;
}

function movementSystem(devot: DevotEntity, world: World, dt: number): void {
  const goal = devot.currentGoal;
  const step = DEVOT_SPEED * dt;

  switch (goal.kind) {
    case "idle":
      break;
    case "wander": {
      // Smoothed wandering: the heading drifts slowly (deterministic from age)
      // instead of zigzagging — the body keeps its direction for several ticks.
      const angle = devot.id.length * 1.7 + devot.age * 0.045;
      advance(devot, Math.cos(angle), Math.sin(angle), step * 0.5);
      break;
    }
    case "seek_food": {
      const food = world.food.get(goal.foodId);
      if (!food) {
        devot.currentGoal = { kind: "wander" };
        break;
      }
      stepToward(devot, food.pos.x, food.pos.z, step);
      break;
    }
    case "move_to": {
      stepToward(devot, goal.target.x, goal.target.z, step);
      if (dist2(devot.pos, goal.target) < 0.25) devot.currentGoal = { kind: "idle" };
      break;
    }
    case "flee": {
      const dx = devot.pos.x - goal.from.x;
      const dz = devot.pos.z - goal.from.z;
      const len = Math.hypot(dx, dz) || 1;
      advance(devot, dx / len, dz / len, step * 1.5);
      break;
    }
    case "attack": {
      const target = world.devots.get(goal.targetId);
      if (!target || target.state === "dead") {
        devot.currentGoal = { kind: "wander" };
        break;
      }
      // Hunt: close in until within striking range.
      if (dist2(devot.pos, target.pos) > ATTACK_RADIUS * ATTACK_RADIUS) {
        stepToward(devot, target.pos.x, target.pos.z, step * 1.2);
      }
      break;
    }
  }
  clampToWorld(devot.pos, world.size);
  // The ground is the only thing that decides altitude — bodies never fly and
  // never sink, whatever moved them (walking, clamping, a god's hand).
  devot.pos.y = terrainHeight(devot.pos.x, devot.pos.z);
}

/** Vital predation: on contact, HP transfers from victim → attacker. */
function combatSystem(
  devot: DevotEntity,
  world: World,
  result: TickResult,
  now: number,
): void {
  if (devot.currentGoal.kind !== "attack") return;
  const victim = world.devots.get(devot.currentGoal.targetId);
  if (!victim || victim.state === "dead") {
    devot.currentGoal = { kind: "wander" };
    return;
  }
  if (dist2(devot.pos, victim.pos) > ATTACK_RADIUS * ATTACK_RADIUS) return;

  const drained = Math.min(ATTACK_DRAIN_PER_TICK, victim.hp);
  victim.hp -= drained;
  devot.hp = Math.min(devot.hpMax, devot.hp + drained * ATTACK_EFFICIENCY);
  result.combats.push({ attackerId: devot.id, victimId: victim.id, drained });

  // The victim is alerted once per attacker: it is up to them to decide
  // (flee, strike back, beg, sacrifice themselves).
  if (victim.underAttackBy !== devot.id) {
    victim.underAttackBy = devot.id;
    result.triggers.push({
      kind: "threat",
      devotId: victim.id,
      eventText: `${devot.name} is attacking you and draining your life! You lose HP for every moment of contact. They are at x=${devot.pos.x.toFixed(1)}, z=${devot.pos.z.toFixed(1)}.`,
      createdAt: now,
    });
  }
}

/**
 * Moves the body along a unit direction, slowed or helped by the slope it is
 * about to walk into. A climb never becomes a wall and a descent never becomes
 * a slide — slopeSpeedFactor keeps the pace inside sane bounds.
 */
function advance(devot: DevotEntity, ux: number, uz: number, step: number): void {
  const grade = terrainGrade(devot.pos.x, devot.pos.z, ux, uz);
  const s = step * slopeSpeedFactor(grade);
  devot.pos.x += ux * s;
  devot.pos.z += uz * s;
}

function stepToward(devot: DevotEntity, tx: number, tz: number, step: number): void {
  const dx = tx - devot.pos.x;
  const dz = tz - devot.pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  advance(devot, dx / len, dz / len, Math.min(step, len));
}

function feedingSystem(devot: DevotEntity, world: World, result: TickResult): void {
  for (const food of world.food.values()) {
    if (dist2(devot.pos, food.pos) <= EAT_RADIUS * EAT_RADIUS) {
      devot.hp = Math.min(devot.hpMax, devot.hp + food.hpValue);
      world.food.delete(food.id);
      result.eaten.push({ devotId: devot.id, foodId: food.id, hpValue: food.hpValue });
      if (devot.currentGoal.kind === "seek_food" && devot.currentGoal.foodId === food.id) {
        devot.currentGoal = { kind: "wander" };
      }
      break; // one mouthful per tick
    }
  }
}

function hungerSystem(devot: DevotEntity, result: TickResult, now: number): void {
  const ratio = devot.hp / devot.hpMax;
  const prev = devot.state;

  if (ratio <= AGONIZING_THRESHOLD) devot.state = "dying";
  else if (ratio <= HUNGRY_THRESHOLD) devot.state = "starving";
  else devot.state = "alive";

  // Survival trigger fires when a threshold is crossed, not every tick.
  if (devot.state !== prev && (devot.state === "starving" || devot.state === "dying")) {
    result.triggers.push({
      kind: "survival",
      devotId: devot.id,
      eventText:
        devot.state === "dying"
          ? "Your strength is deserting you. You feel death approaching. Very little life remains."
          : "Hunger gnaws at you. Your life is dwindling and you have not eaten recently.",
      createdAt: now,
    });
  }

  // A starving devot with no goal starts looking for food by itself: the body
  // keeps the devot believable even while the mind sleeps.
  if (
    (devot.state === "starving" || devot.state === "dying") &&
    (devot.currentGoal.kind === "idle" || devot.currentGoal.kind === "wander")
  ) {
    devot.currentGoal = { kind: "wander" };
  }
}

function deathSystem(devot: DevotEntity, result: TickResult): void {
  if (devot.hp <= 0) {
    devot.hp = 0;
    devot.state = "dead";
    result.deaths.push({
      devotId: devot.id,
      cause: devot.underAttackBy ? `devoured by ${devot.underAttackBy}` : "vital exhaustion",
    });
  }
}

/**
 * Nearest food that is both within `maxDist2` and actually in sight — food
 * behind a hill does not exist as far as the body is concerned.
 */
export function nearestVisibleFood(world: World, from: Vec3, maxDist2: number) {
  let best: FoodEntity | undefined;
  let bestD = maxDist2;
  for (const f of world.food.values()) {
    const d = dist2(from, f.pos);
    if (d > bestD) continue;
    if (!hasLineOfSight(from, f.pos)) continue;
    bestD = d;
    best = f;
  }
  return best;
}

/**
 * Perception system: reports visible food and devots.
 * An encounter between devots is reported only once (metDevots).
 */
export function perceptionSystem(world: World, now: number = Date.now()): Trigger[] {
  const triggers: Trigger[] = [];
  const r2 = PERCEPTION_RADIUS * PERCEPTION_RADIUS;
  const alive = world.aliveDevots();

  for (const devot of alive) {
    if (devot.thinking) continue;

    // Encountering another devot (including one from a rival lineage).
    for (const other of alive) {
      if (other.id === devot.id) continue;
      if (devot.metDevots?.includes(other.id)) continue;
      if (dist2(devot.pos, other.pos) <= r2 && hasLineOfSight(devot.pos, other.pos)) {
        devot.metDevots = [...(devot.metDevots ?? []), other.id];
        const sameGod = other.godId === devot.godId;
        triggers.push({
          kind: "encounter",
          devotId: devot.id,
          eventText: `You meet ${other.name} (id "${other.id}"), a devot ${sameGod ? "of your own lineage" : "of a rival lineage, watched over by another god"}. They are at x=${other.pos.x.toFixed(1)}, z=${other.pos.z.toFixed(1)}.`,
          createdAt: now,
        });
      }
    }

    if (devot.currentGoal.kind === "seek_food" || devot.currentGoal.kind === "move_to")
      continue;
    const food = nearestVisibleFood(world, devot.pos, r2);
    if (food) {
      triggers.push({
        kind: "encounter",
        devotId: devot.id,
        eventText: `You spot food (${food.type}, id "${food.id}") not far from you, towards x=${food.pos.x.toFixed(1)}, z=${food.pos.z.toFixed(1)}.`,
        createdAt: now,
      });
    }
  }
  return triggers;
}

/** Applies a mind's decision to the body (new goal, speech…). */
export function applyDecision(devot: DevotEntity, decision: Decision, world: World): void {
  if (devot.state === "dead") return;
  switch (decision.action) {
    case "idle":
      devot.currentGoal = { kind: "idle" };
      break;
    case "move":
      if (decision.direction) {
        devot.currentGoal = {
          kind: "move_to",
          target: {
            x: devot.pos.x + decision.direction.x * 10,
            y: 0,
            z: devot.pos.z + decision.direction.z * 10,
          },
        };
      }
      break;
    case "eat": {
      const foodId = decision.targetId;
      if (foodId && world.food.has(foodId)) {
        devot.currentGoal = { kind: "seek_food", foodId };
      } else {
        // Fallback bounded by perception: the body does not "know" about food
        // the devot cannot see — neither too far, nor behind a hill.
        const nearest = nearestVisibleFood(
          world,
          devot.pos,
          PERCEPTION_RADIUS * PERCEPTION_RADIUS,
        );
        if (nearest) devot.currentGoal = { kind: "seek_food", foodId: nearest.id };
      }
      break;
    }
    case "flee":
      if (decision.direction) {
        devot.currentGoal = {
          kind: "flee",
          from: {
            x: devot.pos.x - decision.direction.x,
            y: 0,
            z: devot.pos.z - decision.direction.z,
          },
        };
      }
      break;
    case "speak":
      devot.utterance = decision.utterance ?? "";
      break;
    case "attack": {
      const target = decision.targetId ? world.devots.get(decision.targetId) : undefined;
      if (target && target.id !== devot.id && target.state !== "dead") {
        devot.currentGoal = { kind: "attack", targetId: target.id };
      }
      break;
    }
    case "reproduce":
      // Intent recorded here, carried out by the server (ReproductionSystem),
      // which also handles context inheritance through the chronicler.
      devot.pendingReproduction = { partnerId: decision.targetId };
      break;
  }
}
