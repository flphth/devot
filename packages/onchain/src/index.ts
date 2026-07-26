/**
 * Onchain hook point (deferred — ARCHITECTURE.md §10).
 * Only the free stub exists today; the chain, the nature of the payment and
 * the identity will be defined later, behind this very interface.
 */
export interface Receipt {
  ok: boolean;
  ref: string;
}

export interface PaymentProvider {
  /** Creation / re-creation of a founder devot. */
  chargeDevotCreation(godId: string): Promise<Receipt>;
  /** Gift of food. */
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
