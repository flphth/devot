import type { Chronicler } from "@devot/agents";
import type { Repos } from "@devot/db";
import type { DevotEntity } from "@devot/shared";
import { resolveReproduction, World, type Birth } from "@devot/sim";

/**
 * Consumes the reproduction intents recorded by the minds and carries out the
 * births: mechanics (sim) + context inheritance (chronicler) + persistence.
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

    // The child is born with memories: its parents' lives, condensed by the
    // chronicler into a coherent inheritance.
    try {
      const { summary } = await chronicler.chronicle(
        parents.map((p) => ({ name: p.name, history: repos.messages.history(p.id) })),
        "inheritance",
      );
      if (summary) {
        repos.messages.append(
          child.id,
          "user",
          `[Memories inherited from ${parents.map((p) => p.name).join(" and ")}] ${summary}`,
        );
      }
    } catch (err) {
      console.error(`[lifecycle] inheritance failed for ${child.id}:`, err);
    }

    births.push(outcome);
    onBirth?.(outcome);
  }

  return births;
}

/** A god may shape a new founder iff all their devots are dead. */
export function canRecreateFounder(world: World, godId: string): boolean {
  return ![...world.devots.values()].some(
    (d: DevotEntity) => d.godId === godId && d.state !== "dead",
  );
}
