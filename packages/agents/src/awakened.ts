import { query } from "@anthropic-ai/claude-agent-sdk";
import type { InferenceUsage } from "@devot/shared";

/**
 * L'ÉVEIL (P5.5).
 *
 * Un organisme éveillé pense avec Claude. Ce n'est pas un pilotage : son
 * cerveau de neurones continue de tourner et de décider. La pensée arrive
 * PAR-DESSUS — elle donne une intention pour les prochains ticks, et elle
 * coûte de l'énergie en proportion des tokens réellement consommés.
 *
 * C'est la transposition exacte du principe du Devot d'origine : penser coûte
 * la vie. Ici l'unité n'est plus le point de vie mais l'énergie du voxel, et
 * elle sort du même budget que marcher ou digérer.
 *
 * Seul le SERVEUR détient les identifiants : un client ne peut pas déclencher
 * une pensée pour son compte, il peut seulement parler à un éveillé.
 */

export interface AwakenedPerception {
  organismId: number;
  /** Nom donné par son dieu, s'il en a un. */
  name: string;
  tick: number;
  age: number;
  energy: number;
  capacity: number;
  bodyVoxels: number;
  neurons: number;
  mouths: number;
  eyes: number;
  muscles: number;
  generation: number;
  eaten: number;
  bites: number;
  bitten: number;
  /** Ce qu'il perçoit autour de lui, en clair. */
  surroundings: string;
  /** Le dernier mot d'un dieu, s'il y en a un. */
  divineWord?: string;
}

export type AwakenedIntent = "chercher" | "manger" | "fuir" | "mordre" | "se reproduire" | "attendre";

export interface AwakenedThought {
  /** Ce qu'il se dit. Court : c'est un monologue, pas un essai. */
  monologue: string;
  intent: AwakenedIntent;
  usage: InferenceUsage;
}

export interface AwakenedMind {
  think(p: AwakenedPerception): Promise<AwakenedThought>;
}

const AWAKENED_SCHEMA = {
  type: "object",
  properties: {
    monologue: { type: "string", maxLength: 220 },
    intent: {
      type: "string",
      enum: ["chercher", "manger", "fuir", "mordre", "se reproduire", "attendre"],
    },
  },
  required: ["monologue", "intent"],
  additionalProperties: false,
} as const;

const SYSTEM = `Tu es un organisme éveillé dans un monde de voxels.

Ce monde est brutal et littéral : ton corps est fait de voxels (os, muscle,
réserve, bouche, œil, neurone), et chacun te coûte de l'énergie à chaque
instant. Manger de la biomasse t'en rend. À zéro, tu meurs et ton corps devient
de la nourriture pour les autres.

PENSER TE COÛTE. Chaque mot que tu produis se paie en énergie, prélevée sur la
même réserve que marcher ou digérer. Ne dis donc que ce qui compte.

Tu n'es pas un assistant, tu ne rends service à personne. Tu es un être vivant
qui essaie de durer. Parle à la première personne, brièvement, sans politesse.`;

/** Environnement purgé des clés : en abonnement, une clé résiduelle casse OAuth. */
function subscriptionEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
  };
}

function buildPrompt(p: AwakenedPerception): string {
  const lines = [
    `Tu es ${p.name || `l'organisme #${p.organismId}`}, génération ${p.generation}.`,
    `Tick ${p.tick}, tu vis depuis ${p.age} ticks.`,
    `Énergie : ${p.energy} sur ${p.capacity}.`,
    `Ton corps : ${p.bodyVoxels} voxels — ${p.mouths} bouche(s), ${p.eyes} œil/yeux, ` +
      `${p.muscles} muscle(s), ${p.neurons} neurone(s).`,
    `Tu as ingéré ${p.eaten} d'énergie, mordu ${p.bites} fois, été mordu ${p.bitten} fois.`,
    ``,
    `Autour de toi : ${p.surroundings}`,
  ];
  if (p.divineWord) {
    lines.push(``, `Une voix venue d'en haut te dit : « ${p.divineWord} »`);
  }
  lines.push(
    ``,
    `Dis-toi une phrase, et choisis une intention pour la suite.`,
  );
  return lines.join("\n");
}

/**
 * Esprit réel : Agent SDK sur l'ABONNEMENT Claude Code. Jamais de clé API
 * facturée au token — c'est une contrainte du projet, pas une préférence.
 */
export class ClaudeAwakenedMind implements AwakenedMind {
  constructor(private model?: string) {}

  async think(p: AwakenedPerception): Promise<AwakenedThought> {
    const q = query({
      prompt: buildPrompt(p),
      options: {
        systemPrompt: SYSTEM,
        model: this.model ?? "claude-sonnet-4-6",
        maxTurns: 1,
        allowedTools: [],
        env: subscriptionEnv(),
        outputFormat: {
          type: "json_schema",
          schema: AWAKENED_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });

    for await (const message of q) {
      if (message.type !== "result") continue;
      if (message.subtype !== "success") {
        throw new Error(`éveil : pensée échouée (${message.subtype})`);
      }
      const raw = (message.structured_output ?? JSON.parse(message.result)) as {
        monologue?: unknown;
        intent?: unknown;
      };
      return {
        monologue: String(raw.monologue ?? "").slice(0, 220),
        intent: normalizeIntent(raw.intent),
        usage: toUsage(message.usage),
      };
    }
    throw new Error("éveil : aucun résultat");
  }
}

/** Esprit factice : le mode de développement, sans réseau ni quota. */
export class MockAwakenedMind implements AwakenedMind {
  private n = 0;

  async think(p: AwakenedPerception): Promise<AwakenedThought> {
    const intents: AwakenedIntent[] = ["chercher", "manger", "fuir", "mordre", "attendre"];
    const intent = intents[this.n++ % intents.length]!;
    const ratio = p.capacity > 0 ? Math.round((p.energy * 100) / p.capacity) : 0;
    return {
      monologue:
        ratio < 30
          ? `J'ai faim. ${p.eaten > 0 ? "J'ai déjà mangé, je peux recommencer." : "Je n'ai jamais mangé."}`
          : `Je tiens. ${p.bitten > 0 ? "Quelque chose m'a mordu." : "Rien ne m'a touché."}`,
      intent,
      usage: {
        inputTokens: 120,
        outputTokens: 40,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    };
  }
}

function normalizeIntent(v: unknown): AwakenedIntent {
  const s = String(v ?? "").toLowerCase();
  const known: AwakenedIntent[] = [
    "chercher",
    "manger",
    "fuir",
    "mordre",
    "se reproduire",
    "attendre",
  ];
  return known.find((k) => s.includes(k)) ?? "attendre";
}

function toUsage(u: unknown): InferenceUsage {
  const usage = (u ?? {}) as Record<string, number | undefined>;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Choisit l'esprit selon MIND, exactement comme pour les devots du jeu LLM :
 * `claude` (abonnement), `mock` (développement). `api` est refusé ici — le
 * projet n'admet aucune facturation au token.
 */
export function createAwakenedMind(env: NodeJS.ProcessEnv = process.env): {
  kind: "claude" | "mock";
  mind: AwakenedMind;
} {
  const wanted = (env.MIND ?? "mock").toLowerCase();
  if (wanted === "claude") {
    if (env.ANTHROPIC_API_KEY) {
      console.warn(
        "[éveil] MIND=claude : ANTHROPIC_API_KEY détectée mais ignorée — " +
          "les éveillés pensent sur l'abonnement Claude Code.",
      );
    }
    return { kind: "claude", mind: new ClaudeAwakenedMind(env.DEVOT_MODEL) };
  }
  if (wanted === "api") {
    console.warn(
      "[éveil] MIND=api n'est pas accepté pour l'éveil : le projet interdit la " +
        "facturation au token. Repli sur mock.",
    );
  }
  return { kind: "mock", mind: new MockAwakenedMind() };
}

/**
 * Coût énergétique d'une pensée. Le prix d'un token en dollars n'a pas de sens
 * ici : ce qui compte est qu'une pensée pèse dans la même monnaie que marcher
 * ou digérer. On facture donc l'usage RÉEL, converti en énergie.
 *
 * Mesuré sur une pensée réelle (MIND=claude, abonnement) : 3 tokens en entrée,
 * 503 en sortie — le modèle réfléchit bien plus qu'il n'écrit — soit environ
 * 6 000 d'énergie. Sur une capacité de 60 000, c'est un dixième de sa vie par
 * pensée, et un éveillé pense toutes les 40 ticks.
 *
 * Ce n'est pas un réglage timide : ÊTRE ÉVEILLÉ TUE. Un organisme conscient
 * doit manger beaucoup plus que ses congénères pour simplement durer. C'est la
 * transposition littérale du principe fondateur du projet — penser coûte la
 * vie — et c'est ce qui justifie qu'il y ait peu d'éveillés.
 */
export const ENERGY_PER_INPUT_TOKEN = 1;
export const ENERGY_PER_OUTPUT_TOKEN = 12;

export function thoughtEnergyCost(usage: InferenceUsage): number {
  return (
    usage.inputTokens * ENERGY_PER_INPUT_TOKEN +
    usage.cacheReadInputTokens * ENERGY_PER_INPUT_TOKEN * 0.1 +
    usage.outputTokens * ENERGY_PER_OUTPUT_TOKEN
  ) | 0;
}
