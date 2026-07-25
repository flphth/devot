import { eq } from "drizzle-orm";
import type { CognitionProfileName, DevotEntity, InferenceUsage } from "@devot/shared";
import type { DevotDb } from "./client.js";
import { devots, divineMsgs, messages, worldEvents } from "./schema.js";

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
        hp: e.hp,
        hpMax: e.hpMax,
        cognitionProfile: e.profile,
        x: e.pos.x,
        y: e.pos.y,
        z: e.pos.z,
        state: e.state,
        traitsJson: JSON.stringify(e.traits),
        parentA: parents?.a,
        parentB: parents?.b,
        bornAt: Date.now(),
      })
      .run();
  }

  /** Snapshot périodique de l'état chaud (positions, HP, âge). */
  snapshot(e: DevotEntity): void {
    this.db
      .update(devots)
      .set({
        hp: e.hp,
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
   * Mort : la ligne devot survit comme pierre tombale (died_at), donc le
   * contexte est supprimé explicitement — le CASCADE ne couvre que le cas
   * où la ligne devot elle-même serait supprimée.
   */
  kill(devotId: string, cause: string): void {
    this.db
      .update(devots)
      .set({ hp: 0, state: "mort", diedAt: Date.now() })
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

  /** Remplace tout l'historique par un souvenir condensé (chroniqueur, P2). */
  replaceWithSummary(devotId: string, summary: string): void {
    this.db.delete(messages).where(eq(messages.devotId, devotId)).run();
    this.append(devotId, "user", `[Souvenirs condensés de ta vie passée] ${summary}`);
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
}

export function createRepos(db: DevotDb): Repos {
  return {
    devots: new DevotRepo(db),
    messages: new MessageRepo(db),
    events: new EventRepo(db),
    divineMsgs: new DivineMsgRepo(db),
  };
}

// Ré-export pour usage direct (profil de cognition sur la ligne devot)
export type { CognitionProfileName };
