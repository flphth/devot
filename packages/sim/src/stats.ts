import {
  ATTACK_DRAIN_PER_TICK,
  DEFAULT_STATS,
  DEVOT_SPEED,
  HP_MAX_DEFAULT,
  PERCEPTION_RADIUS,
  decodeIdentity,
  statMultiplier,
  type DevotEntity,
  type Stats,
} from "@devot/shared";

/**
 * LES STATS EN JEU.
 *
 * Chaque grandeur du monde passe désormais par ici plutôt que d'utiliser sa
 * constante brute. Un devot vigoureux vit plus longtemps, un devot vif se
 * déplace plus vite, un devot à la vue perçante voit plus loin — donc reçoit
 * davantage dans son prompt.
 *
 * Les stats viennent de l'identité PERSISTÉE, jamais de ce qu'un client
 * affirme : elles ont été validées une fois pour toutes à la naissance.
 *
 * Le décodage JSON est mémoïsé par chaîne d'identité. Sans cela, on
 * reparserait le même JSON pour chaque devot à chaque tick, dans la boucle la
 * plus chaude du serveur.
 */
const cache = new Map<string, Stats>();

export function statsOf(devot: DevotEntity): Stats {
  const raw = devot.identityJson;
  if (!raw) return DEFAULT_STATS;
  const hit = cache.get(raw);
  if (hit) return hit;
  const stats = decodeIdentity(raw)?.stats ?? DEFAULT_STATS;
  // Borne de sûreté : le cache suit le nombre d'identités DISTINCTES, pas le
  // nombre de devots. Il ne peut donc pas croître indéfiniment dans un monde
  // stable, mais un monde qui tourne des mois finirait par accumuler.
  if (cache.size > 4096) cache.clear();
  cache.set(raw, stats);
  return stats;
}

/** Points de vie maximaux de ce devot. */
export function hpMaxOf(devot: DevotEntity): number {
  return Math.round(HP_MAX_DEFAULT * statMultiplier(statsOf(devot).vitality));
}

/** Vitesse de déplacement, en unités par seconde. */
export function speedOf(devot: DevotEntity): number {
  return DEVOT_SPEED * statMultiplier(statsOf(devot).speed);
}

/** Rayon de perception : ce que ce devot voit, donc ce qui entre dans sa tête. */
export function sightOf(devot: DevotEntity): number {
  return PERCEPTION_RADIUS * statMultiplier(statsOf(devot).sight);
}

/** HP prélevés par tick quand ce devot attaque. */
export function drainOf(devot: DevotEntity): number {
  return ATTACK_DRAIN_PER_TICK * statMultiplier(statsOf(devot).power);
}
