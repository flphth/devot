import type { Micro } from "./economy.ts";

/**
 * THE single wei ↔ µ-unit conversion boundary (G2).
 *
 * The simulation keeps balances as integer µ-units; the chain (G3's LifeVault)
 * holds wei. Mixing floats and wei silently loses money to rounding in both
 * directions, so every conversion goes through here and nowhere else: wei is
 * `bigint`, µ-units are integers, and we never divide in floating point.
 *
 * Rate: 1 µ-unit = 1e12 wei ⇒ 1 OG (1e18 wei) = 1,000,000 µ-units. A 0.05 OG
 * deposit therefore mints 50,000 µ of life — the default devot lifespan scale.
 */
export const WEI_PER_MICRO = 1_000_000_000_000n; // 1e12

/** wei → µ-units, floored (a deposit never credits more life than it paid for). */
export function weiToMicro(wei: bigint): Micro {
  if (wei < 0n) throw new RangeError("weiToMicro: negative wei");
  return Number(wei / WEI_PER_MICRO);
}

/** µ-units → wei, exact (a withdrawal never pays out more than the balance holds). */
export function microToWei(micro: Micro): bigint {
  if (!Number.isInteger(micro) || micro < 0) throw new RangeError("microToWei: µ-units must be a non-negative integer");
  return BigInt(micro) * WEI_PER_MICRO;
}

/** The wei "dust" below one µ-unit that a wei amount does not cover (for exact accounting). */
export function weiRemainder(wei: bigint): bigint {
  if (wei < 0n) throw new RangeError("weiRemainder: negative wei");
  return wei % WEI_PER_MICRO;
}
