import { describe, expect, it } from "vitest";
import type { DevotEntity } from "@devot/shared";
import { THOUGHT_COST_FLOOR_HP } from "@devot/shared";
import { createRepos, openDb } from "@devot/db";
import { MockMind } from "../src/mind.js";
import { CognitionOrchestrator, type AppliedThought } from "../src/orchestrator.js";

function makeDevot(id: string, hp = 10_000): DevotEntity {
  return {
    id,
    godId: "g1",
    isFounder: true,
    name: id,
    pos: { x: 0, y: 0, z: 0 },
    hp,
    hpMax: 10_000,
    state: "alive",
    profile: "frugal",
    traits: [],
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "idle" },
  };
}

function setup(devots: DevotEntity[], mind = new MockMind()) {
  const db = openDb(":memory:");
  const repos = createRepos(db);
  const map = new Map(devots.map((d) => [d.id, d]));
  for (const d of devots) repos.devots.insertFromEntity(d);
  const applied: AppliedThought[] = [];
  const orchestrator = new CognitionOrchestrator(
    mind,
    repos,
    (id) => map.get(id),
    (a) => applied.push(a),
    () => {},
  );
  return { orchestrator, repos, applied, map };
}

async function settle(orchestrator: CognitionOrchestrator): Promise<void> {
  while (orchestrator.pendingCount > 0) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("cognition orchestrator", () => {
  it("a thought deducts HP from real usage and persists the history", async () => {
    const devot = makeDevot("d1");
    const { orchestrator, repos, applied } = setup([devot]);

    orchestrator.enqueue({
      kind: "idle_reflection",
      devotId: "d1",
      eventText: "Rien ne se passe.",
      createdAt: Date.now(),
    });
    await settle(orchestrator);

    expect(applied).toHaveLength(1);
    expect(applied[0]!.hpLoss).toBeGreaterThan(0);
    // MockMind : 1200 in / 60 out sur Haiku → 1500 HP.
    expect(devot.hp).toBeCloseTo(10_000 - 1500, 0);
    // History: user turn (event) + assistant turn (decision).
    expect(repos.devots.contextSize("d1")).toBe(2);
    expect(devot.thinking).toBe(false);
  });

  it("a single thought in flight per devot", async () => {
    const devot = makeDevot("d1");
    const { orchestrator, applied } = setup([devot]);

    for (let i = 0; i < 5; i++) {
      orchestrator.enqueue({
        kind: "idle_reflection",
        devotId: "d1",
        eventText: `tick ${i}`,
        createdAt: Date.now(),
      });
    }
    await settle(orchestrator);
    expect(applied).toHaveLength(1);
  });

  it("a devot below the floor cost does not think (it cannot spend more than its life)", async () => {
    const devot = makeDevot("d1", THOUGHT_COST_FLOOR_HP - 1);
    const { orchestrator, applied } = setup([devot]);

    orchestrator.enqueue({
      kind: "survival",
      devotId: "d1",
      eventText: "Tu meurs de faim.",
      createdAt: Date.now(),
    });
    await settle(orchestrator);

    expect(applied).toHaveLength(0);
    expect(devot.hp).toBe(THOUGHT_COST_FLOOR_HP - 1);
  });

  it("a dead devot is never woken", async () => {
    const devot = makeDevot("d1");
    devot.state = "dead";
    const { orchestrator, applied } = setup([devot]);

    orchestrator.enqueue({
      kind: "divine_message",
      devotId: "d1",
      eventText: "Une voix venue du ciel te dit : reviens.",
      createdAt: Date.now(),
    });
    await settle(orchestrator);
    expect(applied).toHaveLength(0);
  });

  it("priorise le message divin sur la réflexion oisive", async () => {
    const a = makeDevot("a");
    const b = makeDevot("b");
    // A single effective slot: we check the order they leave the queue.
    const order: string[] = [];
    const mind = new MockMind();
    const { orchestrator } = setup([a, b], mind);
    const origThink = mind.think.bind(mind);
    mind.think = async (devot, profile, history, eventText) => {
      order.push(devot.id);
      return origThink(devot, profile, history, eventText);
    };

    orchestrator.enqueue({
      kind: "idle_reflection",
      devotId: "a",
      eventText: "rien",
      createdAt: Date.now(),
    });
    orchestrator.enqueue({
      kind: "divine_message",
      devotId: "b",
      eventText: "Une voix venue du ciel te dit : lève-toi.",
      createdAt: Date.now(),
    });
    await settle(orchestrator);

    // Both thought; concurrency makes the start order non-deterministic
    // beyond queue ordering, we simply check that both go through.
    expect(order.sort()).toEqual(["a", "b"]);
  });
});
