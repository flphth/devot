/**
 * Aléa SANS ÉTAT, portable CPU ↔ GPU.
 *
 * Un générateur à état (xorshift avec curseur) rendrait le résultat dépendant
 * de l'ordre de parcours des voxels — donc non parallélisable et non
 * reproductible sur GPU. À la place chaque voxel tire son aléa d'un hachage de
 * (son index, le tick, la graine du monde) : indépendant de l'ordre, calculable
 * en parallèle, et transposable tel quel en WGSL.
 *
 * Tous les calculs restent dans les entiers 32 bits via `Math.imul` et les
 * opérateurs bit à bit — c'est ce qui garantit l'égalité exacte avec le GPU.
 */

/** Mélangeur 32 bits (variante de Murmur3 finalizer + mix de Wang). */
export function hash32(a: number, b: number, c: number): number {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b1);
  h = (h ^ Math.imul(c | 0, 0x85ebca6b)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Entier pseudo-aléatoire dans [0, 2^16). Pratique pour les tirages de probabilité. */
export function rand16(idx: number, tick: number, seed: number): number {
  return hash32(idx, tick, seed) & 0xffff;
}

/** Entier pseudo-aléatoire dans [0, n) — n petit, biais négligeable et déterministe. */
export function randBelow(idx: number, tick: number, seed: number, n: number): number {
  return hash32(idx, tick, seed) % n;
}

/**
 * Générateur à état, réservé à ce qui n'est PAS dans les passes cellulaires :
 * génération du terrain initial, mutations d'un génome, placement d'un germe.
 * Séquentiel par nature, donc un état est ici légitime.
 */
export class SeededRng {
  private s: number;

  constructor(seed: number) {
    // Un état nul bloquerait xorshift.
    this.s = (seed | 0) === 0 ? 0x9e3779b9 : seed | 0;
  }

  /** Entier non signé sur 32 bits. */
  next(): number {
    let x = this.s | 0;
    x ^= x << 13;
    x |= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x |= 0;
    this.s = x;
    return x >>> 0;
  }

  /** Entier dans [0, n). */
  below(n: number): number {
    return this.next() % n;
  }

  /** Entier dans [min, max]. */
  range(min: number, max: number): number {
    return min + this.below(max - min + 1);
  }

  /** Vrai avec la probabilité num/den. */
  chance(num: number, den: number): boolean {
    return this.below(den) < num;
  }
}
