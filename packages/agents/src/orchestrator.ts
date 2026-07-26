import pLimit from "p-limit";
import type {
  CognitionProfile,
  Decision,
  InferenceUsage,
  ThoughtSubject,
  Trigger,
} from "@devot/shared";
import {
  CONTEXT_COMPACT_THRESHOLD_MSGS,
  GLOBAL_BUDGET_UHP_PER_MIN,
  MAX_CONCURRENT_INFERENCES,
  THOUGHT_COST_FLOOR_HP,
  TRIGGER_PRIORITY,
} from "@devot/shared";
import type { StoredMessage } from "@devot/db";
import type { Chronicler } from "./chronicler.js";
import { hpCost } from "./hpCost.js";
import type { MindProvider } from "./mind.js";


export interface AppliedThought {
  devotId: string;
  decision: Decision;
  hpLoss: number;
}

/**
 * Where a creature's past is kept. Devots use the SQLite-backed repo, so their
 * memory survives a restart and dies with them; monsters use an in-memory store,
 * since they are ephemeral and their history has no owner to outlive.
 */
export interface MemoryStore {
  history(id: string): StoredMessage[];
  append(
    id: string,
    role: "user" | "assistant",
    content: unknown,
    usage?: InferenceUsage,
  ): void;
  replaceWithSummary(id: string, summary: string): void;
}

/**
 * Everything the orchestrator needs to run one creature's mind, whatever kind
 * of creature it is.
 */
export interface Thinker {
  /** The live entity: hp is read before thinking and written back after. */
  entity: { id: string; hp: number; state: string; thinking: boolean };
  subject: ThoughtSubject;
  profile: CognitionProfile;
  memory: MemoryStore;
}

/** Token bucket: caps global inference spending (µ$/min). */
class BudgetBucket {
  private spent = 0;
  private windowStart = Date.now();

  constructor(private capacityPerMin: number) {}

  tryConsume(estimate: number): boolean {
    const now = Date.now();
    if (now - this.windowStart >= 60_000) {
      this.spent = 0;
      this.windowStart = now;
    }
    if (this.spent + estimate > this.capacityPerMin) return false;
    this.spent += estimate;
    return true;
  }

  /** Adjusts with the real cost once the inference is done. */
  settle(estimate: number, actual: number): void {
    this.spent += actual - estimate;
  }
}

/**
 * Prioritised inference queue, decoupled from the tick:
 * - bounded concurrency (p-limit)
 * - a single thought in flight per devot
 * - priority: divine > threat > survival > encounter > idle
 * - pre-check hp > floor cost + global token bucket
 */
export class CognitionOrchestrator {
  private queue: Trigger[] = [];
  private inFlight = new Set<string>();
  private limit = pLimit(MAX_CONCURRENT_INFERENCES);
  private bucket = new BudgetBucket(GLOBAL_BUDGET_UHP_PER_MIN);

  constructor(
    private mind: MindProvider,
    private getThinker: (id: string) => Thinker | undefined,
    private onDecision: (applied: AppliedThought) => void,
    private onError: (devotId: string, err: unknown) => void = (id, err) =>
      console.error(`[orchestrator] thought failed for ${id}:`, err),
    /** Optionnel : active le vieillissement (compaction de l'historique). */
    private chronicler?: Chronicler,
  ) {}

  /** Drops off a trigger; the mind will be engaged in the background. */
  enqueue(trigger: Trigger): void {
    const thinker = this.getThinker(trigger.devotId);
    if (!thinker || thinker.entity.state === "dead") return;
    // A creature already thinking is not woken again: its thought is in flight.
    if (this.inFlight.has(trigger.devotId)) return;

    // One trigger queued per devot — but the URGENT one, not the first one.
    // Sorting only ever ordered different devots, so a devot queued behind its
    // own idle musing would think about nothing while being torn apart.
    const queuedIndex = this.queue.findIndex((t) => t.devotId === trigger.devotId);
    if (queuedIndex >= 0) {
      const queued = this.queue[queuedIndex]!;
      if (TRIGGER_PRIORITY[trigger.kind] >= TRIGGER_PRIORITY[queued.kind]) return;
      this.queue.splice(queuedIndex, 1);
    }

    this.queue.push(trigger);
    this.queue.sort((a, b) => TRIGGER_PRIORITY[a.kind] - TRIGGER_PRIORITY[b.kind]);
    this.pump();
  }

  get pendingCount(): number {
    return this.queue.length + this.inFlight.size;
  }

  private pump(): void {
    while (this.queue.length > 0 && this.limit.activeCount + this.limit.pendingCount < MAX_CONCURRENT_INFERENCES) {
      const trigger = this.queue.shift()!;
      const thinker = this.getThinker(trigger.devotId);
      if (!thinker || thinker.entity.state === "dead") continue;

      // Budget pre-check: a creature too poor to think abstains.
      if (thinker.entity.hp <= THOUGHT_COST_FLOOR_HP) continue;
      if (!this.bucket.tryConsume(THOUGHT_COST_FLOOR_HP)) {
        // Under budget pressure: the non-priority ones fall asleep.
        // The body carries on; the mind waits for the next window.
        this.queue.unshift(trigger);
        return;
      }

      const id = thinker.entity.id;
      this.inFlight.add(id);
      thinker.entity.thinking = true;

      void this.limit(() => this.runThought(trigger, thinker)).finally(() => {
        this.inFlight.delete(id);
        const t = this.getThinker(id);
        if (t) t.entity.thinking = false;
        this.pump();
      });
    }
  }

  private async runThought(trigger: Trigger, thinker: Thinker): Promise<void> {
    const { entity, subject, profile, memory } = thinker;
    try {
      let history = memory.history(entity.id);

      // Vieillir, c'est oublier : historique trop long → le chroniqueur le
      // condenses it into a single memory. That memory work costs HP.
      if (this.chronicler && history.length > CONTEXT_COMPACT_THRESHOLD_MSGS) {
        const { summary, usage } = await this.chronicler.chronicle(
          [{ name: subject.name, history }],
          "aging",
        );
        memory.replaceWithSummary(entity.id, summary);
        entity.hp -= hpCost(usage, "claude-haiku-4-5");
        history = memory.history(entity.id);
      }
      const result = await this.mind.think(subject, profile, history, trigger.eventText);

      const loss = hpCost(result.usage, profile.model);
      this.bucket.settle(THOUGHT_COST_FLOOR_HP, loss);

      // The creature may have died while its mind was thinking.
      const current = this.getThinker(entity.id);
      if (!current || current.entity.state === "dead") return;

      // Persists the exchange in the creature's history.
      memory.append(entity.id, "user", result.userTurn);
      memory.append(entity.id, "assistant", result.rawAssistantContent, result.usage);

      current.entity.hp -= loss;
      this.onDecision({ devotId: entity.id, decision: result.decision, hpLoss: loss });
    } catch (err) {
      this.onError(entity.id, err);
    }
  }
}

/**
 * A memory that lives and dies with the process. Monsters use it: they leave no
 * gravestone, so there is nothing to persist, and it keeps their histories out
 * of a `messages` table whose rows must belong to a devot.
 */
export class EphemeralMemory implements MemoryStore {
  private byId = new Map<string, StoredMessage[]>();

  constructor(private maxMessages = 20) {}

  history(id: string): StoredMessage[] {
    return this.byId.get(id) ?? [];
  }

  append(id: string, role: "user" | "assistant", content: unknown): void {
    const list = this.byId.get(id) ?? [];
    list.push({ role, content });
    // Trimmed rather than chronicled: a monster's past is not worth an
    // inference, and an unbounded list would leak for the life of the server.
    this.byId.set(id, list.slice(-this.maxMessages));
  }

  replaceWithSummary(id: string, summary: string): void {
    this.byId.set(id, [{ role: "user", content: summary }]);
  }

  forget(id: string): void {
    this.byId.delete(id);
  }
}
