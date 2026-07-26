import { eq } from "drizzle-orm";
import type { CognitionProfileName, DevotEntity, InferenceUsage } from "@devot/shared";
import type { DevotDb } from "./client.js";
import {
  devots,
  divineMsgs,
  food,
  messages,
  mintReceipts,
  monsters,
  worldEvents,
  worldState,
} from "./schema.js";

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
        generation: e.generation,
        itemsJson: JSON.stringify(e.items),
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
        itemsJson: JSON.stringify(e.items),
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
  world: WorldRepo;
}

export function createRepos(db: DevotDb): Repos {
  return {
    devots: new DevotRepo(db),
    messages: new MessageRepo(db),
    events: new EventRepo(db),
    divineMsgs: new DivineMsgRepo(db),
    mintReceipts: new MintReceiptRepo(db),
    world: new WorldRepo(db),
  };
}

// Re-export for direct use (cognition profile on the devot row)
export type { CognitionProfileName };

/**
 * THE WHOLE WORLD, WRITTEN DOWN AND READ BACK.
 *
 * Devot rows have been accumulating since the first release and nothing ever
 * read one: a reload destroyed the room, a restart destroyed the process, and
 * the world started empty every time while the database quietly filled up with
 * creatures nobody would ever see again.
 *
 * Saving is a full overwrite of the living, inside one transaction. Rows are
 * deleted and rewritten rather than diffed because the world is small and a
 * half-applied save is worse than a slightly slower one — a devot that vanished
 * from the world but survived in the table would come back from the dead on the
 * next boot.
 */
export interface PersistedFood {
  id: string;
  x: number;
  y: number;
  z: number;
  type: string;
  worth: number;
  source: string;
  spawnedAt: number;
  ttlMs: number;
  funds: number;
  leftBy: string;
}

export interface PersistedMonster {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  balance: number;
  capacity: number;
  hoard: number;
  state: string;
  age: number;
  targetId: string;
  lastThoughtAt: number;
}

export class WorldRepo {
  constructor(private db: DevotDb) {}

  /** Every devot that has not died. The gravestones stay in the table. */
  livingDevots() {
    return this.db.select().from(devots).all().filter((d) => d.state !== "dead" && !d.diedAt);
  }

  saveFood(items: PersistedFood[]): void {
    this.db.transaction((tx) => {
      tx.delete(food).run();
      for (const f of items) {
        tx.insert(food)
          .values({
            id: f.id,
            x: f.x,
            y: f.y,
            z: f.z,
            type: f.type,
            worth: f.worth,
            source: f.source,
            spawnedAt: f.spawnedAt,
            ttlMs: f.ttlMs,
            funds: f.funds,
            leftBy: f.leftBy,
          })
          .run();
      }
    });
  }

  loadFood(): PersistedFood[] {
    return this.db
      .select()
      .from(food)
      .all()
      .map((f) => ({
        id: f.id,
        x: f.x,
        y: f.y,
        z: f.z,
        type: f.type,
        worth: f.worth,
        source: f.source,
        spawnedAt: f.spawnedAt,
        ttlMs: f.ttlMs,
        funds: f.funds,
        leftBy: f.leftBy,
      }));
  }

  saveMonsters(beasts: PersistedMonster[]): void {
    this.db.transaction((tx) => {
      tx.delete(monsters).run();
      for (const m of beasts) tx.insert(monsters).values(m).run();
    });
  }

  loadMonsters(): PersistedMonster[] {
    return this.db.select().from(monsters).all();
  }

  /** The world's odds and ends: its clock, when each lineage began. */
  put(key: string, value: unknown): void {
    const row = { key, value: JSON.stringify(value) };
    this.db.insert(worldState).values(row).onConflictDoUpdate({
      target: worldState.key,
      set: { value: row.value },
    }).run();
  }

  get<T>(key: string): T | undefined {
    const row = this.db.select().from(worldState).where(eq(worldState.key, key)).get();
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return undefined;
    }
  }
}
