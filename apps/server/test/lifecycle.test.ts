import { describe, expect, it } from "vitest";
import { MockChronicler, MockMind, CognitionOrchestrator } from "@devot/agents";
import { createRepos, openDb } from "@devot/db";
import type { DevotEntity } from "@devot/shared";
import { CONTEXT_COMPACT_THRESHOLD_MSGS } from "@devot/shared";
import { World } from "@devot/sim";
import { canRecreateFounder, processReproductions } from "../src/lifecycle.js";

let seq = 0;
function makeDevot(overrides: Partial<DevotEntity> = {}): DevotEntity {
  return {
    id: `d${++seq}`,
    godId: "g1",
    isFounder: false,
    name: `Devot${seq}`,
    pos: { x: 0, y: 0, z: 0 },
    hp: 20_000,
    hpMax: 50_000,
    state: "vivant",
    profile: "frugal",
    traits: ["curieux"],
    identityJson: "",
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "idle" },
    ...overrides,
  };
}

describe("naissances (lifecycle serveur)", () => {
  it("concrétise une intention et donne à l'enfant des souvenirs hérités", async () => {
    const db = openDb(":memory:");
    const repos = createRepos(db);
    const world = new World();
    const parent = makeDevot();
    world.devots.set(parent.id, parent);
    repos.devots.insertFromEntity(parent);
    repos.messages.append(parent.id, "user", "Tu as trouvé de la manne.");
    repos.messages.append(parent.id, "assistant", '{"action":"eat"}');

    parent.pendingReproduction = {};
    const births = await processReproductions(world, repos, new MockChronicler());

    expect(births).toHaveLength(1);
    const child = births[0]!.child;
    expect(world.devots.has(child.id)).toBe(true);
    expect(parent.pendingReproduction).toBeUndefined();

    // Héritage : l'enfant naît avec un souvenir condensé de son parent.
    const childHistory = repos.messages.history(child.id);
    expect(childHistory).toHaveLength(1);
    expect(String(childHistory[0]!.content)).toContain("Souvenirs hérités");

    // Lignée persistée : parent_a renseigné.
    const row = repos.devots.get(child.id);
    expect(row?.parentA).toBe(parent.id);
  });

  it("enregistre l'échec sans naissance si le parent est trop faible", async () => {
    const db = openDb(":memory:");
    const repos = createRepos(db);
    const world = new World();
    const parent = makeDevot({ hp: 100 });
    world.devots.set(parent.id, parent);
    repos.devots.insertFromEntity(parent);

    parent.pendingReproduction = {};
    const births = await processReproductions(world, repos, new MockChronicler());
    expect(births).toHaveLength(0);
    expect(world.devots.size).toBe(1);
  });
});

describe("recréation du fondateur", () => {
  it("possible seulement quand toute la lignée est morte", () => {
    const world = new World();
    expect(canRecreateFounder(world, "g1")).toBe(true);

    const devot = makeDevot();
    world.devots.set(devot.id, devot);
    expect(canRecreateFounder(world, "g1")).toBe(false);

    devot.state = "mort";
    expect(canRecreateFounder(world, "g1")).toBe(true);
    // La lignée d'un autre dieu n'interfère pas.
    expect(canRecreateFounder(world, "g2")).toBe(true);
  });
});

describe("vieillir, c'est oublier (compaction)", () => {
  it("l'orchestrateur condense un historique trop long avant de penser", async () => {
    const db = openDb(":memory:");
    const repos = createRepos(db);
    const devot = makeDevot();
    repos.devots.insertFromEntity(devot);
    const map = new Map([[devot.id, devot]]);

    for (let i = 0; i < CONTEXT_COMPACT_THRESHOLD_MSGS + 4; i++) {
      repos.messages.append(devot.id, i % 2 ? "assistant" : "user", `moment ${i}`);
    }

    let applied = 0;
    const orchestrator = new CognitionOrchestrator(
      new MockMind(),
      repos,
      (id) => map.get(id),
      () => applied++,
      () => {},
      new MockChronicler(),
    );

    orchestrator.enqueue({
      kind: "idle_reflection",
      devotId: devot.id,
      eventText: "rien",
      createdAt: Date.now(),
    });
    while (orchestrator.pendingCount > 0) await new Promise((r) => setTimeout(r, 10));

    expect(applied).toBe(1);
    // Historique : 1 souvenir condensé + le tour de la pensée qui vient d'avoir lieu.
    const history = repos.messages.history(devot.id);
    expect(history.length).toBe(3);
    expect(String(history[0]!.content)).toContain("Souvenirs condensés");
  });
});
