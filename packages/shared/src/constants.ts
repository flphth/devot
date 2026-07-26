// Cadence
export const TICK_MS = 250; // action window of the body (reactive layer)
export const PATCH_RATE_MS = 50; // Colyseus network sync (P1)

// Divine speech
export const DIVINE_MSG_MAX_CHARS = 140;
export const DIVINE_MSG_COOLDOWN_MS = 60_000;

// Devot speech
export const UTTERANCE_MAX_CHARS = 140;

// Life ↔ tokens economy.
// HP expressed in µ$ of inference: 1 HP = 1e-6 $ of thought.
// Default hp_max = 50,000 HP = $0.05 of cognitive budget.
export const HP_MAX_DEFAULT = 50_000;
export const LETHALITY = 1e6; // usd → µ$ (HP)

// Price per 1M tokens (in / out), cf. PLAN.md §5.2
export const PRICE_PER_MTOK = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 5, out: 25 },
} as const;

export type ModelId = keyof typeof PRICE_PER_MTOK;

// Budget guardrails
// Estimated floor cost of a thought (HP): below it, the mind does not start.
export const THOUGHT_COST_FLOOR_HP = 500;
// Maximum number of concurrent inferences.
export const MAX_CONCURRENT_INFERENCES = 4;
// Global token bucket: server spending ceiling (µ$ / minute).
export const GLOBAL_BUDGET_UHP_PER_MIN = 500_000; // $0.50/min max

// Body
export const DEVOT_SPEED = 2; // units / second
export const EAT_RADIUS = 0.75;
export const PERCEPTION_RADIUS = 10;
export const HUNGRY_THRESHOLD = 0.4; // fraction of hpMax
export const AGONIZING_THRESHOLD = 0.15;

// Passive metabolism: living costs a little even without thinking (µ$/tick),
// so that total inaction is not an eternally dominant strategy.
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
};
/** Random spread applied to a TTL, so food does not vanish in synchronised waves. */
export const FOOD_TTL_JITTER = 0.35;

// Combat: vital predation (HP transfer from victim → attacker).
export const ATTACK_RADIUS = 1.5;
export const ATTACK_DRAIN_PER_TICK = 150; // HP drained from the victim per tick
export const ATTACK_EFFICIENCY = 0.7; // share actually absorbed by the attacker

// Monsters. Predators with a mind, which is exactly why their numbers and
// their thinking cadence are capped: every monster that thinks spends from the
// same inference budget the devots draw on.
export const MONSTER_MAX_POPULATION = 4;
export const MONSTER_SPAWN_CHANCE_PER_TICK = 0.004; // ~1 per minute, at most
/**
 * A monster's mind runs at most this often. The real cost guard — and it has
 * to be enforced at every point that can wake one, not just the obvious one.
 */
export const MONSTER_THINK_INTERVAL_MS = 15_000;
export const MONSTER_HP_START = 40_000;
export const MONSTER_HP_MAX = 60_000;
/**
 * Monsters burn life far faster than devots: stop hunting and you die. Tuned
 * against the cost of thinking, not in isolation — a thought runs a monster
 * ~1500 HP, so at this cadence thinking already costs it more than living
 * does. Roughly five minutes of prowling before starvation.
 */
export const MONSTER_METABOLISM_HP_PER_TICK = 8;
export const MONSTER_SPEED = 2.6; // faster than a devot — that is the threat
export const MONSTER_PERCEPTION_RADIUS = 14; // and it sees further
export const MONSTER_ATTACK_DRAIN_PER_TICK = 220;
export const MONSTER_ATTACK_EFFICIENCY = 0.8;
/** Share of a dead monster's peak life that its carcass is worth as food. */
export const CARRION_HP_FRACTION = 0.45;

// Reproduction: procreating is exhausting.
export const REPRO_MIN_HP = 8_000; // below this, too weak to procreate
export const REPRO_SOLO_COST_FRACTION = 0.4; // budding: 40% of current HP
export const REPRO_PAIR_COST_FRACTION = 0.3; // sexual: 30% each
export const REPRO_TRANSFER_EFFICIENCY = 0.8; // share of the cost that becomes the child's life
export const REPRO_RADIUS = 3; // max distance between partners

// To age is to forget: past this many messages, the chronicler condenses the
// history into a single memory.
export const CONTEXT_COMPACT_THRESHOLD_MSGS = 24;

// Pool of traits for mutations at birth.
export const TRAIT_POOL = [
  "curious",
  "cautious",
  "voracious",
  "pious",
  "rebellious",
  "peaceful",
  "fierce",
  "melancholic",
  "playful",
  "taciturn",
  "generous",
  "envious",
] as const;
