/**
 * WHERE A DEVOT'S LIFE COMES FROM, AND WHERE IT GOES.
 *
 * A god cannot conjure devots. Each one has to be paid for: a DEPOSIT leaves the
 * god's treasury and becomes that devot's life. Thinking burns it. When the
 * devot dies, part of the deposit is released back into the world as a relic
 * lying where it fell — and the rest is gone for good.
 *
 * That "gone for good" is the point. If death returned everything, a line could
 * churn devots at no cost and the deposit would be a formality. Because death
 * destroys most of it, a god's treasury drains unless its devots go and pick up
 * what the dead left — including the dead of rival lines.
 *
 * Everything is accounted so that ONE invariant holds:
 *
 *   endowed == treasuries + living balances + relics on the ground + burned
 *
 * Nothing is created, nothing vanishes silently. This is the same rule the
 * on-chain LifeVault enforces, kept here so the two can be reconciled later.
 */

export interface EconomySnapshot {
  endowed: number;
  treasuries: number;
  burned: number;
}

export class Economy {
  private funds = new Map<string, number>();
  private endowedTotal = 0;
  private burnedTotal = 0;

  /** A god's opening funds. Once per god — a second call is ignored. */
  endow(godId: string, amount: number): void {
    if (this.funds.has(godId)) return;
    this.funds.set(godId, amount);
    this.endowedTotal += amount;
  }

  balanceOf(godId: string): number {
    return this.funds.get(godId) ?? 0;
  }

  canAfford(godId: string, amount: number): boolean {
    return this.balanceOf(godId) >= amount;
  }

  /**
   * Takes a deposit out of a god's treasury. Returns false and moves nothing if
   * the treasury is short — a god who cannot pay does not get a devot.
   */
  withdraw(godId: string, amount: number): boolean {
    const balance = this.balanceOf(godId);
    if (balance < amount) return false;
    this.funds.set(godId, balance - amount);
    return true;
  }

  /** Funds recovered from the ground flow back to the finder's god. */
  credit(godId: string, amount: number): void {
    this.funds.set(godId, this.balanceOf(godId) + amount);
  }

  /** What thinking and dying destroy. Counted, so the invariant can be checked. */
  burn(amount: number): void {
    if (amount <= 0) return;
    this.burnedTotal += amount;
  }

  snapshot(): EconomySnapshot {
    let treasuries = 0;
    for (const v of this.funds.values()) treasuries += v;
    return { endowed: this.endowedTotal, treasuries, burned: this.burnedTotal };
  }

  /**
   * Checks the books against the world.
   *
   * `livingValue` is the life still inside living creatures, `groundValue` what
   * is lying about waiting to be picked up. Exposed rather than kept private
   * because an economy nobody can audit is an economy that quietly leaks.
   */
  conserves(livingValue: number, groundValue: number, epsilon = 1): boolean {
    const { endowed, treasuries, burned } = this.snapshot();
    const accounted = treasuries + livingValue + groundValue + burned;
    return Math.abs(endowed - accounted) <= epsilon;
  }
}
