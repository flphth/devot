import type { Micro } from "@devot/shared";

/**
 * The authoritative in-memory economy ledger — the exact accounting G3's
 * on-chain LifeVault will mirror. The server holds balances here; the chain
 * only ever sees creation, death and withdrawal (no per-tick settlement).
 *
 * THE security property (write its test BEFORE the contract):
 *
 *     Σ balances (live devots + monsters) + Σ residues (the dead on the ground)
 *       + Σ burned (spent on inference / metabolism) + Σ withdrawn (claimed out)
 *     == Σ deposited
 *
 * i.e. nothing is created or destroyed; every µ deposited is, at all times,
 * still held, burned, or withdrawn. Every method preserves it by construction;
 * `checkInvariant` proves it holds after each step of a whole simulated game.
 *
 * Monsters live in the same vault as ownerless balance entries — no third
 * contract, and their loot/metabolism flows through the same conserved moves.
 */
export class Vault {
  private depositedTotal: Micro = 0;
  private burnedTotal: Micro = 0;
  private withdrawnTotal: Micro = 0;
  private readonly balances = new Map<string, Micro>(); // tokenId → live balance
  private readonly residues = new Map<string, Micro>(); // residueId → ground balance

  /** createDevot(identityHash) payable → mint + balanceOf[tokenId] = deposit. */
  createDevot(tokenId: string, deposit: Micro): void {
    this.assertPositiveInt(deposit, "deposit");
    if (this.balances.has(tokenId)) throw new Error(`vault: tokenId ${tokenId} already exists`);
    this.depositedTotal += deposit;
    this.balances.set(tokenId, deposit);
  }

  /**
   * Spawn an ownerless monster with zero balance. It owns nothing until it
   * loots — closed economy, zero creation. (A monster BURNS to exist and grows
   * only by killing; see burn/transfer.)
   */
  spawnMonster(tokenId: string): void {
    if (this.balances.has(tokenId)) throw new Error(`vault: tokenId ${tokenId} already exists`);
    this.balances.set(tokenId, 0);
  }

  /** Burn balance to nothing — inference cost, or a monster's metabolism. */
  burn(tokenId: string, amount: Micro): void {
    this.assertPositiveInt(amount, "burn");
    const bal = this.mustBalance(tokenId);
    if (amount > bal) throw new Error(`vault: ${tokenId} cannot burn ${amount} of ${bal}`);
    this.balances.set(tokenId, bal - amount);
    this.burnedTotal += amount;
  }

  /** Move balance between two live entries — combat spoils, monster loot. */
  transfer(from: string, to: string, amount: Micro): void {
    this.assertPositiveInt(amount, "transfer");
    const fromBal = this.mustBalance(from);
    const toBal = this.mustBalance(to);
    if (amount > fromBal) throw new Error(`vault: ${from} cannot transfer ${amount} of ${fromBal}`);
    this.balances.set(from, fromBal - amount);
    this.balances.set(to, toBal + amount);
  }

  /** A devot/monster dies: its whole balance drops to the ground as a residue. */
  kill(tokenId: string, residueId: string): void {
    const bal = this.mustBalance(tokenId);
    if (this.residues.has(residueId)) throw new Error(`vault: residue ${residueId} exists`);
    this.balances.delete(tokenId);
    if (bal > 0) this.residues.set(residueId, bal);
  }

  /** The living pick up a residue and recharge — transfer only, zero creation. */
  eatResidue(tokenId: string, residueId: string): void {
    const bal = this.mustBalance(tokenId);
    const res = this.residues.get(residueId);
    if (res === undefined) throw new Error(`vault: no residue ${residueId}`);
    this.residues.delete(residueId);
    this.balances.set(tokenId, bal + res);
  }

  /** claim(tokenId): the god withdraws a living devot's balance out of the vault. */
  claim(tokenId: string): Micro {
    const bal = this.mustBalance(tokenId);
    this.balances.delete(tokenId); // effects before the (accounted) withdrawal
    this.withdrawnTotal += bal;
    return bal;
  }

  /** claim a dead devot's residue from the ground. */
  claimResidue(residueId: string): Micro {
    const res = this.residues.get(residueId);
    if (res === undefined) throw new Error(`vault: no residue ${residueId}`);
    this.residues.delete(residueId);
    this.withdrawnTotal += res;
    return res;
  }

  balanceOf(tokenId: string): Micro {
    return this.balances.get(tokenId) ?? 0;
  }
  residueOf(residueId: string): Micro {
    return this.residues.get(residueId) ?? 0;
  }
  get deposited(): Micro {
    return this.depositedTotal;
  }
  get burned(): Micro {
    return this.burnedTotal;
  }
  get withdrawn(): Micro {
    return this.withdrawnTotal;
  }

  /** Σ of everything still held in the vault (live balances + ground residues). */
  held(): Micro {
    let sum = 0;
    for (const b of this.balances.values()) sum += b;
    for (const r of this.residues.values()) sum += r;
    return sum;
  }

  /** THE invariant: held + burned + withdrawn == deposited. */
  checkInvariant(): boolean {
    return this.held() + this.burnedTotal + this.withdrawnTotal === this.depositedTotal;
  }

  private mustBalance(tokenId: string): Micro {
    const bal = this.balances.get(tokenId);
    if (bal === undefined) throw new Error(`vault: no live entry ${tokenId}`);
    return bal;
  }
  private assertPositiveInt(n: number, what: string): void {
    if (!Number.isInteger(n) || n < 0) throw new Error(`vault: ${what} must be a non-negative integer`);
  }
}
