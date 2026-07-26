import type { Stats } from "@devot/shared";

/**
 * PERSONALITY PACKAGES.
 *
 * A quick way to shape a founder: pick a well-known figure and it fills in both
 * halves of a personality at once —
 *   • traits  → go into the mind's prompt, so they drive DECISIONS
 *               (flee vs fight, hunt, think more…).
 *   • stats   → drive the body's CAPABILITIES (HP, attack, speed, sight),
 *               and therefore whether those decisions actually work.
 *
 * A preset does NOT add a second system: it just pre-fills the same "Their
 * body" budget. Every preset's stats total STAT_BUDGET (12) and stay within
 * 1..5, so the server accepts them unchanged, and the player can still tweak
 * anything afterwards.
 *
 * ON NAMES: historical philosophers and public-domain literary figures are safe
 * to name. A living celebrity, or a trademarked modern film character, would
 * drag in likeness / IP questions before any public release — flagged, not
 * shipped blindly.
 */
export interface Preset {
  id: string;
  emoji: string;
  label: string;
  /** One line on how it PLAYS. */
  blurb: string;
  /** 2–3 traits, all from TRAIT_POOL. */
  traits: string[];
  /** Must total 12, each 1..5 (vitality, power, speed, sight). */
  stats: Stats;
  /** A suggested conviction, editable after. */
  soul: string;
}

export interface PresetGroup {
  id: string;
  label: string;
  presets: readonly Preset[];
}

// ── Archetypes ───────────────────────────────────────────────────────────────
const ARCHETYPES: readonly Preset[] = [
  {
    id: "detective",
    emoji: "🔍",
    label: "The Detective",
    blurb: "Sees far, thinks hard, avoids a fight.",
    traits: ["curious", "cautious", "taciturn"],
    stats: { vitality: 3, power: 2, speed: 2, sight: 5 },
    soul: "I see what others miss, and I stay alive by seeing it first.",
  },
  {
    id: "berserker",
    emoji: "⚔️",
    label: "The Berserker",
    blurb: "Hits hardest, hunts everything, never backs down.",
    traits: ["fierce", "defiant", "ravenous"],
    stats: { vitality: 4, power: 5, speed: 2, sight: 1 },
    soul: "I was not born to flee. Everything that bleeds is mine.",
  },
  {
    id: "guardian",
    emoji: "🛡️",
    label: "The Guardian",
    blurb: "Tough and calm — endures, protects, rarely strikes.",
    traits: ["cautious", "peaceful", "generous"],
    stats: { vitality: 5, power: 2, speed: 2, sight: 3 },
    soul: "I was born to protect my own, whatever it costs me.",
  },
  {
    id: "trickster",
    emoji: "🏃",
    label: "The Trickster",
    blurb: "Fast and sharp-eyed — darts in, grabs food, slips away.",
    traits: ["playful", "curious", "defiant"],
    stats: { vitality: 1, power: 2, speed: 5, sight: 4 },
    soul: "You cannot catch what you cannot corner.",
  },
  {
    id: "sage",
    emoji: "🧘",
    label: "The Hermit Sage",
    blurb: "Patient and watchful — thinks deeply, keeps to itself.",
    traits: ["melancholic", "taciturn", "pious"],
    stats: { vitality: 4, power: 2, speed: 2, sight: 4 },
    soul: "Every thought costs me. So I make each one count.",
  },
  {
    id: "predator",
    emoji: "🐺",
    label: "The Predator",
    blurb: "Quick and lethal — runs prey down without hesitation.",
    traits: ["ravenous", "fierce", "playful"],
    stats: { vitality: 1, power: 4, speed: 4, sight: 3 },
    soul: "Hunger is honest. I follow it, and it has never lied.",
  },
];

// ── Zodiac ───────────────────────────────────────────────────────────────────
const ZODIAC: readonly Preset[] = [
  {
    id: "aries",
    emoji: "♈",
    label: "Aries",
    blurb: "Bold and headstrong — charges first, asks never.",
    traits: ["fierce", "defiant", "playful"],
    stats: { vitality: 2, power: 5, speed: 4, sight: 1 },
    soul: "I go first, and the world rearranges itself around me.",
  },
  {
    id: "taurus",
    emoji: "♉",
    label: "Taurus",
    blurb: "Immovable and patient — outlasts every storm.",
    traits: ["cautious", "peaceful", "generous"],
    stats: { vitality: 5, power: 3, speed: 1, sight: 3 },
    soul: "Push all you like. I do not move until I choose to.",
  },
  {
    id: "gemini",
    emoji: "♊",
    label: "Gemini",
    blurb: "Quick and curious — always two steps and two minds ahead.",
    traits: ["curious", "playful", "taciturn"],
    stats: { vitality: 2, power: 2, speed: 4, sight: 4 },
    soul: "I am never only one thing, and that is my advantage.",
  },
  {
    id: "cancer",
    emoji: "♋",
    label: "Cancer",
    blurb: "Guarded and devoted — a hard shell around its own.",
    traits: ["cautious", "generous", "melancholic"],
    stats: { vitality: 5, power: 2, speed: 2, sight: 3 },
    soul: "My shell is not fear. It is everything I refuse to lose.",
  },
  {
    id: "leo",
    emoji: "♌",
    label: "Leo",
    blurb: "Proud and dominant — commands the ground it stands on.",
    traits: ["fierce", "defiant", "generous"],
    stats: { vitality: 4, power: 4, speed: 2, sight: 2 },
    soul: "I do not ask for the center. I simply stand where I am.",
  },
  {
    id: "virgo",
    emoji: "♍",
    label: "Virgo",
    blurb: "Precise and wary — misses nothing, wastes nothing.",
    traits: ["curious", "cautious", "taciturn"],
    stats: { vitality: 3, power: 2, speed: 2, sight: 5 },
    soul: "The flaw others overlook is the one that kills them.",
  },
  {
    id: "libra",
    emoji: "♎",
    label: "Libra",
    blurb: "Balanced and even — good at everything, extreme at nothing.",
    traits: ["peaceful", "generous", "curious"],
    stats: { vitality: 3, power: 3, speed: 3, sight: 3 },
    soul: "Every scale can tip. I decide which way, and when.",
  },
  {
    id: "scorpio",
    emoji: "♏",
    label: "Scorpio",
    blurb: "Intense and secretive — strikes once, strikes to the bone.",
    traits: ["fierce", "taciturn", "envious"],
    stats: { vitality: 2, power: 5, speed: 2, sight: 3 },
    soul: "I wait in silence. What I want, I take completely.",
  },
  {
    id: "sagittarius",
    emoji: "♐",
    label: "Sagittarius",
    blurb: "Restless and far-ranging — always moving toward the horizon.",
    traits: ["curious", "playful", "defiant"],
    stats: { vitality: 2, power: 1, speed: 5, sight: 4 },
    soul: "The horizon is not a limit. It is an invitation.",
  },
  {
    id: "capricorn",
    emoji: "♑",
    label: "Capricorn",
    blurb: "Disciplined and enduring — climbs slowly, never slips.",
    traits: ["cautious", "taciturn", "pious"],
    stats: { vitality: 5, power: 2, speed: 2, sight: 3 },
    soul: "I climb while others rest. That is the whole secret.",
  },
  {
    id: "aquarius",
    emoji: "♒",
    label: "Aquarius",
    blurb: "Inventive and detached — reads the field from outside it.",
    traits: ["curious", "defiant", "taciturn"],
    stats: { vitality: 3, power: 2, speed: 3, sight: 4 },
    soul: "I do not follow the herd. I watch where it stampedes.",
  },
  {
    id: "pisces",
    emoji: "♓",
    label: "Pisces",
    blurb: "Dreamy and gentle — flows around danger rather than through it.",
    traits: ["melancholic", "peaceful", "pious"],
    stats: { vitality: 4, power: 2, speed: 2, sight: 4 },
    soul: "Water does not fight the rock. It simply outlives it.",
  },
];

// ── Philosophers (historical — safe to name) ────────────────────────────────
const PHILOSOPHERS: readonly Preset[] = [
  {
    id: "socrates",
    emoji: "🏛️",
    label: "Socrates",
    blurb: "Questions everything, fights nothing — wins by knowing.",
    traits: ["curious", "taciturn", "peaceful"],
    stats: { vitality: 3, power: 2, speed: 2, sight: 5 },
    soul: "I know only that I know nothing — and that keeps me alive.",
  },
  {
    id: "diogenes",
    emoji: "🛢️",
    label: "Diogenes",
    blurb: "Shameless and free — mocks danger, takes what it needs.",
    traits: ["defiant", "taciturn", "ravenous"],
    stats: { vitality: 2, power: 3, speed: 4, sight: 3 },
    soul: "I owe nothing to anyone. Step out of my sunlight.",
  },
  {
    id: "aurelius",
    emoji: "🗿",
    label: "Marcus Aurelius",
    blurb: "Stoic and steady — endures all, complains of none.",
    traits: ["cautious", "taciturn", "pious"],
    stats: { vitality: 5, power: 2, speed: 2, sight: 3 },
    soul: "What stands in the way becomes the way.",
  },
  {
    id: "nietzsche",
    emoji: "⚡",
    label: "Nietzsche",
    blurb: "Will to power — hardens under pain, strikes to overcome.",
    traits: ["fierce", "defiant", "melancholic"],
    stats: { vitality: 3, power: 5, speed: 2, sight: 2 },
    soul: "What does not kill me makes me stronger.",
  },
  {
    id: "laozi",
    emoji: "☯️",
    label: "Laozi",
    blurb: "Wu wei — yields, flows, and is never where the blow lands.",
    traits: ["peaceful", "taciturn", "pious"],
    stats: { vitality: 4, power: 1, speed: 4, sight: 3 },
    soul: "The soft and yielding overcomes the hard and strong.",
  },
  {
    id: "suntzu",
    emoji: "🗡️",
    label: "Sun Tzu",
    blurb: "Sees all, moves unseen — wins before the fight begins.",
    traits: ["cautious", "curious", "taciturn"],
    stats: { vitality: 2, power: 1, speed: 4, sight: 5 },
    soul: "Every battle is won before it is ever fought.",
  },
];

// ── Literary & screen figures (public-domain — recognizable, safe) ───────────
const CHARACTERS: readonly Preset[] = [
  {
    id: "achilles",
    emoji: "⚔️",
    label: "Achilles",
    blurb: "Wrath incarnate — unmatched in the strike, doomed by it.",
    traits: ["fierce", "defiant", "melancholic"],
    stats: { vitality: 4, power: 5, speed: 2, sight: 1 },
    soul: "A short life ablaze, not a long one in the dark.",
  },
  {
    id: "odysseus",
    emoji: "🧭",
    label: "Odysseus",
    blurb: "Cunning survivor — reads the trap, endures the long way home.",
    traits: ["curious", "cautious", "defiant"],
    stats: { vitality: 3, power: 2, speed: 3, sight: 4 },
    soul: "Not the strongest. The one who makes it home.",
  },
  {
    id: "quixote",
    emoji: "🐎",
    label: "Don Quixote",
    blurb: "Deluded valor — charges giants that aren't there, and never quits.",
    traits: ["defiant", "pious", "playful"],
    stats: { vitality: 4, power: 3, speed: 3, sight: 2 },
    soul: "I fight the giants others are too sane to see.",
  },
  {
    id: "hamlet",
    emoji: "💀",
    label: "Hamlet",
    blurb: "The overthinker — sees every angle, hesitates on every one.",
    traits: ["melancholic", "curious", "cautious"],
    stats: { vitality: 3, power: 2, speed: 2, sight: 5 },
    soul: "To be, or not to be — I have not decided.",
  },
  {
    id: "ahab",
    emoji: "🐋",
    label: "Captain Ahab",
    blurb: "Obsession — hunts its white whale past all reason.",
    traits: ["fierce", "defiant", "envious"],
    stats: { vitality: 2, power: 5, speed: 2, sight: 3 },
    soul: "From hell's heart I stab at thee.",
  },
  {
    id: "scheherazade",
    emoji: "📖",
    label: "Scheherazade",
    blurb: "Survives on wit — buys another dawn with every clever move.",
    traits: ["curious", "generous", "cautious"],
    stats: { vitality: 4, power: 2, speed: 2, sight: 4 },
    soul: "One more story, and I live to see one more day.",
  },
];

export const PRESET_GROUPS: readonly PresetGroup[] = [
  { id: "archetype", label: "Archetype", presets: ARCHETYPES },
  { id: "zodiac", label: "Zodiac", presets: ZODIAC },
  { id: "philosopher", label: "Philosopher", presets: PHILOSOPHERS },
  { id: "character", label: "Character", presets: CHARACTERS },
];
