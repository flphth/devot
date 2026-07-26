// Cadence
export const TICK_MS = 250; // the body's action window (reactive layer)
export const PATCH_RATE_MS = 50; // Colyseus network sync (P1)

// Verbe divin
export const DIVINE_MSG_MAX_CHARS = 140;
export const DIVINE_MSG_COOLDOWN_MS = 60_000;

// Paroles de devot
export const UTTERANCE_MAX_CHARS = 140;

// Life ↔ token economy.
// balance expressed in µ$ of inference: 1 balance = 1e-6 $ of thinking.
//
// Default capacity = 60,000 balance = $0.06 of cognitive budget.
//
// Cut from 150,000. A thought's price is computed from REAL token usage, so
// the pool IS the number of thoughts in a life: at roughly 1,500 balance for a
// Haiku thought, a devot now gets about forty of them instead of a hundred.
// Mortality was the whole premise and a hundred thoughts put death too far
// away to feel — a devot could deliberate its way through a season.
//
// Quantities expressed as a FRACTION of capacity follow along on their own
// (hunger, agony, reproduction costs). Those in ABSOLUTE balance mechanically weigh
// two and a half times MORE against a whole life than they did — noted at each
// of them, because that is where the balance actually moved.
export const CAPACITY_DEFAULT = 60_000;
export const LETHALITY = 1e6; // usd → µ$ of balance

/**
 * A god cannot conjure devots: each one is paid for out of the treasury, and
 * the deposit becomes that devot's life. Vitality decides how much life the
 * same deposit buys, so the stat still matters.
 */
export const DEVOT_DEPOSIT = 60_000;
/** A god's opening funds — four devots, before recovering anything. */
export const GOD_ENDOWMENT = DEVOT_DEPOSIT * 4;
/**
 * What violence CANNOT take.
 *
 * A killer drains its victim down to this share of the victim's maximum and no
 * further; at that point the victim dies, and everything it still held drops
 * where it fell. Without a floor an attacker emptied its victim to zero, so
 * "the whole wallet drops on death" dropped nothing, always.
 *
 * It also changes what killing is FOR. Draining someone is no longer the
 * efficient way to take their life — you get most of it by standing on the
 * corpse afterwards, and so does everyone else who saw it happen.
 */
export const COMBAT_RESIDUE_FRACTION = 0.15;
/** How long a relic lies where its owner fell. Long enough to be worth crossing for. */
export const LEGACY_TTL_MS = 180_000;

/**
 * How much of a thought's real price a devot actually pays in life.
 *
 * This DELIBERATELY breaks the "1 balance = 1 µ$" identity, and it is worth being
 * honest about why. Devots are now always in the loop, thinking every ten
 * seconds whether or not anything has happened to them. At full price that is a
 * whole life in six minutes — the world never gets going before everyone in it
 * is dead.
 *
 * So an inference costs a fifth of what it is worth. A devot gets roughly two
 * hundred thoughts instead of forty, which is half an hour of watching rather
 * than one commercial break. The REAL spend against the subscription is
 * unchanged — this only alters what the game charges its creatures.
 */
export const THOUGHT_COST_SCALE = 0.2;

// Price per 1M tokens (in / out), see PLAN.md §5.2
export const PRICE_PER_MTOK = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 5, out: 25 },
} as const;

export type ModelId = keyof typeof PRICE_PER_MTOK;

// Budget guardrails
// Estimated floor cost of a thought: below it, the mind does not engage.
// Scaled with the cost of a thought: a floor above the actual price would stop
// a devot from thinking when it could plainly afford to.
export const THOUGHT_COST_FLOOR = 150;
// Maximum number of simultaneous inferences.
export const MAX_CONCURRENT_INFERENCES = 4;
// Global token bucket: server spending ceiling (µ$ per minute).
export const GLOBAL_BUDGET_UHP_PER_MIN = 500_000; // 0,50 $/min max

/**
 * How often a devot with nothing happening to it thinks anyway.
 *
 * Devots used to think only when something poked them, and drifted on autopilot
 * in between. They are now always in the loop: looking at where they are and
 * deciding what to do about it, on this cadence, with triggers still cutting
 * in front when something urgent happens.
 *
 * This is the most expensive number in the game. A thought runs ~1,500
 * against a 60,000 pool, so at 10 s a devot that never eats thinks itself to
 * death in about seven minutes — and every devot alive draws on the same
 * inference budget. Raise it to slow the world down and spend less.
 */
export const DEVOT_THINK_INTERVAL_MS = 10_000;

// Body
export const DEVOT_SPEED = 2; // units per second
export const EAT_RADIUS = 0.75;
export const PERCEPTION_RADIUS = 10;
export const HUNGRY_THRESHOLD = 0.4; // fraction of capacity
export const AGONIZING_THRESHOLD = 0.15;

// Passive metabolism: living costs a little, even without thinking (µ$/tick),
// so that total inaction is not an eternally dominant strategy.
//
// It is night and winter that carry this argument now, not the number itself:
// upkeep is multiplied by the world's clock, so standing still is cheap by day
// in summer and expensive in the dark and the cold.
export const METABOLISM_PER_TICK = 1;

// Food: it appears on its own, and it rots. A meal left uneaten is a meal
// lost — waiting is never free, and the map is never a stable larder.
export const FOOD_TARGET = 8; // ceiling on natural food lying around
export const FOOD_SPAWN_CHANCE_PER_TICK = 0.05; // ~1 every 5 s, at random
/** How long each kind lasts before rotting away, in ms. */
export const FOOD_TTL_MS: Record<string, number> = {
  grain: 60_000,
  fruit: 42_000,
  manna: 24_000, // divine and precious, therefore fleeting
  tainted: 90_000,
  // A carcass is the richest thing in the world and the one worth crossing it
  // for: it lasts long enough that the news of a kill can travel.
  carrion: 120_000,
};
/** Random spread applied to a TTL, so food does not vanish in synchronised waves. */
export const FOOD_TTL_JITTER = 0.35;

// Combat: vital predation (balance transfer from victim to attacker).
export const ATTACK_RADIUS = 1.5;
// balance taken from the victim per tick. Absolute value: against a 60,000 pool a
// sustained mauling empties a devot in roughly a minute and a half, which is
// long enough to run and short enough to be frightening.
export const ATTACK_DRAIN_PER_TICK = 150;
export const ATTACK_EFFICIENCY = 0.7;
/**
 * How long before a victim still under attack is told again. Without this an
 * alert raised while the devot was already thinking was dropped by the queue
 * and never came back.
 */
export const THREAT_REALERT_MS = 6_000; // share actually absorbed by the attacker
/**
 * HOW LONG THE BODY KEEPS FIGHTING AFTER THE LAST BLOW.
 *
 * The reflex used to have no end at all: a devot struck once carried
 * `underAttackBy` for the rest of its life, and since the reflex overrides any
 * passive goal, every "go and eat" it ever decided was overwritten on the very
 * next tick. Devots that had been in one fight could never eat again, and every
 * single one of them died of vital exhaustion.
 *
 * So aggression expires. Long enough to cover a chase — a monster closing from
 * the edge of the leash arrives in about two seconds — and short enough that a
 * skirmish which ended is genuinely over.
 */
export const AGGRESSION_MEMORY_MS = 5_000;

// Reproduction: procreating exhausts.
// Below this, too weak to procreate. Absolute threshold: with the pool at
// 60,000 it is 13% of a life again, so a devot has to be genuinely doing well
// before it can spend itself on a child.
export const REPRO_MIN_BALANCE = 8_000;
export const REPRO_SOLO_COST_FRACTION = 0.4; // budding: 40% of the current balance
export const REPRO_PAIR_COST_FRACTION = 0.3; // sexual: 30% each
export const REPRO_TRANSFER_EFFICIENCY = 0.8; // share of the cost that becomes the child's life
export const REPRO_RADIUS = 3; // max distance between partners

// To grow old is to forget: beyond this many messages, the chronicler condenses
// the history into a single memory.
export const CONTEXT_COMPACT_THRESHOLD_MSGS = 24;

// Trait pool for mutations at birth.
/**
 * WHICH MIND A DEVOT IS BORN WITH.
 *
 * Balanced (Sonnet) rather than frugal (Haiku): they reason visibly better and
 * weigh a whole panorama instead of reacting to the loudest line in it.
 *
 * It is not free, and the price is paid in life. Sonnet costs 3x Haiku on both
 * input and output, so at the same cadence a devot spends its balance three
 * times faster — roughly seventy thoughts in a life instead of two hundred.
 * If lives feel too short, DEVOT_THINK_INTERVAL_MS then DEVOT_DEPOSIT are the
 * dials, in that order.
 */
export const DEFAULT_DEVOT_PROFILE = "balanced" as const;

export const TRAIT_POOL = [
  "curious",
  "cautious",
  "ravenous",
  "pious",
  "defiant",
  "peaceful",
  "fierce",
  "melancholic",
  "playful",
  "taciturn",
  "generous",
  "envious",
] as const;

// ── Monsters ────────────────────────────────────────────────────────────────
// The world's predator. It never thinks, so it never pays for inference; the
// metabolism below is what stops it being a free, unbounded drain on everyone
// else. A monster that does not hunt dies, and gives back what it took.
export const MONSTER_CAPACITY = 60_000;
export const MONSTER_METABOLISM_PER_TICK = 90;
export const MONSTER_DRAIN_PER_TICK = 260;
export const MONSTER_SPEED = 2.4;
export const MONSTER_SIGHT = 14;
/** Share of what it drains that it actually absorbs; the rest swells the hoard. */
export const MONSTER_ABSORB = 0.35;
/**
 * A monster's mind runs at most this often — the real cost guard, and it has to
 * hold at every point that can wake one. A predator that can see prey is in an
 * interesting situation on every tick; without a leash it thinks four times a
 * second and starves on its own deliberation.
 */
export const MONSTER_THINK_INTERVAL_MS = 15_000;

/**
 * THE WORLD PRODUCES ITS OWN PREDATORS.
 *
 * Everything above this line — hunting, hoards, scavenging, the reflex that
 * makes a cornered devot turn and fight — was reachable only through the debug
 * "spawn a monster" button. In a real game no monster had ever existed, so
 * none of it ran, and the world was a meadow.
 *
 * The population is tied to the living, for two reasons. A predator with no
 * prey starves within a minute and is pure waste; and a lone founder taking
 * their first steps should not be met by a pack.
 */
export const MONSTER_PER_DEVOTS = 2;
export const MONSTER_MAX = 4;
/** ~1 every 25 s while the world is under its ceiling. */
export const MONSTER_SPAWN_CHANCE_PER_TICK = 0.01;
/**
 * How far from every living devot one may appear. Wider than MONSTER_SIGHT, so
 * a beast is never conjured already looking at someone — it has to find them,
 * and a player always gets to see it coming.
 */
export const MONSTER_SPAWN_MIN_DISTANCE = 18;
