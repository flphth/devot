import type { Chronicler } from "@devot/agents";
import type { Repos } from "@devot/db";
import type { DevotEntity } from "@devot/shared";
import { resolveReproduction, World, type Birth } from "@devot/sim";

/**
 * Consomme les intentions de reproduction posées par les esprits et
 * concrétise les naissances : mécanique (sim) + héritage de contexte
 * (chroniqueur) + persistance.
 */
export async function processReproductions(
  world: World,
  repos: Repos,
  chronicler: Chronicler,
  onBirth?: (birth: Birth) => void,
): Promise<Birth[]> {
  const births: Birth[] = [];

  for (const devot of world.aliveDevots()) {
    if (!devot.pendingReproduction) continue;
    const { partnerId } = devot.pendingReproduction;
    devot.pendingReproduction = undefined;

    const outcome = resolveReproduction(world, devot, partnerId);
    if ("reason" in outcome) {
      repos.events.record("repro_failed", [devot.id], { reason: outcome.reason });
      continue;
    }

    const { child, parents, mode } = outcome;
    world.devots.set(child.id, child);
    repos.devots.insertFromEntity(child, {
      a: parents[0]?.id,
      b: parents[1]?.id,
    });
    repos.events.record("birth", [child.id, ...parents.map((p) => p.id)], {
      mode,
      godId: child.godId,
      traits: child.traits,
    });

    // L'enfant naît avec des souvenirs : les vies de ses parents,
    // condensées par le chroniqueur en un héritage cohérent.
    try {
      const { summary } = await chronicler.chronicle(
        parents.map((p) => ({ name: p.name, history: repos.messages.history(p.id) })),
        "inheritance",
      );
      if (summary) {
        repos.messages.append(
          child.id,
          "user",
          `[Souvenirs hérités de ${parents.map((p) => p.name).join(" et ")}] ${summary}`,
        );
      }
    } catch (err) {
      console.error(`[lifecycle] héritage échoué pour ${child.id}:`, err);
    }

    births.push(outcome);
    onBirth?.(outcome);
  }

  return births;
}

/** Un dieu peut refaçonner un fondateur ssi tous ses devots sont morts. */
export function canRecreateFounder(world: World, godId: string): boolean {
  return ![...world.devots.values()].some(
    (d: DevotEntity) => d.godId === godId && d.state !== "mort",
  );
}
