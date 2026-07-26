// Cadence
export const TICK_MS = 250; // the body's action window (reactive layer)
export const PATCH_RATE_MS = 50; // Colyseus network sync (P1)

// Verbe divin
export const DIVINE_MSG_MAX_CHARS = 140;
export const DIVINE_MSG_COOLDOWN_MS = 60_000;

// Paroles de devot
export const UTTERANCE_MAX_CHARS = 140;

// Life ↔ token economy.
// HP expressed in µ$ of inference: 1 HP = 1e-6 $ of thinking.
//
// Default hp_max = 60,000 HP = $0.06 of cognitive budget.
//
// Cut from 150,000. A thought's price is computed from REAL token usage, so
// the pool IS the number of thoughts in a life: at roughly 1,500 HP for a
// Haiku thought, a devot now gets about forty of them instead of a hundred.
// Mortality was the whole premise and a hundred thoughts put death too far
// away to feel — a devot could deliberate its way through a season.
//
// Quantities expressed as a FRACTION of hp_max follow along on their own
// (hunger, agony, reproduction costs). Those in ABSOLUTE HP mechanically weigh
// two and a half times MORE against a whole life than they did — noted at each
// of them, because that is where the balance actually moved.
export const HP_MAX_DEFAULT = 60_000;
export const LETHALITY = 1e6; // usd → µ$ (HP)

// Price per 1M tokens (in / out), see PLAN.md §5.2
export const PRICE_PER_MTOK = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 5, out: 25 },
} as const;

export type ModelId = keyof typeof PRICE_PER_MTOK;

// Budget guardrails
// Estimated floor cost of a thought (HP): below it, the mind does not engage.
export const THOUGHT_COST_FLOOR_HP = 500;
// Maximum number of simultaneous inferences.
export const MAX_CONCURRENT_INFERENCES = 4;
// Global token bucket: server spending ceiling (µ$ per minute).
export const GLOBAL_BUDGET_UHP_PER_MIN = 500_000; // 0,50 $/min max

// Body
export const DEVOT_SPEED = 2; // units per second
export const EAT_RADIUS = 0.75;
export const PERCEPTION_RADIUS = 10;
export const HUNGRY_THRESHOLD = 0.4; // fraction of hpMax
export const AGONIZING_THRESHOLD = 0.15;

// Passive metabolism: living costs a little, even without thinking (µ$/tick),
// so that total inaction is not an eternally dominant strategy.
//
// It is night and winter that carry this argument now, not the number itself:
// upkeep is multiplied by the world's clock, so standing still is cheap by day
// in summer and expensive in the dark and the cold.
export const METABOLISM_HP_PER_TICK = 1;

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

// Combat: vital predation (HP transfer from victim to attacker).
export const ATTACK_RADIUS = 1.5;
// HP taken from the victim per tick. Absolute value: against a 60,000 pool a
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

// Reproduction: procreating exhausts.
// Below this, too weak to procreate. Absolute threshold: with the pool at
// 60,000 it is 13% of a life again, so a devot has to be genuinely doing well
// before it can spend itself on a child.
export const REPRO_MIN_HP = 8_000;
export const REPRO_SOLO_COST_FRACTION = 0.4; // budding: 40% of current HP
export const REPRO_PAIR_COST_FRACTION = 0.3; // sexual: 30% each
export const REPRO_TRANSFER_EFFICIENCY = 0.8; // share of the cost that becomes the child's life
export const REPRO_RADIUS = 3; // max distance between partners

// To grow old is to forget: beyond this many messages, the chronicler condenses
// the history into a single memory.
export const CONTEXT_COMPACT_THRESHOLD_MSGS = 24;

// Trait pool for mutations at birth.
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
export const MONSTER_HP_MAX = 60_000;
export const MONSTER_METABOLISM_HP_PER_TICK = 90;
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
