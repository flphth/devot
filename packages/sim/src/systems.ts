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
  hasLineOfSight,
  resolveRockCollisions,
  slopeSpeedFactor,
  terrainGrade,
  terrainHeight,
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
  /** Monsters brought down by devots. Their hoard has to go somewhere. */
  monsterDeaths: Array<{ monsterId: string; killerId: string; hoard: number; x: number; z: number }>;
  /** Food that rotted away untouched. */
  rotted: string[];
}

/**
 * Food rots. Runs before the bodies move, so a devot never gets to eat on the
 * exact tick a meal expires — the race would be invisible and maddening.
 */
function decaySystem(world: World, result: TickResult, now: number): void {
  for (const food of world.food.values()) {
    if (now - food.spawnedAt < food.ttlMs) continue;
    world.food.delete(food.id);
    result.rotted.push(food.id);
  }
}

/**
 * Reactive layer: one deterministic simulation step (0 tokens).
 * Keeps the bodies alive and detects the triggers that will wake the minds.
 */
export function tick(world: World, now: number = Date.now()): TickResult {
  const result: TickResult = {
    triggers: [],
    deaths: [],
    eaten: [],
    combats: [],
    monsterDeaths: [],
    rotted: [],
  };
  const dt = TICK_MS / 1000;

  decaySystem(world, result, now);

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
      break;
    case "wander": {
      // Smoothed wandering: the heading drifts slowly (deterministic on age)
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
      const target = world.devots.get(goal.targetId) ?? world.monsters.get(goal.targetId);
      if (!target || target.state === "dead") {
        devot.currentGoal = { kind: "wander" };
        break;
      }
      // Hunting: close in until within striking range.
      if (dist2(devot.pos, target.pos) > ATTACK_RADIUS * ATTACK_RADIUS) {
        stepToward(devot, target.pos.x, target.pos.z, step * 1.2);
      }
      break;
    }
  }
  clampToWorld(devot.pos, world.size);
  resolveRockCollisions(devot.pos);
  // The ground is the only thing that decides altitude — bodies never fly and
  // never sink, whatever moved them (walking, clamping, a boulder, a god).
  devot.pos.y = terrainHeight(devot.pos.x, devot.pos.z);
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

/** Vital predation: on contact, HP transfer from victim to attacker. */
function combatSystem(
  devot: DevotEntity,
  world: World,
  result: TickResult,
  now: number,
): void {
  if (devot.currentGoal.kind !== "attack") return;
  const targetId = devot.currentGoal.targetId;
  const monster = world.monsters.get(targetId);
  const victim = world.devots.get(targetId) ?? monster;
  if (!victim || victim.state === "dead") {
    devot.currentGoal = { kind: "wander" };
    return;
  }
  if (dist2(devot.pos, victim.pos) > ATTACK_RADIUS * ATTACK_RADIUS) return;

  const drained = Math.min(drainOf(devot), victim.hp);
  victim.hp -= drained;
  devot.hp = Math.min(devot.hpMax, devot.hp + drained * ATTACK_EFFICIENCY);
  result.combats.push({ attackerId: devot.id, victimId: victim.id, drained });

  // Killing a monster is the one act in this world that pays: everything it
  // took from the devots it ate is released where it falls.
  if (monster && monster.hp <= 0) {
    monster.hp = 0;
    monster.state = "dead";
    devot.currentGoal = { kind: "wander" };
    result.monsterDeaths.push({
      monsterId: monster.id,
      killerId: devot.id,
      hoard: monster.hoard,
      x: monster.pos.x,
      z: monster.pos.z,
    });
    return;
  }
  // Past this point the victim is another devot, and only a devot can be told
  // it is being eaten — a monster has no mind to alert.
  const prey = world.devots.get(targetId);
  if (!prey) return;

  // The victim is alerted once per attacker: it is up to them to decide
  // (flee, strike back, beg, sacrifice themselves).
  if (prey.underAttackBy !== devot.id) {
    prey.underAttackBy = devot.id;
    rememberAggressor(prey, devot.id);
    result.triggers.push({
      kind: "threat",
      devotId: prey.id,
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
      if (dist2(devot.pos, other.pos) <= r2 && hasLineOfSight(devot.pos, other.pos)) {
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
    const food = nearestVisibleFood(world, devot.pos, r2);
    if (food) {
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

export function describeSurroundings(
  devot: DevotEntity,
  world: World,
  now: number = Date.now(),
): string {
  const r2 = sightOf(devot) ** 2;
  const lines: string[] = [];

  const others = world
    .aliveDevots()
    .filter(
      (o) =>
        o.id !== devot.id &&
        dist2(devot.pos, o.pos) <= r2 &&
        hasLineOfSight(devot.pos, o.pos),
    )
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

  // A monster in view is the most consequential thing a devot can be told
  // about: it is the only neighbour that will kill it for nothing in return.
  for (const m of world
    .aliveMonsters()
    .filter((m) => dist2(devot.pos, m.pos) <= r2 && hasLineOfSight(devot.pos, m.pos))
    .sort((a, b) => dist2(devot.pos, a.pos) - dist2(devot.pos, b.pos))) {
    const d = Math.sqrt(dist2(devot.pos, m.pos));
    const hunting = m.targetId === devot.id ? " — HUNTING YOU" : "";
    lines.push(
      `- A MONSTER, ${m.name} (id "${m.id}"), ${d.toFixed(1)} away at x=${m.pos.x.toFixed(1)}, z=${m.pos.z.toFixed(1)}, carrying a hoard of ${Math.round(m.hoard)} taken from the dead${hunting}`,
    );
  }

  const foods = [...world.food.values()]
    .filter((f) => dist2(devot.pos, f.pos) <= r2 && hasLineOfSight(devot.pos, f.pos))
    .sort((a, b) => dist2(devot.pos, a.pos) - dist2(devot.pos, b.pos));
  for (const f of foods.slice(0, SEEN_FOOD_MAX)) {
    const d = Math.sqrt(dist2(devot.pos, f.pos));
    // Whether it will still be there is half the decision: a devot that walks
    // slowly towards a meal about to rot has wasted the walk.
    const left = f.ttlMs - (now - f.spawnedAt);
    const spoiling = left < 12_000 ? ", ROTTING — it will be gone in seconds" : "";
    lines.push(
      `- food (${f.type}, id "${f.id}"), worth ${Math.round(f.hpValue)} HP, ${d.toFixed(1)} away at x=${f.pos.x.toFixed(1)}, z=${f.pos.z.toFixed(1)}${spoiling}`,
    );
  }

  const body = lines.length
    ? `Around you, as far as you can see (beyond this you know nothing):\n${lines.join("\n")}`
    : "Around you, as far as you can see: nothing and no one.";

  return `${describeSelf(devot, world)}\n\n${body}`;
}

/** A devot remembers who has hurt it, capped so the memory cannot grow forever. */
export function rememberAggressor(victim: DevotEntity, attackerId: string): void {
  const seen = victim.attackedBy ?? [];
  if (seen.includes(attackerId)) return;
  victim.attackedBy = [...seen, attackerId].slice(-4);
}

/**
 * WHAT A DEVOT KNOWS ABOUT ITS OWN SITUATION.
 *
 * The panorama says what is out there; this says what it means for the devot
 * looking at it. Without it a mind reads a list of neighbours with no sense of
 * whether it is winning or dying, and every thought starts from zero.
 */
function describeSelf(devot: DevotEntity, world: World): string {
  const lines: string[] = [];

  // Am I gaining or bleeding? The single most decision-changing fact about
  // oneself, and one a snapshot of current HP cannot convey.
  if (devot.hpAtLastThought !== undefined) {
    const delta = Math.round(devot.hp - devot.hpAtLastThought);
    if (delta < -200) {
      lines.push(`Since your last thought you have LOST ${-delta} HP. You are bleeding out.`);
    } else if (delta > 200) {
      lines.push(`Since your last thought you have gained ${delta} HP.`);
    } else {
      lines.push(`Since your last thought your life has barely moved (${delta >= 0 ? "+" : ""}${delta} HP).`);
    }
  }

  // Hunger is the reason predation exists. A starving devot that is never told
  // its neighbours are made of the thing it needs will simply wander and die.
  if (devot.state === "dying" || devot.state === "starving") {
    lines.push(
      "You are running out. Food is not the only life within reach: every devot and every monster around you is carrying some, and attacking takes it.",
    );
  }

  // Who has already done this to me. Devots do not otherwise remember their
  // aggressors from one thought to the next.
  const enemies = (devot.attackedBy ?? [])
    .map((id) => world.devots.get(id) ?? world.monsters.get(id))
    .filter((e): e is NonNullable<typeof e> => !!e && e.state !== "dead");
  if (enemies.length > 0) {
    lines.push(`Has attacked you before: ${enemies.map((e) => e.name).join(", ")}.`);
  }

  // The ground is now a tactic: high ground sees, low ground hides.
  const here = terrainHeight(devot.pos.x, devot.pos.z);
  const around = [
    terrainHeight(devot.pos.x + 6, devot.pos.z),
    terrainHeight(devot.pos.x - 6, devot.pos.z),
    terrainHeight(devot.pos.x, devot.pos.z + 6),
    terrainHeight(devot.pos.x, devot.pos.z - 6),
  ];
  const mean = around.reduce((a, b) => a + b, 0) / around.length;
  if (here - mean > 0.8) {
    lines.push("You stand on high ground: you see further from here, and you are seen.");
  } else if (mean - here > 0.8) {
    lines.push("You are down in a hollow: the rises around you hide what lies beyond them, and hide you too.");
  }

  // A different bullet on purpose: the panorama's "- " lines are the capped
  // list of neighbours, and this block must not be mistaken for one of them,
  // by the model or by the test that guards against prompt bloat.
  return lines.length ? `Your situation:\n${lines.map((l) => `· ${l}`).join("\n")}` : "";
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
      const id = decision.targetId;
      const target = id ? (world.devots.get(id) ?? world.monsters.get(id)) : undefined;
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
