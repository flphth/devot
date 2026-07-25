/**
 * Onchain hook point (deferred — ARCHITECTURE.md §10).
 * Only the free stub exists today; the chain, the nature of the payment and
 * identity will be settled later, behind this same interface.
 */
export interface Receipt {
  ok: boolean;
  ref: string;
}

export interface PaymentProvider {
  /** Creation / re-creation of a founder devot. */
  chargeDevotCreation(godId: string): Promise<Receipt>;
  /** Don de nourriture. */
  chargeFeed(godId: string): Promise<Receipt>;
}

export class FreeStubProvider implements PaymentProvider {
  async chargeDevotCreation(godId: string): Promise<Receipt> {
    return { ok: true, ref: `free-create-${godId}-${Date.now()}` };
  }
  async chargeFeed(godId: string): Promise<Receipt> {
    return { ok: true, ref: `free-feed-${godId}-${Date.now()}` };
  }
}
