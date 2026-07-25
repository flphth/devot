import type { Devot, JournalEntry } from "./devot.ts";

const µ = (n: number) => `${n.toLocaleString("en-US")} µ$`;

function teeLine(entry: JournalEntry): string {
  if (!entry.tee) return "TEE      : — (mind non vérifiable)";
  const mark = entry.tee.verified ? "✓ VÉRIFIÉ" : "✗ NON VÉRIFIÉ";
  return `TEE      : ${mark}  chatID=${entry.tee.chatId}  provider=${entry.tee.provider}`;
}

/** The "panneau Esprit": one thought with its cost and its TEE proof. */
export function renderThought(devot: Devot, entry: JournalEntry): string {
  const lines = [
    `┌─ Esprit de ${devot.id} — pensée #${entry.age} [${devot.state}] ${devot.model}`,
    `│ Événement: ${entry.event}`,
    `│ Pensée   : ${entry.raw.replace(/\s+/g, " ").slice(0, 200)}`,
    `│ Décision : ${entry.action}${entry.emotion ? `  (${entry.emotion})` : ""}${entry.utterance ? `  « ${entry.utterance} »` : ""}${entry.repaired ? "  [réparé]" : ""}${entry.coerced ? "  [réaction imposée — interdit d'attendre]" : ""}`,
    `│ Tokens   : ${entry.inputTokens} in / ${entry.outputTokens} out   →  coût ${µ(entry.cost)}`,
    `│ Solde    : ${µ(entry.balanceAfter)} / ${µ(devot.hpMax)}`,
    `│ ${teeLine(entry)}`,
    `└${"─".repeat(60)}`,
  ];
  return lines.join("\n");
}

export function renderSummary(devot: Devot): string {
  const thoughts = devot.journal.length;
  const spent = devot.hpMax - devot.balance;
  const verified = devot.journal.filter((e) => e.tee?.verified).length;
  return [
    "",
    `═══ Vie de ${devot.id} ═══`,
    `  pensées vécues : ${thoughts}`,
    `  dépensé        : ${µ(spent)} sur ${µ(devot.hpMax)}`,
    `  solde final    : ${µ(devot.balance)}  (${devot.state})`,
    `  pensées TEE-vérifiées : ${verified}/${thoughts}`,
  ].join("\n");
}
