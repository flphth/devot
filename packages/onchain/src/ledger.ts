/**
 * THE LIFE DEPOSIT, SETTLED IN BATCHES.
 *
 * A devot's balance are its life and its thinking budget at once, and they move
 * several times a second: metabolism, a bite of food, a blow taken, the cost of
 * a thought. Settling each of those on a chain would put a network round-trip
 * inside the tick and make the simulation depend on an RPC to stay alive.
 *
 * So movements accumulate here and are settled periodically, netted per devot.
 * A devot that lost 900 and gained 800 settles once, for 100. The simulation
 * never waits for any of it.
 *
 * The Settler is the seam. The default one writes an auditable local record;
 * an onchain one drops in without the simulation knowing the difference.
 */

export interface LifeMovement {
  devotId: string;
  address: string;
  /** Net balance change since the last settlement. Negative is life spent. */
  delta: number;
  /** Where its balance stands after this batch. */
  balance: number;
}

export interface Settlement {
  at: number;
  movements: LifeMovement[];
  /** Net life created or destroyed across the batch. Should be ≤ 0. */
  net: number;
}

export interface Settler {
  settle(batch: Settlement): Promise<void>;
}

/**
 * The default: keeps the batch in memory and hands it to a callback. Auditable,
 * instant, and it never makes the world depend on a network being up.
 */
export class LocalSettler implements Settler {
  constructor(private onSettled: (batch: Settlement) => void = () => {}) {}

  async settle(batch: Settlement): Promise<void> {
    this.onSettled(batch);
  }
}

export class LifeLedger {
  /** Pending net movement per devot, since the last settlement. */
  private pending = new Map<string, { address: string; delta: number; balance: number }>();
  /**
   * Starts at construction, not at zero: from zero the very first flush always
   * fires, so a world that had barely begun settled a batch on its first tick.
   */
  private lastSettledAt = Date.now();
  private inFlight = false;

  constructor(
    private settler: Settler,
    /** How often a batch goes out, in ms. */
    private intervalMs = 15_000,
  ) {}

  /** Notes where a devot's life stands. Cheap enough to call every tick. */
  record(devotId: string, address: string, balance: number): void {
    const previous = this.pending.get(devotId);
    if (!previous) {
      // First sighting in this batch: its delta is measured from here, not
      // from zero, or the opening balance would look like a deposit.
      this.pending.set(devotId, { address, delta: 0, balance: balance });
      return;
    }
    previous.delta += balance - previous.balance;
    previous.balance = balance;
  }

  /**
   * Settles if the interval has elapsed. Returns the batch that went out, or
   * undefined if it was not yet time — or if one is still in flight, because a
   * slow settlement must never queue up behind itself and double-count.
   */
  async flush(now: number = Date.now(), force = false): Promise<Settlement | undefined> {
    if (this.inFlight) return undefined;
    if (!force && now - this.lastSettledAt < this.intervalMs) return undefined;
    this.lastSettledAt = now;

    const movements: LifeMovement[] = [];
    for (const [devotId, entry] of this.pending) {
      if (entry.delta === 0) continue;
      movements.push({
        devotId,
        address: entry.address,
        delta: Math.round(entry.delta),
        balance: Math.round(entry.balance),
      });
      // The balance carries over; only the delta is cleared.
      entry.delta = 0;
    }
    if (movements.length === 0) return undefined;

    const batch: Settlement = {
      at: now,
      movements,
      net: movements.reduce((sum, m) => sum + m.delta, 0),
    };

    this.inFlight = true;
    try {
      await this.settler.settle(batch);
    } finally {
      this.inFlight = false;
    }
    return batch;
  }

  /** A devot that no longer exists stops being settled for. */
  forget(devotId: string): void {
    this.pending.delete(devotId);
  }

  get trackedCount(): number {
    return this.pending.size;
  }
}
