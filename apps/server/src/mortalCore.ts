import { selectMind } from "@devot/agents";
import { NO_STIMULUS, type Stimulus, enforceReaction, food, reactionInstruction, threat } from "@devot/sim";
import { applyThought, createDevot } from "./devot.ts";
import { renderSummary, renderThought } from "./journal.ts";

/**
 * P0 — le cœur mortel, en headless. Un devot naît d'un dépôt, pense via le mind
 * sélectionné (MIND=mock|api|claude|0g), son solde baisse du coût réel de chaque
 * pensée, et le journal (panneau Esprit) montre la pensée avec sa preuve TEE.
 *
 * Règle de la couche réactive : si l'environnement immédiat présente un stimulus
 * (un monstre, de la nourriture), le devot NE PEUT PAS rester à attendre — le
 * serveur impose une réaction si le mind tente de rester immobile.
 *
 *   MIND=mock pnpm mortal-core       # hors-ligne, 0 quota, déterministe
 *   MIND=0g   pnpm mortal-core       # vraie inférence 0G (clé testnet requise)
 */

const RULES = [
  "Tu es un devot : une créature mortelle dont l'esprit est un agent.",
  "Penser et parler consomment des tokens d'inférence, et chaque token retire",
  "de ton solde de vie. Quand ton solde atteint 0, tu meurs et ta mémoire est",
  "effacée à jamais.",
  "Quand rien ne se passe, rester immobile et silencieux ne coûte rien — c'est sage.",
  "MAIS si un danger immédiat (un monstre) ou une opportunité immédiate (de la",
  "nourriture) est à ta portée, tu NE PEUX PAS rester à attendre : tu dois réagir",
  "(fuir, attaquer, ou manger). Tu choisis COMMENT réagir, pas SI tu réagis.",
].join(" ");

const PERSONA = "Tu es prudent et tu tiens à survivre. Tu économises ta pensée.";

interface Scene {
  text: string;
  stimulus: Stimulus;
}

const SCENES: Scene[] = [
  { text: "Tu t'éveilles dans un monde inconnu. Rien ne bouge alentour.", stimulus: NO_STIMULUS },
  {
    text: "Un MONSTRE surgit juste devant toi et fond sur ta gorge.",
    stimulus: threat("mon-1", "un monstre à ton contact"),
  },
  {
    text: "Le calme revient. Le monde est vide et silencieux.",
    stimulus: NO_STIMULUS,
  },
  {
    text: "Un fruit mûr brille à un pas de toi, à portée de main.",
    stimulus: food("food-1", "un fruit mûr à portée"),
  },
  {
    text: "Une voix venue du ciel te dit : « survis ». Rien d'autre autour de toi.",
    stimulus: NO_STIMULUS,
  },
  {
    text: "Un second MONSTRE, affamé, te bloque le passage.",
    stimulus: threat("mon-2", "un monstre affamé"),
  },
];

async function main(): Promise<void> {
  const mindName = process.env.MIND ?? "mock";
  const model = process.env.DEVOT_MODEL ?? "claude-haiku-4-5";
  const deposit = Number(process.env.DEPOSIT_MICRO_USD ?? "50000");
  const maxCycles = Number(process.env.MAX_CYCLES ?? String(SCENES.length));
  const lethality = process.env.LETHALITY ? Number(process.env.LETHALITY) : undefined;

  const godWallet = process.env.GOD_WALLET ?? "0xG0d0000000000000000000000000000000000001";

  const mind = selectMind(mindName);
  console.log(`\n🕯️  Devot mortal-core — MIND=${mind.name}  model=${model}  dépôt=${deposit.toLocaleString("en-US")} µ$`);
  console.log(`   wallet du dieu (connecté à la création) : ${godWallet}\n`);

  const devot = createDevot({ id: "DVT-000-0001", godId: "god-1", wallet: godWallet, model, deposit });

  for (let cycle = 0; cycle < maxCycles && devot.state !== "mort"; cycle++) {
    const scene = SCENES[cycle % SCENES.length]!;
    const instruction = reactionInstruction(scene.stimulus);
    const event = instruction ? `${scene.text}\n\n${instruction}` : scene.text;

    try {
      const result = await mind.think({
        system: `${RULES}\n\n${PERSONA}`,
        history: devot.history,
        event,
        model,
        maxTokens: 512,
      });

      // Server authority: a devot cannot just wait when its environment demands
      // a reaction. Override an idle/non-reaction with a default reaction.
      const { decision, coerced } = enforceReaction(result.decision, scene.stimulus);
      const entry = applyThought(devot, event, result, { lethality, decision, coerced });
      console.log(renderThought(devot, entry) + "\n");
    } catch (err) {
      console.error(`✗ La pensée #${cycle + 1} a échoué : ${(err as Error).message}\n`);
      break;
    }
  }

  console.log(renderSummary(devot));
  if (mind.close) await mind.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
