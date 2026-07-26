import pLimit from "p-limit";
import type { Decision, DevotEntity, Trigger } from "@devot/shared";
import {
  CONTEXT_COMPACT_THRESHOLD_MSGS,
  GLOBAL_BUDGET_UHP_PER_MIN,
  MAX_CONCURRENT_INFERENCES,
  THOUGHT_COST_FLOOR_HP,
  TRIGGER_PRIORITY,
} from "@devot/shared";
import type { Repos } from "@devot/db";
import type { Chronicler } from "./chronicler.js";
import { hpCost } from "./hpCost.js";
import type { MindProvider } from "./mind.js";
import { PROFILES } from "./profiles.js";

export interface AppliedThought {
  devotId: string;
  decision: Decision;
  hpLoss: number;
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
    private repos: Repos,
    private getDevot: (id: string) => DevotEntity | undefined,
    private onDecision: (applied: AppliedThought) => void,
    private onError: (devotId: string, err: unknown) => void = (id, err) =>
      console.error(`[orchestrator] thought failed for ${id}:`, err),
    /** Optionnel : active le vieillissement (compaction de l'historique). */
    private chronicler?: Chronicler,
  ) {}

  /** Drops off a trigger; the mind will be engaged in the background. */
  enqueue(trigger: Trigger): void {
    const devot = this.getDevot(trigger.devotId);
    if (!devot || devot.state === "dead") return;
    // A devot already thinking is not woken again: its thought is in flight.
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
      const devot = this.getDevot(trigger.devotId);
      if (!devot || devot.state === "dead") continue;

      // Budget pre-check: a devot too poor to think abstains.
      if (devot.hp <= THOUGHT_COST_FLOOR_HP) continue;
      if (!this.bucket.tryConsume(THOUGHT_COST_FLOOR_HP)) {
        // Under budget pressure: the non-priority ones fall asleep.
        // The body carries on; the mind waits for the next window.
        this.queue.unshift(trigger);
        return;
      }

      this.inFlight.add(devot.id);
      devot.thinking = true;

      void this.limit(() => this.runThought(trigger, devot)).finally(() => {
        this.inFlight.delete(devot.id);
        const d = this.getDevot(devot.id);
        if (d) d.thinking = false;
        this.pump();
      });
    }
  }

  private async runThought(trigger: Trigger, devot: DevotEntity): Promise<void> {
    const profile = PROFILES[devot.profile];
    try {
      let history = this.repos.messages.history(devot.id);

      // Vieillir, c'est oublier : historique trop long → le chroniqueur le
      // condenses it into a single memory. That memory work costs HP.
      if (this.chronicler && history.length > CONTEXT_COMPACT_THRESHOLD_MSGS) {
        const { summary, usage } = await this.chronicler.chronicle(
          [{ name: devot.name, history }],
          "aging",
        );
        this.repos.messages.replaceWithSummary(devot.id, summary);
        devot.hp -= hpCost(usage, "claude-haiku-4-5");
        history = this.repos.messages.history(devot.id);
      }
      const result = await this.mind.think(devot, profile, history, trigger.eventText);

      const loss = hpCost(result.usage, profile.model);
      this.bucket.settle(THOUGHT_COST_FLOOR_HP, loss);

      // The devot may have died while the mind was thinking.
      const current = this.getDevot(devot.id);
      if (!current || current.state === "dead") return;

      // Persists the exchange in the devot's history.
      this.repos.messages.append(devot.id, "user", result.userTurn);
      this.repos.messages.append(
        devot.id,
        "assistant",
        result.rawAssistantContent,
        result.usage,
      );

      current.hp -= loss;
      this.onDecision({ devotId: devot.id, decision: result.decision, hpLoss: loss });
    } catch (err) {
      this.onError(devot.id, err);
    }
  }
}
