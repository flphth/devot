import type { Decision, MicroUsd } from "@devot/shared";
import { hpCost, type MindMessage, type ThinkResult } from "@devot/agents";
import { type Residue, dropResidue, residueValue } from "@devot/sim";

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
  /** The god's connected wallet — the source of the deposit at creation. */
  wallet: string;
  model: string;
  /** Deposited life, in µ$ of inference (G2/G3 make this an on-chain balance). */
  balance: MicroUsd;
  /** Initial deposit; a reference point, not a hard ceiling once residue is eaten. */
  hpMax: MicroUsd;
  age: number;
  state: DevotState;
  history: MindMessage[];
  journal: JournalEntry[];
}

/**
 * Create a devot from a connected wallet and its deposit. The wallet is the
 * god's — in G3 this becomes `createDevot(identityHash) payable` and the deposit
 * is `msg.value`; here it is passed directly. A devot cannot exist without a
 * wallet and a deposit: no wallet connected, no life.
 */
export function createDevot(opts: {
  id: string;
  godId: string;
  wallet: string;
  model: string;
  deposit: MicroUsd;
}): Devot {
  if (!opts.wallet) throw new Error("createDevot: a connected wallet is required");
  if (opts.deposit <= 0) throw new Error("createDevot: deposit must be > 0");
  return {
    id: opts.id,
    godId: opts.godId,
    wallet: opts.wallet,
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

/**
 * Kill a devot and drop its remaining balance to the ground as a {@link Residue}.
 * The whole leftover changes hands — nothing is created or destroyed. A devot
 * that starved to 0 leaves no residue (null). Used when a monster (G4) or a
 * rival ends a devot that still held life.
 */
export function killDevot(devot: Devot, residueId: string): Residue | null {
  const leftover = devot.balance;
  devot.balance = 0;
  devot.state = "mort";
  return dropResidue(residueId, devot.id, leftover);
}

/**
 * A living devot picks up a residue on the ground and recharges from it. The
 * residue's whole value transfers to the devot's balance — closed economy, zero
 * creation. Returns the amount gained.
 */
export function consumeResidue(devot: Devot, residue: Residue): MicroUsd {
  if (devot.state === "mort") throw new Error("consumeResidue: a dead devot cannot eat");
  const gained = residueValue(residue);
  devot.balance += gained;
  devot.state = stateFor(devot.balance, devot.hpMax);
  return gained;
}
