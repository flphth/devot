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
// Default hp_max = 150,000 HP = $0.15 of cognitive budget.
//
// Tripled from 50,000. Since a thought's price is computed from REAL token
// usage, tripling the pool literally triples the number of thoughts in a life:
// a devot lives three times longer AND thinks three times more.
//
// Quantities expressed as a FRACTION of hp_max follow along on their own
// (hunger, agony, reproduction costs). Those in ABSOLUTE HP mechanically become
// three times lighter relative to a whole life — noted at each of them, because
// several lose part of their meaning.
export const HP_MAX_DEFAULT = 150_000;
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
// CAREFUL: with the pool tripled, this cost weighs three times less on a life,
// so doing nothing has become three times more viable. The argument above has
// weakened accordingly.
export const METABOLISM_HP_PER_TICK = 1;

// Combat: vital predation (HP transfer from victim to attacker).
export const ATTACK_RADIUS = 1.5;
// HP taken from the victim per tick. Absolute value: with the pool tripled,
// killing someone now takes three times longer.
export const ATTACK_DRAIN_PER_TICK = 150;
export const ATTACK_EFFICIENCY = 0.7; // share actually absorbed by the attacker

// Reproduction: procreating exhausts.
// Below this, too weak to procreate. Absolute threshold: it now amounts to 5%
// of a life instead of 16%, so procreating is reachable much earlier.
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
