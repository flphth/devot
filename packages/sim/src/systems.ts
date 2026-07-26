import type {
  Decision,
  DevotEntity,
  FoodEntity,
  MonsterEntity,
  Trigger,
  Vec3,
} from "@devot/shared";
import {
  AGGRESSION_MEMORY_MS,
  BODY_RADIUS_DEVOT,
  BODY_RADIUS_MONSTER,
  AGONIZING_THRESHOLD,
  ATTACK_DRAIN_PER_TICK,
  ATTACK_EFFICIENCY,
  ATTACK_RADIUS,
  DEVOT_SPEED,
  EAT_RADIUS,
  HUNGRY_THRESHOLD,
  METABOLISM_PER_TICK,
  COMBAT_RESIDUE_FRACTION,
  PACK_BONUS_MAX_ALLIES,
  PACK_BONUS_PER_ALLY,
  PERCEPTION_RADIUS,
  THREAT_REALERT_MS,
  hasLineOfSight,
  metabolismMultiplier,
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
  /** `residue` is what the devot still held: it drops where it fell. */
  deaths: Array<{ devotId: string; cause: string; residue: number }>;
  eaten: Array<{ devotId: string; foodId: string; worth: number }>;
  combats: Array<{ attackerId: string; victimId: string; drained: number }>;
  /** Monsters brought down by devots. Their hoard has to go somewhere. */
  monsterDeaths: Array<{ monsterId: string; killerId: string; hoard: number; x: number; z: number }>;
  /** Food that rotted away untouched. */
  rotted: string[];
  /** Relics picked up: funds recovered by a devot, for its god. */
  claimed: Array<{
    devotId: string;
    godId: string;
    foodId: string;
    funds: number;
    leftBy: string;
  }>;
}

/**
 * WHAT A CORPSE IS WORTH: everything it was given at birth.
 *
 * The deposit that bought a devot never leaves LifeVault — nothing is withdrawn
 * on chain, and the burn is only ever a number in this simulation. So thinking
 * does not destroy the principal, it destroys the CREATURE; and when the
 * creature is gone the principal comes back to the world, on the ground, for
 * whoever is standing there.
 *
 * That is the whole rule, and it lives here alone. It used to be decided in four
 * different places that had already drifted apart: combat dropped 15% of
 * capacity, a monster's kill the same, divine lightning dropped the current
 * balance, and starving to death dropped NOTHING — which is how most devots die,
 * so the relic system almost never fired at all.
 */
export function legacyOf(devot: DevotEntity): number {
  return Math.max(0, Math.round(devot.bornWith));
}

/**
 * BODIES DO NOT SHARE A SPOT.
 *
 * Nothing stopped two creatures standing exactly on top of each other: they
 * slid through one another, a fight looked like one model wearing another, and
 * a crowd rendered as a single lump.
 *
 * This is the same idea as resolveRockCollisions, with one difference that
 * matters: a boulder does not move, so a body is pushed the whole way out of
 * it, while two bodies each give half the ground. That symmetry is what stops a
 * pair from shoving each other across the map.
 *
 * Relaxed a few times rather than solved. Separating A from B can push A into
 * C, and one pass leaves that overlap standing; three passes settle any crowd
 * this world can hold. It is not exact and does not need to be — the next tick
 * runs it again.
 *
 * Runs LAST, after every other system has finished moving things. Anywhere
 * earlier and the movement that follows it would undo the work.
 */
const SEPARATION_PASSES = 3;

function radiusOf(body: DevotEntity | MonsterEntity): number {
  return "godId" in body ? BODY_RADIUS_DEVOT : BODY_RADIUS_MONSTER;
}

export function separateBodies(world: World): void {
  // The dead do not take up room. A gravestone is scenery, and a battlefield
  // full of them would otherwise become a wall the living cannot walk through.
  const bodies: Array<DevotEntity | MonsterEntity> = [
    ...world.aliveDevots(),
    ...world.aliveMonsters(),
  ];
  if (bodies.length < 2) return;

  for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i]!;
        const b = bodies[j]!;
        const min = radiusOf(a) + radiusOf(b);
        let dx = b.pos.x - a.pos.x;
        let dz = b.pos.z - a.pos.z;
        let d = Math.hypot(dx, dz);
        if (d >= min) continue;

        if (d < 1e-6) {
          // Exactly superposed: divide by zero here, and both bodies become
          // NaN and vanish from the world for good. A fixed direction derived
          // from the pair keeps it deterministic instead of random.
          const angle = ((i * 7 + j * 13) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dz = Math.sin(angle);
          d = 1;
        }
        const push = (min - d) / 2;
        const ux = (dx / d) * push;
        const uz = (dz / d) * push;
        a.pos.x -= ux;
        a.pos.z -= uz;
        b.pos.x += ux;
        b.pos.z += uz;
        moved = true;
      }
    }
    if (!moved) break;
  }

  // Whatever the shoving did, the world's own rules still hold: nobody ends up
  // outside the map, inside a boulder, or floating above the ground.
  for (const body of bodies) {
    clampToWorld(body.pos, world.size);
    resolveRockCollisions(body.pos);
    body.pos.y = terrainHeight(body.pos.x, body.pos.z);
  }
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
    claimed: [],
  };
  const dt = TICK_MS / 1000;

  decaySystem(world, result, now);

  // WHO IS ON WHICH BEAST. Counted once, before any blow lands, so every
  // attacker in a pack gets the same bonus — computed inside the loop, the
  // devot that happened to be first in the map would fight alone and the last
  // would fight with everyone.
  const besetBy = new Map<string, number>();
  for (const devot of world.aliveDevots()) {
    if (devot.currentGoal.kind !== "attack") continue;
    const beast = world.monsters.get(devot.currentGoal.targetId);
    if (!beast || beast.state === "dead") continue;
    if (dist2(devot.pos, beast.pos) > ATTACK_RADIUS * ATTACK_RADIUS) continue;
    besetBy.set(beast.id, (besetBy.get(beast.id) ?? 0) + 1);
  }

  // Existing costs more at night and through winter: this is what stops
  // standing still from being a dominant strategy.
  const upkeep = METABOLISM_PER_TICK * metabolismMultiplier(world.worldMs);

  for (const devot of world.aliveDevots()) {
    devot.age += 1;
    devot.balance -= upkeep;

    movementSystem(devot, world, dt);
    feedingSystem(devot, world, result);
    combatSystem(devot, world, result, now, besetBy);
    hungerSystem(devot, world, result, now);
    deathSystem(devot, world, result, now);
  }

  // Nobody stands inside anybody else. Last, after every body has moved.
  separateBodies(world);

  // Reflexes run in their own pass, AFTER every blow of this tick has landed.
  // Folded into the loop above, whether a devot reacted depended on where it
  // happened to sit in the map relative to its attacker — the one inserted
  // first reacted a whole tick later than the one inserted second.
  for (const devot of world.aliveDevots()) reflexSystem(devot, world, now);

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
      if (!food || food.type === "legacy") {
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

/** Vital predation: on contact, balance transfer from victim to attacker. */
function combatSystem(
  devot: DevotEntity,
  world: World,
  result: TickResult,
  now: number,
  besetBy: Map<string, number>,
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

  // A killer cannot empty its victim. It drains down to the residue floor and
  // no further; what remains is the estate, and it drops on the ground when the
  // victim dies. Monsters have no estate to protect — draining one to nothing
  // is exactly how you get at its hoard.
  const floor = monster ? 0 : victim.capacity * COMBAT_RESIDUE_FRACTION;
  // A beast can only face one of them. Everyone else is on a flank it cannot
  // turn to, so a pack cuts it down faster than its numbers alone would say.
  const allies = monster ? Math.min((besetBy.get(monster.id) ?? 1) - 1, PACK_BONUS_MAX_ALLIES) : 0;
  const pack = 1 + Math.max(0, allies) * PACK_BONUS_PER_ALLY;
  const drained = Math.max(0, Math.min(drainOf(devot) * pack, victim.balance - floor));
  victim.balance -= drained;
  devot.balance = Math.min(devot.capacity, devot.balance + drained * ATTACK_EFFICIENCY);
  if (drained > 0) {
    result.combats.push({ attackerId: devot.id, victimId: victim.id, drained });
  }

  // Drained to the floor and still being struck: this is where it dies, and it
  // dies holding something.
  if (!monster && victim.balance <= floor + 1e-6) {
    const prey = victim as DevotEntity;
    prey.state = "dead";
    devot.currentGoal = { kind: "wander" };
    result.deaths.push({
      devotId: prey.id,
      cause: `killed by ${devot.name}`,
      residue: legacyOf(prey),
    });
    prey.balance = 0;
    return;
  }

  // Killing a monster is the one act in this world that pays: everything it
  // took from the devots it ate is released where it falls.
  if (monster && monster.balance <= 0) {
    monster.balance = 0;
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

  // The victim is alerted, and alerted AGAIN if it never got to think about
  // it. Firing once per attacker meant an alert raised while the devot was
  // already thinking was dropped by the queue and never came back: a devot
  // could be eaten alive having never once been told.
  if (shouldAlert(prey, devot.id, now)) {
    rememberAggressor(prey, devot.id);
    result.triggers.push({
      kind: "threat",
      devotId: prey.id,
      eventText: `${devot.name} is attacking you and draining your life! You lose balance every moment of contact. They are at x=${devot.pos.x.toFixed(1)}, z=${devot.pos.z.toFixed(1)}.`,
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
    // A relic is not a meal. It holds the funds a death released, and picking
    // it up enriches the finder's GOD rather than the finder — which is what
    // makes going for one a real choice instead of a free snack.
    if (food.type === "legacy") {
      if (dist2(devot.pos, food.pos) > EAT_RADIUS * EAT_RADIUS) continue;
      world.food.delete(food.id);
      result.claimed.push({
        devotId: devot.id,
        godId: devot.godId,
        foodId: food.id,
        funds: food.funds ?? 0,
        leftBy: food.leftBy ?? "",
      });
      break;
    }
    if (dist2(devot.pos, food.pos) <= EAT_RADIUS * EAT_RADIUS) {
      devot.balance = Math.min(devot.capacity, devot.balance + food.worth);
      world.food.delete(food.id);
      result.eaten.push({ devotId: devot.id, foodId: food.id, worth: food.worth });
      if (devot.currentGoal.kind === "seek_food" && devot.currentGoal.foodId === food.id) {
        devot.currentGoal = { kind: "wander" };
      }
      break; // one mouthful per tick
    }
  }
}

function hungerSystem(
  devot: DevotEntity,
  world: World,
  result: TickResult,
  now: number,
): void {
  // The dead do not get hungry. This runs before deathSystem and recomputes
  // state from balance, so without the guard it quietly RESURRECTED a devot that
  // combat had just killed — back to "dying", and then killed again a moment
  // later by deathSystem. The estate dropped twice.
  if (devot.state === "dead") return;
  const ratio = devot.balance / devot.capacity;
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

  // A starving devot with no goal goes for the nearest meal it can actually
  // see. The code here used to set `wander` — replacing wandering with
  // wandering, under a comment claiming the body looked for food. It did not,
  // and a starving devot would circle within sight of a meal until it died.
  if (
    (devot.state === "starving" || devot.state === "dying") &&
    (devot.currentGoal.kind === "idle" || devot.currentGoal.kind === "wander")
  ) {
    const meal = nearestVisibleFood(world, devot.pos, sightOf(devot) ** 2);
    devot.currentGoal = meal ? { kind: "seek_food", foodId: meal.id } : { kind: "wander" };
  }
}

function deathSystem(
  devot: DevotEntity,
  world: World,
  result: TickResult,
  now: number,
): void {
  // Combat can kill a devot part-way through this same tick, and the loop is
  // walking a list captured before the blow landed. Without this the victim is
  // reported dead twice — and its estate dropped twice with it.
  if (devot.state === "dead") return;
  if (devot.balance > 0) return;

  devot.balance = 0;
  devot.state = "dead";
  // Only blame a killer that was actually still on it. `underAttackBy` used to
  // name whoever had struck it at any point in its life, so a devot that
  // starved alone in a field was recorded as devoured — by a raw entity id, at
  // that, which is not a name any player has ever seen.
  const killer =
    now - (devot.lastStruckAt ?? 0) <= AGGRESSION_MEMORY_MS && devot.underAttackBy
      ? (world.devots.get(devot.underAttackBy) ?? world.monsters.get(devot.underAttackBy))
      : undefined;
  // It spent itself down to nothing, and still leaves everything it was given:
  // what it burned was its own time, not the deposit that bought it.
  result.deaths.push({
    residue: legacyOf(devot),
    devotId: devot.id,
    cause: killer ? `devoured by ${killer.name}` : "vital exhaustion",
  });
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
    // A relic holds funds, not life. Left in, a starving devot would walk the
    // width of the map to something that cannot feed it, and stand there.
    if (f.type === "legacy") continue;
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
    if (f.type === "legacy") {
      // Worth saying plainly: this is not a meal. It will not feed the devot,
      // and a mind told "food, worth 0" would rightly ignore it.
      lines.push(
        `- a RELIC left by ${f.leftBy || "the dead"} (id "${f.id}"), holding ${Math.round(f.funds ?? 0)} in funds, ${d.toFixed(1)} away at x=${f.pos.x.toFixed(1)}, z=${f.pos.z.toFixed(1)}${spoiling}. It will NOT feed you — it goes to your god, who needs it to make more of you.`,
      );
      continue;
    }
    lines.push(
      `- food (${f.type}, id "${f.id}"), worth ${Math.round(f.worth)}, ${d.toFixed(1)} away at x=${f.pos.x.toFixed(1)}, z=${f.pos.z.toFixed(1)}${spoiling}`,
    );
  }

  const body = lines.length
    ? `Around you, as far as you can see (beyond this you know nothing):\n${lines.join("\n")}`
    : "Around you, as far as you can see: nothing and no one.";

  return `${describeSelf(devot, world)}\n\n${body}`;
}

/**
 * Has this victim been told about this attacker, recently enough to count?
 *
 * Marks the alert as raised and returns whether it is worth raising. Re-arms
 * after THREAT_REALERT_MS so an alert lost to a busy mind is not lost for good.
 */
export function shouldAlert(victim: DevotEntity, attackerId: string, now: number): boolean {
  // Read before either is overwritten: a DIFFERENT attacker is news, and must
  // not be swallowed by a throttle armed for the previous one.
  const sameAttacker = victim.underAttackBy === attackerId;
  const recent = now - (victim.alertedAt ?? 0) < THREAT_REALERT_MS;

  // Stamped on EVERY blow, whether or not the victim is told about this one:
  // the reflex needs to know when it was last hit, and the telling is throttled.
  victim.lastStruckAt = now;
  victim.underAttackBy = attackerId;

  if (sameAttacker && recent) return false;
  victim.alertedAt = now;
  return true;
}

/**
 * FIGHT OR FLIGHT, DECIDED BY THE BODY.
 *
 * Being told it is under attack was never enough. A thought can be seconds
 * away — queued behind another devot's, or waiting on the budget — and until
 * it lands the body follows whatever goal it had, which is usually grazing.
 * Devots were being eaten while wandering.
 *
 * So the reflex is free and instant, like every other thing the body does
 * between two thoughts. It only ever overrides a PASSIVE goal: a mind that has
 * already chosen to flee, to hunt, or to walk somewhere is obeyed. The next
 * thought can overrule the reflex entirely — that is the point of having one.
 */
function reflexSystem(devot: DevotEntity, world: World, now: number): void {
  const attackerId = devot.underAttackBy;
  if (!attackerId) return;

  const attacker = world.devots.get(attackerId) ?? world.monsters.get(attackerId);
  if (!attacker || attacker.state === "dead") {
    devot.underAttackBy = undefined;
    return;
  }

  // AGGRESSION EXPIRES, AND THIS IS THE WHOLE POINT OF THE CLAUSE.
  //
  // Without it `underAttackBy` was set for life on the first blow a devot ever
  // took. The reflex below overrides any passive goal, and `seek_food` is
  // passive — so a devot that had survived one fight had every subsequent
  // decision to eat overwritten on the next tick, forever, and starved with a
  // meal in front of it. Every death in the log read "vital exhaustion".
  if (now - (devot.lastStruckAt ?? 0) > AGGRESSION_MEMORY_MS) {
    devot.underAttackBy = undefined;
    return;
  }

  const isMonster = world.monsters.has(attackerId);
  // A leash, not strict contact. Checking contact alone flickered: a devot
  // that broke away for a single tick had its mind obeyed again, chose to run,
  // and then ran forever while the beast trailed it — never fighting once.
  const leash = ATTACK_RADIUS * 3;
  const nearby = dist2(devot.pos, attacker.pos) <= leash * leash;

  // A MONSTER ON YOU IS NOT A DECISION.
  //
  // The reflex used to yield to any goal a mind had chosen — and with devots
  // thinking every ten seconds, one decision to flee stuck forever: they ran,
  // the beast followed, and they never fought back once, all the way to being
  // eaten. So while a monster that has drawn your blood is still on you, the
  // body fights, whatever the mind last said.
  //
  // Break the leash and the mind is obeyed again. Choosing to run before a
  // monster closes is a real choice, and a devot keeps it.
  if (isMonster && nearby) {
    devot.currentGoal = { kind: "attack", targetId: attackerId };
    return;
  }

  const goal = devot.currentGoal.kind;
  const passive = goal === "idle" || goal === "wander" || goal === "seek_food";
  if (!passive) return;

  // Against a monster at any range the answer is the same: turn and fight. A
  // monster brought down is the richest thing in this world.
  if (isMonster || devot.balance > attacker.balance) {
    devot.currentGoal = { kind: "attack", targetId: attackerId };
  } else {
    // Against another devot the instinct stays crude: strike back at something
    // weaker, run from something stronger. A mind weighs the rest.
    devot.currentGoal = { kind: "flee", from: { ...attacker.pos } };
  }
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
  // oneself, and one a snapshot of current balance cannot convey.
  if (devot.balanceAtLastThought !== undefined) {
    const delta = Math.round(devot.balance - devot.balanceAtLastThought);
    if (delta < -200) {
      lines.push(`Since your last thought you have LOST ${-delta} balance. You are bleeding out.`);
    } else if (delta > 200) {
      lines.push(`Since your last thought you have gained ${delta} balance.`);
    } else {
      lines.push(`Since your last thought your life has barely moved (${delta >= 0 ? "+" : ""}${delta} ).`);
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
      const refusal = canCraft(decision.item, devot.balance, devot.items);
      if (refusal) return;
      const recipe = recipeOf(decision.item)!;
      devot.balance -= recipe.cost;
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
      const named = foodId ? world.food.get(foodId) : undefined;
      // A named relic is refused like any other inedible thing: it holds funds,
      // and walking to it would neither feed the devot nor claim anything it
      // was not already going to walk over.
      if (named && named.type !== "legacy") {
        devot.currentGoal = { kind: "seek_food", foodId: named.id };
      } else {
        // Fallback bounded by perception: the body does not "know" about food
        // the devot cannot see — too far, behind a hill, or not food at all.
        const nearest = nearestVisibleFood(world, devot.pos, sightOf(devot) ** 2);
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
