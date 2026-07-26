import { describe, expect, it } from "vitest";
import { MockChronicler, MockMind, CognitionOrchestrator, PROFILES } from "@devot/agents";
import { createRepos, openDb } from "@devot/db";
import type { DevotEntity } from "@devot/shared";
import { CONTEXT_COMPACT_THRESHOLD_MSGS, devotSubject } from "@devot/shared";
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
    state: "alive",
    profile: "frugal",
    traits: ["curious"],
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "idle" },
    ...overrides,
  };
}

describe("births (server lifecycle)", () => {
  it("carries out an intent and gives the child inherited memories", async () => {
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

    // Inheritance: the child is born with a condensed memory of its parent.
    const childHistory = repos.messages.history(child.id);
    expect(childHistory).toHaveLength(1);
    expect(String(childHistory[0]!.content)).toContain("Memories inherited");

    // Lineage persisted: parent_a filled in.
    const row = repos.devots.get(child.id);
    expect(row?.parentA).toBe(parent.id);
  });

  it("records the failure with no birth if the parent is too weak", async () => {
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

describe("founder re-creation", () => {
  it("only possible once the whole lineage is dead", () => {
    const world = new World();
    expect(canRecreateFounder(world, "g1")).toBe(true);

    const devot = makeDevot();
    world.devots.set(devot.id, devot);
    expect(canRecreateFounder(world, "g1")).toBe(false);

    devot.state = "dead";
    expect(canRecreateFounder(world, "g1")).toBe(true);
    // Another god's lineage does not interfere.
    expect(canRecreateFounder(world, "g2")).toBe(true);
  });
});

describe("to age is to forget (compaction)", () => {
  it("the orchestrator condenses an over-long history before thinking", async () => {
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
      (id) => {
        const d = map.get(id);
        return d
          ? {
              entity: d,
              subject: devotSubject(d),
              profile: PROFILES[d.profile],
              memory: repos.messages,
            }
          : undefined;
      },
      () => applied++,
      () => {},
      new MockChronicler(),
    );

    orchestrator.enqueue({
      kind: "idle_reflection",
      creatureId: devot.id,
      eventText: "nothing",
      createdAt: Date.now(),
    });
    while (orchestrator.pendingCount > 0) await new Promise((r) => setTimeout(r, 10));

    expect(applied).toBe(1);
    // History: 1 condensed memory + the turn of the thought that just happened.
    const history = repos.messages.history(devot.id);
    expect(history.length).toBe(3);
    expect(String(history[0]!.content)).toContain("Condensed memories");
  });
});
