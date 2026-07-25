/**
 * Point d'accroche onchain (différé — ARCHITECTURE.md §10).
 * Seul le stub gratuit existe aujourd'hui ; la chaîne, la nature du paiement
 * et l'identité seront définies plus tard, derrière cette même interface.
 */
export interface Receipt {
  ok: boolean;
  ref: string;
}

export interface PaymentProvider {
  /** Création / recréation d'un devot fondateur. */
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
