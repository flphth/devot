import { eq } from "drizzle-orm";
import type { CognitionProfileName, DevotEntity, InferenceUsage } from "@devot/shared";
import type { DevotDb } from "./client.js";
import { devots, divineMsgs, messages, mintReceipts, worldEvents } from "./schema.js";

export interface StoredMessage {
  role: "user" | "assistant";
  content: unknown;
}

export class DevotRepo {
  constructor(private db: DevotDb) {}

  insertFromEntity(e: DevotEntity, parents?: { a?: string; b?: string }): void {
    this.db
      .insert(devots)
      .values({
        id: e.id,
        godId: e.godId,
        isFounder: e.isFounder,
        name: e.name,
        balance: e.balance,
        capacity: e.capacity,
        bornWith: e.bornWith,
        cognitionProfile: e.profile,
        x: e.pos.x,
        y: e.pos.y,
        z: e.pos.z,
        state: e.state,
        traitsJson: JSON.stringify(e.traits),
        identityJson: e.identityJson ?? "",
        wallet: e.wallet ?? "",
        parentA: parents?.a,
        parentB: parents?.b,
        bornAt: Date.now(),
      })
      .run();
  }

  /** Periodic snapshot of the hot state (positions, balance, age). */
  snapshot(e: DevotEntity): void {
    this.db
      .update(devots)
      .set({
        balance: e.balance,
        state: e.state,
        x: e.pos.x,
        y: e.pos.y,
        z: e.pos.z,
        age: e.age,
        currentGoal: JSON.stringify(e.currentGoal),
        lastActionAt: Date.now(),
      })
      .where(eq(devots.id, e.id))
      .run();
  }

  /**
   * Death: the devot row survives as a gravestone (died_at), so the context is
   * deleted explicitly — CASCADE only covers the case where the devot row
   * itself would be deleted.
   */
  kill(devotId: string, cause: string): void {
    this.db
      .update(devots)
      .set({ balance: 0, state: "dead", diedAt: Date.now() })
      .where(eq(devots.id, devotId))
      .run();
    this.db.delete(messages).where(eq(messages.devotId, devotId)).run();
    this.db
      .insert(worldEvents)
      .values({
        type: "death",
        actorIdsJson: JSON.stringify([devotId]),
        payloadJson: JSON.stringify({ cause }),
        createdAt: Date.now(),
      })
      .run();
  }

  contextSize(devotId: string): number {
    return this.db.select().from(messages).where(eq(messages.devotId, devotId)).all()
      .length;
  }

  get(devotId: string) {
    return this.db.select().from(devots).where(eq(devots.id, devotId)).get();
  }
}

export class MessageRepo {
  constructor(private db: DevotDb) {}

  append(
    devotId: string,
    role: "user" | "assistant",
    content: unknown,
    usage?: InferenceUsage,
  ): void {
    this.db
      .insert(messages)
      .values({
        devotId,
        role,
        contentJson: JSON.stringify(content),
        tokensIn: usage?.inputTokens ?? 0,
        tokensOut: usage?.outputTokens ?? 0,
        createdAt: Date.now(),
      })
      .run();
  }

  history(devotId: string): StoredMessage[] {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.devotId, devotId))
      .all()
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: JSON.parse(m.contentJson) as unknown,
      }));
  }

  /** Timestamped history, for the "Mind" panel journal. */
  journal(
    devotId: string,
    limit = 40,
  ): Array<StoredMessage & { createdAt: number }> {
    const rows = this.db
      .select()
      .from(messages)
      .where(eq(messages.devotId, devotId))
      .all();
    return rows.slice(-limit).map((m) => ({
      role: m.role as "user" | "assistant",
      content: JSON.parse(m.contentJson) as unknown,
      createdAt: m.createdAt,
    }));
  }

  /** Replaces the whole history with a condensed memory (chronicler, P2). */
  replaceWithSummary(devotId: string, summary: string): void {
    this.db.delete(messages).where(eq(messages.devotId, devotId)).run();
    this.append(devotId, "user", `[Condensed memories of your past life] ${summary}`);
  }
}

export class EventRepo {
  constructor(private db: DevotDb) {}

  record(type: string, actorIds: string[], payload: Record<string, unknown> = {}): void {
    this.db
      .insert(worldEvents)
      .values({
        type,
        actorIdsJson: JSON.stringify(actorIds),
        payloadJson: JSON.stringify(payload),
        createdAt: Date.now(),
      })
      .run();
  }
}

/**
 * THE LEDGER OF DEPOSITS ALREADY HONOURED.
 *
 * Claiming a hash and spending it are one operation, not two: an insert that
 * fails on the primary key IS the refusal. Checking first and inserting after
 * would leave a window where two clients both pass the check.
 */
export class MintReceiptRepo {
  constructor(private db: DevotDb) {}

  /** True when this deposit is ours to use, false when it was already spent. */
  claim(r: { txHash: string; tokenId: bigint; god: string; deposit: bigint }): boolean {
    try {
      this.db
        .insert(mintReceipts)
        .values({
          txHash: r.txHash.toLowerCase(),
          tokenId: r.tokenId.toString(),
          god: r.god,
          deposit: r.deposit.toString(),
          usedAt: Date.now(),
        })
        .run();
      return true;
    } catch {
      // UNIQUE violation: somebody got here first.
      return false;
    }
  }

  spent(txHash: string): boolean {
    return (
      this.db
        .select()
        .from(mintReceipts)
        .where(eq(mintReceipts.txHash, txHash.toLowerCase()))
        .get() !== undefined
    );
  }
}

export class DivineMsgRepo {
  constructor(private db: DevotDb) {}

  record(godId: string, devotId: string, text: string): void {
    this.db.insert(divineMsgs).values({ godId, devotId, text, sentAt: Date.now() }).run();
  }
}

export interface Repos {
  devots: DevotRepo;
  messages: MessageRepo;
  events: EventRepo;
  divineMsgs: DivineMsgRepo;
  mintReceipts: MintReceiptRepo;
}

export function createRepos(db: DevotDb): Repos {
  return {
    devots: new DevotRepo(db),
    messages: new MessageRepo(db),
    events: new EventRepo(db),
    divineMsgs: new DivineMsgRepo(db),
    mintReceipts: new MintReceiptRepo(db),
  };
}

// Re-export for direct use (cognition profile on the devot row)
export type { CognitionProfileName };
