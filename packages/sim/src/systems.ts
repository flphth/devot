import type { Decision, DevotEntity, Trigger } from "@devot/shared";
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
  canCraft,
  describeIdentity,
  describeItems,
  recipeOf,
} from "@devot/shared";
import { drainOf, sightOf, speedOf } from "./stats.js";
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
  const step = speedOf(devot) * dt;

  switch (goal.kind) {
    case "idle":
      return;
    case "wander": {
      // Smoothed wandering: the heading drifts slowly (deterministic on age)
      // instead of zigzagging — the body keeps its direction for several ticks.
      const angle = devot.id.length * 1.7 + devot.age * 0.045;
      devot.pos.x += Math.cos(angle) * step * 0.5;
      devot.pos.z += Math.sin(angle) * step * 0.5;
      break;
    }
    case "seek_food": {
      const food = world.food.get(goal.foodId);
      if (!food) {
        devot.currentGoal = { kind: "wander" };
        return;
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
      devot.pos.x += (dx / len) * step * 1.5;
      devot.pos.z += (dz / len) * step * 1.5;
      break;
    }
    case "attack": {
      const target = world.devots.get(goal.targetId);
      if (!target || target.state === "dead") {
        devot.currentGoal = { kind: "wander" };
        return;
      }
      // Hunting: close in until within striking range.
      if (dist2(devot.pos, target.pos) > ATTACK_RADIUS * ATTACK_RADIUS) {
        stepToward(devot, target.pos.x, target.pos.z, step * 1.2);
      }
      break;
    }
  }
  clampToWorld(devot.pos, world.size);
}

/** Vital predation: on contact, HP transfer from victim to attacker. */
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

  const drained = Math.min(drainOf(devot), victim.hp);
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
      eventText: `${devot.name} is attacking you and draining your life! You lose HP every moment of contact. They are at x=${devot.pos.x.toFixed(1)}, z=${devot.pos.z.toFixed(1)}.`,
      createdAt: now,
    });
  }
}

function stepToward(devot: DevotEntity, tx: number, tz: number, step: number): void {
  const dx = tx - devot.pos.x;
  const dz = tz - devot.pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const s = Math.min(step, len);
  devot.pos.x += (dx / len) * s;
  devot.pos.z += (dz / len) * s;
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

  // Survival trigger when a threshold is crossed (not on every tick).
  if (devot.state !== prev && (devot.state === "starving" || devot.state === "dying")) {
    result.triggers.push({
      kind: "survival",
      devotId: devot.id,
      eventText:
        devot.state === "dying"
          ? "Your strength is failing you. You feel death approaching. Very little life remains."
          : "Hunger gnaws at you. Your life is dwindling and you have not eaten recently.",
      createdAt: now,
    });
  }

  // A starving devot with no goal starts looking for food on its own: the body
  // keeps the devot credible even while the mind sleeps.
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
 * Perception system: reports visible food and devots.
 * An encounter between devots is reported only once (metDevots).
 */
export function perceptionSystem(world: World, now: number = Date.now()): Trigger[] {
  const triggers: Trigger[] = [];
  const alive = world.aliveDevots();

  for (const devot of alive) {
    if (devot.thinking) continue;
    // Sight range is PER DEVOT: it decides what enters their prompt, and
    // therefore what they are able to think about.
    const r2 = sightOf(devot) ** 2;

    // Meeting another devot (including one from a rival line).
    for (const other of alive) {
      if (other.id === devot.id) continue;
      if (devot.metDevots?.includes(other.id)) continue;
      if (dist2(devot.pos, other.pos) <= r2) {
        devot.metDevots = [...(devot.metDevots ?? []), other.id];
        const sameGod = other.godId === devot.godId;
        triggers.push({
          kind: "encounter",
          devotId: devot.id,
          // LOOK enters perception: this is where the appearance chosen at
          // creation stops being decorative. The model sees a silhouette before
          // it sees an id, and decides on its own what to make of it — fear it,
          // follow it, avoid it. No rule forces any of that.
          eventText: `You meet ${other.name} (id "${other.id}"), a devot ${sameGod ? "of your own line" : "of a rival line, watched over by another god"}, ${describeIdentity(other.identityJson)}. They are at x=${other.pos.x.toFixed(1)}, z=${other.pos.z.toFixed(1)}.`,
          createdAt: now,
        });
      }
    }

    if (devot.currentGoal.kind === "seek_food" || devot.currentGoal.kind === "move_to")
      continue;
    const food = world.nearestFood(devot.pos);
    if (food && dist2(devot.pos, food.pos) <= r2) {
      triggers.push({
        kind: "encounter",
        devotId: devot.id,
        eventText: `You spot food (${food.type}, id "${food.id}") not far from you, toward x=${food.pos.x.toFixed(1)}, z=${food.pos.z.toFixed(1)}.`,
        createdAt: now,
      });
    }
  }
  return triggers;
}

/**
 * WHAT A DEVOT CAN SEE, RIGHT NOW.
 *
 * Perception used to fire once per novelty: a devot met was never mentioned
 * again, so a mind could be deciding while blind to a rival that had walked up
 * beside it. This builds the current picture instead, and it is appended to
 * every thought — so a devot always decides on what is actually around it.
 *
 * Bounded by that devot's own sight, which is the same radius the client draws
 * as fog of war: what the player sees lit is exactly what the mind is told.
 *
 * Capped on purpose. A sharp-eyed devot in a crowd would otherwise pour a long
 * list into its own prompt, and pay for every token of it with its life.
 */
const SEEN_DEVOTS_MAX = 6;
const SEEN_FOOD_MAX = 4;

export function describeSurroundings(devot: DevotEntity, world: World): string {
  const r2 = sightOf(devot) ** 2;
  const lines: string[] = [];

  const others = world
    .aliveDevots()
    .filter((o) => o.id !== devot.id && dist2(devot.pos, o.pos) <= r2)
    .sort((a, b) => dist2(devot.pos, a.pos) - dist2(devot.pos, b.pos));

  for (const o of others.slice(0, SEEN_DEVOTS_MAX)) {
    const d = Math.sqrt(dist2(devot.pos, o.pos));
    const line = o.godId === devot.godId ? "your own line" : "a rival line";
    const condition =
      o.state === "dying" ? ", dying" : o.state === "starving" ? ", starving" : "";
    // Who is attacking whom is the single most decision-changing fact in view.
    const fighting =
      o.currentGoal.kind === "attack"
        ? o.currentGoal.targetId === devot.id
          ? " — ATTACKING YOU"
          : " — attacking someone else"
        : "";
    lines.push(
      `- ${o.name} (id "${o.id}"), of ${line}, ${d.toFixed(1)} away at x=${o.pos.x.toFixed(1)}, z=${o.pos.z.toFixed(1)}${condition}, ${describeItems(o.items)}${fighting}`,
    );
  }
  if (others.length > SEEN_DEVOTS_MAX) {
    lines.push(`- and ${others.length - SEEN_DEVOTS_MAX} more devots, further off`);
  }

  const foods = [...world.food.values()]
    .filter((f) => dist2(devot.pos, f.pos) <= r2)
    .sort((a, b) => dist2(devot.pos, a.pos) - dist2(devot.pos, b.pos));
  for (const f of foods.slice(0, SEEN_FOOD_MAX)) {
    const d = Math.sqrt(dist2(devot.pos, f.pos));
    lines.push(
      `- food (${f.type}, id "${f.id}"), ${d.toFixed(1)} away at x=${f.pos.x.toFixed(1)}, z=${f.pos.z.toFixed(1)}`,
    );
  }

  if (lines.length === 0) {
    return "Around you, as far as you can see: nothing and no one.";
  }
  return `Around you, as far as you can see (beyond this you know nothing):\n${lines.join("\n")}`;
}

/** Applies a mind's decision to the body (new goal, utterance, …). */
export function applyDecision(devot: DevotEntity, decision: Decision, world: World): void {
  if (devot.state === "dead") return;
  switch (decision.action) {
    case "craft": {
      // FORGING: the raw material is life. The cost is taken here, once, and
      // the item stays as long as the devot lives. Refusal is silent on the
      // simulation side; it is the room that tells the devot why.
      const refusal = canCraft(decision.item, devot.hp, devot.items);
      if (refusal) return;
      const recipe = recipeOf(decision.item)!;
      devot.hp -= recipe.cost;
      devot.items = [...devot.items, recipe.kind];
      devot.currentGoal = { kind: "idle" };
      break;
    }
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
        // the devot cannot see.
        const nearest = world.nearestFood(devot.pos);
        if (
          nearest &&
          dist2(devot.pos, nearest.pos) <= sightOf(devot) ** 2
        ) {
          devot.currentGoal = { kind: "seek_food", foodId: nearest.id };
        }
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
