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
 * Couche réactive : un pas de simulation déterministe (0 token).
 * Fait vivre les corps et détecte les déclencheurs qui réveilleront les esprits.
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
      // Errance lissée : le cap dérive lentement (déterministe par âge) au lieu
      // de zigzaguer — le corps garde sa direction plusieurs ticks.
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
      // Chasse : s'approcher jusqu'à portée de frappe.
      if (dist2(devot.pos, target.pos) > ATTACK_RADIUS * ATTACK_RADIUS) {
        stepToward(devot, target.pos.x, target.pos.z, step * 1.2);
      }
      break;
    }
  }
  clampToWorld(devot.pos, world.size);
}

/** Prédation vitale : au contact, transfert de HP victime → agresseur. */
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

  // La victime est alertée une fois par agresseur : à elle de décider
  // (fuir, rendre les coups, supplier, se sacrifier).
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
      break; // une bouchée par tick
    }
  }
}

function hungerSystem(devot: DevotEntity, result: TickResult, now: number): void {
  const ratio = devot.hp / devot.hpMax;
  const prev = devot.state;

  if (ratio <= AGONIZING_THRESHOLD) devot.state = "dying";
  else if (ratio <= HUNGRY_THRESHOLD) devot.state = "starving";
  else devot.state = "alive";

  // Déclencheur de survie au franchissement de seuil (pas à chaque tick).
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

  // Un affamé sans but se met d'office à chercher à manger : le corps
  // garde le devot crédible même quand l'esprit dort.
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
 * Système de perception : signale nourriture et devots visibles.
 * Une rencontre entre devots n'est signalée qu'une fois (metDevots).
 */
export function perceptionSystem(world: World, now: number = Date.now()): Trigger[] {
  const triggers: Trigger[] = [];
  const alive = world.aliveDevots();

  for (const devot of alive) {
    if (devot.thinking) continue;
    // La portée de vue est PROPRE À CHAQUE DEVOT : c'est elle qui décide de ce
    // qui entre dans son prompt, donc de ce sur quoi il peut réfléchir.
    const r2 = sightOf(devot) ** 2;

    // Rencontre d'un autre devot (y compris d'une lignée rivale).
    for (const other of alive) {
      if (other.id === devot.id) continue;
      if (devot.metDevots?.includes(other.id)) continue;
      if (dist2(devot.pos, other.pos) <= r2) {
        devot.metDevots = [...(devot.metDevots ?? []), other.id];
        const sameGod = other.godId === devot.godId;
        triggers.push({
          kind: "encounter",
          devotId: devot.id,
          // L'ALLURE entre dans la perception : c'est là que l'apparence
          // choisie à la création cesse d'être décorative. Le modèle voit une
          // silhouette avant de voir un identifiant, et décide seul de ce qu'il
          // en fait — craindre, suivre, éviter. Aucune règle ne l'impose.
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

/** Applique une décision d'esprit au corps (nouveau but, parole…). */
export function applyDecision(devot: DevotEntity, decision: Decision, world: World): void {
  if (devot.state === "dead") return;
  switch (decision.action) {
    case "craft": {
      // FORGER : la matière première est la vie. Le coût est prélevé ici, une
      // fois, et l'objet reste tant que le devot vit. Le refus est silencieux
      // côté simulation ; c'est la salle qui explique au devot pourquoi.
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
        // Repli borné à la perception : le corps ne « connaît » pas la
        // nourriture que le devot ne peut pas voir.
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
      // Intention posée ici, concrétisée par le serveur (ReproductionSystem),
      // qui gère aussi l'héritage de contexte via le chroniqueur.
      devot.pendingReproduction = { partnerId: decision.targetId };
      break;
  }
}
