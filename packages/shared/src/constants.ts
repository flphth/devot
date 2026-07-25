// Cadence
export const TICK_MS = 250; // fenêtre d'action du corps (couche réactive)
export const PATCH_RATE_MS = 50; // synchro réseau Colyseus (P1)

// Verbe divin
export const DIVINE_MSG_MAX_CHARS = 140;
export const DIVINE_MSG_COOLDOWN_MS = 60_000;

// Paroles de devot
export const UTTERANCE_MAX_CHARS = 140;

// Économie vie ↔ tokens.
// HP exprimés en µ$ d'inférence : 1 HP = 1e-6 $ de pensée.
// hp_max par défaut = 50 000 HP = 0,05 $ de budget cognitif.
export const HP_MAX_DEFAULT = 50_000;
export const LETHALITY = 1e6; // usd → µ$ (HP)

// Prix par 1M tokens (in / out), cf. PLAN.md §5.2
export const PRICE_PER_MTOK = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 5, out: 25 },
} as const;

export type ModelId = keyof typeof PRICE_PER_MTOK;

// Garde-fous budget
// Coût plancher estimé d'une pensée (HP) : en-dessous, l'esprit ne se lance pas.
export const THOUGHT_COST_FLOOR_HP = 500;
// Concurrence maximale d'inférences simultanées.
export const MAX_CONCURRENT_INFERENCES = 4;
// Token bucket global : plafond de dépense serveur (µ$ / minute).
export const GLOBAL_BUDGET_UHP_PER_MIN = 500_000; // 0,50 $/min max

// Corps
export const DEVOT_SPEED = 2; // unités / seconde
export const EAT_RADIUS = 0.75;
export const PERCEPTION_RADIUS = 10;
export const HUNGRY_THRESHOLD = 0.4; // fraction de hpMax
export const AGONIZING_THRESHOLD = 0.15;

// Métabolisme passif : vivre coûte un peu, même sans penser (µ$/tick),
// pour que l'inaction totale ne soit pas une stratégie dominante éternelle.
export const METABOLISM_HP_PER_TICK = 1;

// Combat : prédation vitale (transfert de HP victime → agresseur).
export const ATTACK_RADIUS = 1.5;
export const ATTACK_DRAIN_PER_TICK = 150; // HP prélevés à la victime par tick
export const ATTACK_EFFICIENCY = 0.7; // part effectivement absorbée par l'agresseur

// Reproduction : procréer épuise.
export const REPRO_MIN_HP = 8_000; // en-dessous, trop faible pour procréer
export const REPRO_SOLO_COST_FRACTION = 0.4; // bourgeonnement : 40% des HP courants
export const REPRO_PAIR_COST_FRACTION = 0.3; // sexuée : 30% chacun
export const REPRO_TRANSFER_EFFICIENCY = 0.8; // part du coût qui devient la vie de l'enfant
export const REPRO_RADIUS = 3; // distance max entre partenaires

// Vieillir, c'est oublier : au-delà de ce nombre de messages, le chroniqueur
// condense l'historique en un souvenir unique.
export const CONTEXT_COMPACT_THRESHOLD_MSGS = 24;

// Banque de traits pour les mutations à la naissance.
export const TRAIT_POOL = [
  "curieux",
  "prudent",
  "vorace",
  "pieux",
  "rebelle",
  "pacifique",
  "féroce",
  "mélancolique",
  "joueur",
  "taciturne",
  "généreux",
  "envieux",
] as const;
