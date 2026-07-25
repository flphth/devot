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

/** Token bucket : plafonne la dépense globale d'inférence (µ$/min). */
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

  /** Ajuste avec le coût réel une fois l'inférence terminée. */
  settle(estimate: number, actual: number): void {
    this.spent += actual - estimate;
  }
}

/**
 * File d'inférences priorisée, découplée du tick :
 * - concurrence bornée (p-limit)
 * - une seule pensée en vol par devot
 * - priorité : divin > menace > survie > rencontre > oisif
 * - pré-check hp > coût plancher + token bucket global
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
      console.error(`[orchestrator] pensée échouée pour ${id}:`, err),
    /** Optionnel : active le vieillissement (compaction de l'historique). */
    private chronicler?: Chronicler,
  ) {}

  /** Dépose un déclencheur ; l'esprit sera sollicité en tâche de fond. */
  enqueue(trigger: Trigger): void {
    const devot = this.getDevot(trigger.devotId);
    if (!devot || devot.state === "mort") return;
    // Un devot déjà en train de penser, ou déjà en file, n'est pas relancé.
    if (this.inFlight.has(trigger.devotId)) return;
    if (this.queue.some((t) => t.devotId === trigger.devotId)) return;
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
      if (!devot || devot.state === "mort") continue;

      // Pré-check budget : un devot trop pauvre pour penser s'abstient.
      if (devot.hp <= THOUGHT_COST_FLOOR_HP) continue;
      if (!this.bucket.tryConsume(THOUGHT_COST_FLOOR_HP)) {
        // Sous pression budgétaire : les non-prioritaires s'endorment.
        // Le corps continue ; l'esprit patiente jusqu'à la fenêtre suivante.
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
      // condense en un souvenir unique. Ce travail de mémoire coûte des HP.
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

      // Le devot peut être mort pendant que l'esprit pensait.
      const current = this.getDevot(devot.id);
      if (!current || current.state === "mort") return;

      // Persiste l'échange dans l'historique du devot.
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
