import { HDNodeWallet, Mnemonic, getIndexedAccountPath, randomBytes } from "ethers";

/**
 * EVERY DEVOT IS A WALLET.
 *
 * Each one is born with a real address: its onchain identity, the thing that
 * outlives its body and marks its line. Whatever a devot ever holds is held
 * there, and a gravestone is an address that stopped moving.
 *
 * Keys are DERIVED, never stored. One seed per world, and any devot's wallet
 * can be recomputed from its index — so the database holds addresses and
 * nothing else, and losing the database loses no key that the seed cannot
 * restore. It also means there is exactly one secret in this system instead of
 * one per creature.
 *
 * TESTNET ONLY. Nothing here should ever hold value that matters: the seed
 * lives in an env var and the chain this is aimed at is a test network.
 */

/** Where the world's wallets come from. Never logged, never persisted. */
export class WalletForge {
  private mnemonic: Mnemonic;

  /**
   * @param seedPhrase a BIP-39 mnemonic. Omit it and the world gets a fresh
   * random one for this run — wallets are then real addresses, but ephemeral,
   * which is the right default for a world nobody funded.
   */
  constructor(seedPhrase?: string) {
    this.mnemonic = seedPhrase
      ? Mnemonic.fromPhrase(seedPhrase.trim())
      : Mnemonic.fromEntropy(randomBytes(16));
  }

  /**
   * The wallet for the nth creature of this world. Deterministic.
   *
   * Derived from the mnemonic each time rather than from a cached root node:
   * fromMnemonic already walks to the default account path, so an absolute
   * path cannot be re-derived from what it returns.
   */
  at(index: number): HDNodeWallet {
    return HDNodeWallet.fromMnemonic(this.mnemonic, getIndexedAccountPath(index));
  }

  /** Just the address — what the rest of the game is allowed to see. */
  addressAt(index: number): string {
    return this.at(index).address;
  }

  /**
   * Proof that a devot's wallet signed something, without exposing the key.
   * Nothing needs this yet; it is the seam a real settlement would use.
   */
  async sign(index: number, message: string): Promise<string> {
    return this.at(index).signMessage(message);
  }
}

/** Short form for the UI: an address nobody can read in full at a glance. */
export function shortAddress(address: string): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
