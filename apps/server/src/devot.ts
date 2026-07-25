import type { Decision, MicroUsd } from "@devot/shared";
import { hpCost, type MindMessage, type ThinkResult } from "@devot/agents";

export type DevotState = "vivant" | "affame" | "agonisant" | "mort";

/** One line of the devot's inner life — what the Esprit panel renders. */
export interface JournalEntry {
  age: number;
  event: string;
  raw: string;
  action: string;
  emotion?: string;
  utterance?: string;
  inputTokens: number;
  outputTokens: number;
  cost: MicroUsd;
  balanceAfter: MicroUsd;
  repaired: boolean;
  /** True when the devot tried to wait but the server forced a reaction. */
  coerced: boolean;
  /** TEE attestation, present only for the 0G mind. */
  tee?: { verified: boolean; chatId: string; provider: string };
}

export interface Devot {
  id: string;
  godId: string;
  model: string;
  /** Deposited life, in µ$ of inference (G2/G3 make this an on-chain balance). */
  balance: MicroUsd;
  hpMax: MicroUsd;
  age: number;
  state: DevotState;
  history: MindMessage[];
  journal: JournalEntry[];
}

export function createDevot(opts: { id: string; godId: string; model: string; deposit: MicroUsd }): Devot {
  return {
    id: opts.id,
    godId: opts.godId,
    model: opts.model,
    balance: opts.deposit,
    hpMax: opts.deposit,
    age: 0,
    state: "vivant",
    history: [],
    journal: [],
  };
}

function stateFor(balance: MicroUsd, hpMax: MicroUsd): DevotState {
  if (balance <= 0) return "mort";
  const frac = balance / hpMax;
  if (frac < 0.1) return "agonisant";
  if (frac < 0.3) return "affame";
  return "vivant";
}

/**
 * Apply one thought: burn the real cost from the balance, append the thought to
 * history and the Esprit journal, advance state. The balance drop is the whole
 * point of G1 — it is `hpCost(usage, price)` with the price the mind quoted.
 */
export function applyThought(
  devot: Devot,
  event: string,
  result: ThinkResult,
  options?: {
    lethality?: number;
    /** The decision actually applied (after the server's reaction rule). */
    decision?: Decision;
    coerced?: boolean;
  },
): JournalEntry {
  const cost = hpCost(result.usage, result.price, options?.lethality);
  // Thinking costs life whether or not the server had to override the choice.
  devot.balance = Math.max(0, devot.balance - cost);
  devot.age += 1;
  devot.state = stateFor(devot.balance, devot.hpMax);

  const decision = options?.decision ?? result.decision;
  devot.history.push({ role: "user", content: event });
  devot.history.push({ role: "assistant", content: result.raw });

  const entry: JournalEntry = {
    age: devot.age,
    event,
    raw: result.raw,
    action: decision.action,
    emotion: decision.emotion,
    utterance: decision.utterance,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    cost,
    balanceAfter: devot.balance,
    repaired: result.repaired,
    coerced: options?.coerced ?? false,
    tee: result.tee,
  };
  devot.journal.push(entry);
  return entry;
}
