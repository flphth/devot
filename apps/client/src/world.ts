// A small self-contained presentation world: devots wander toward goals (in
// straight lines, then pause — never spinning in circles), a monster hunts, and
// each devot carries a thought shown above its head. No server needed.

export type Kind = "devot" | "monster";

export interface Entity {
  id: string;
  kind: Kind;
  x: number;
  z: number;
  tx: number; // target
  tz: number;
  color: string;
  thought: string;
  speech: string;
  balance: number;
  hpMax: number;
  state: "vivant" | "affame" | "agonisant";
  heading: number; // facing angle (radians) — set to travel direction, held; no spin
  speed: number;
  thinkAt: number; // seconds until next thought
  speakUntil: number; // seconds remaining of a spoken bubble
  wait: number; // idle pause after reaching a goal
}

const BOUND = 8.5;
const THOUGHTS = [
  "Rester en vie, encore un instant.",
  "Où trouver de la nourriture ?",
  "Penser me coûte la vie…",
  "Ce monde est vaste et silencieux.",
  "Je sens une présence hostile.",
  "Économiser mes pensées.",
  "Qu'attend de moi mon dieu ?",
  "Je ne veux pas mourir.",
];
const SPEECH = ["Je suis là.", "Qui es-tu ?", "J'ai faim.", "Reste loin de moi !", "Encore un jour."];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]!;

function newGoal(e: Entity): void {
  e.tx = rand(-BOUND, BOUND);
  e.tz = rand(-BOUND, BOUND);
}

export function makeWorld(): Entity[] {
  const colors = ["#7dd3fc", "#a7f3d0", "#fca5a5", "#fcd34d", "#c4b5fd"];
  const devots: Entity[] = colors.map((c, i) => ({
    id: `DVT-00${i + 1}`,
    kind: "devot",
    x: rand(-6, 6),
    z: rand(-6, 6),
    tx: 0,
    tz: 0,
    color: c,
    thought: pick(THOUGHTS),
    speech: "",
    balance: Math.round(rand(30000, 90000)),
    hpMax: 100000,
    state: "vivant",
    heading: 0,
    speed: rand(1.1, 1.8),
    thinkAt: rand(1, 4),
    speakUntil: 0,
    wait: 0,
  }));
  devots.forEach(newGoal);

  const monster: Entity = {
    id: "Monstre",
    kind: "monster",
    x: 7,
    z: -7,
    tx: 0,
    tz: 0,
    color: "#ef4444",
    thought: "",
    speech: "",
    balance: 0,
    hpMax: 0,
    state: "vivant",
    heading: 0,
    speed: 1.0,
    thinkAt: 0,
    speakUntil: 0,
    wait: 0,
  };
  return [...devots, monster];
}

/** Smoothly rotate `from` toward `to` (shortest way) — facing, not spinning. */
function turnToward(from: number, to: number, maxStep: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
}

export function stepWorld(world: Entity[], dt: number): void {
  const monster = world.find((e) => e.kind === "monster");

  for (const e of world) {
    if (e.kind === "monster") {
      // Hunt the nearest devot in a straight line.
      const prey = world
        .filter((d) => d.kind === "devot")
        .sort((a, b) => (a.x - e.x) ** 2 + (a.z - e.z) ** 2 - ((b.x - e.x) ** 2 + (b.z - e.z) ** 2))[0];
      if (prey) {
        e.tx = prey.x;
        e.tz = prey.z;
      }
    } else {
      // Flee the monster if it is close; otherwise head to the current goal.
      if (monster) {
        const dx = e.x - monster.x;
        const dz = e.z - monster.z;
        const dist = Math.hypot(dx, dz);
        e.state = dist < 3 ? "agonisant" : dist < 5 ? "affame" : "vivant";
        if (dist < 4) {
          e.tx = Math.max(-BOUND, Math.min(BOUND, e.x + dx));
          e.tz = Math.max(-BOUND, Math.min(BOUND, e.z + dz));
          e.wait = 0;
        }
      }
      // Thoughts & occasional speech.
      e.thinkAt -= dt;
      if (e.thinkAt <= 0) {
        e.thought = pick(THOUGHTS);
        e.thinkAt = rand(2.5, 5);
        if (Math.random() < 0.3) {
          e.speech = pick(SPEECH);
          e.speakUntil = 2.4;
        }
      }
      if (e.speakUntil > 0) e.speakUntil -= dt;
    }

    // Move toward target in a straight line, then pause (no circling).
    if (e.wait > 0) {
      e.wait -= dt;
    } else {
      const dx = e.tx - e.x;
      const dz = e.tz - e.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.15) {
        if (e.kind === "devot") {
          e.wait = rand(0.6, 1.6); // stand still a moment
          newGoal(e);
        }
      } else {
        const nx = dx / dist;
        const nz = dz / dist;
        const move = Math.min(dist, e.speed * dt);
        e.x += nx * move;
        e.z += nz * move;
        // Face travel direction (held), never a continuous spin.
        e.heading = turnToward(e.heading, Math.atan2(nx, nz), 6 * dt);
      }
    }
  }
}
