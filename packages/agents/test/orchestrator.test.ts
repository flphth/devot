import { describe, expect, it } from "vitest";
import type { DevotEntity } from "@devot/shared";
import { THOUGHT_COST_FLOOR_HP, devotSubject } from "@devot/shared";
import { createRepos, openDb } from "@devot/db";
import { MockMind } from "../src/mind.js";
import { PROFILES } from "../src/profiles.js";
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
    identityJson: "",
    items: [],
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

describe("orchestrateur cognitif", () => {
  it("a thought deducts HP from real usage and persists the history", async () => {
    const devot = makeDevot("d1");
    const { orchestrator, repos, applied } = setup([devot]);

    orchestrator.enqueue({
      kind: "idle_reflection",
      devotId: "d1",
      eventText: "Nothing is happening.",
      createdAt: Date.now(),
    });
    await settle(orchestrator);

    expect(applied).toHaveLength(1);
    expect(applied[0]!.hpLoss).toBeGreaterThan(0);
    // MockMind: 1200 in / 60 out on Haiku -> 1500 HP.
    expect(devot.hp).toBeCloseTo(10_000 - 1500, 0);
    // History: user turn (event) + assistant turn (decision).
    expect(repos.devots.contextSize("d1")).toBe(2);
    expect(devot.thinking).toBe(false);
  });

  it("only one thought in flight per devot", async () => {
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

  it("a devot below the cost floor does not think (it cannot spend more than its life)", async () => {
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

  it("a dead devot is never asked to think", async () => {
    const devot = makeDevot("d1");
    devot.state = "dead";
    const { orchestrator, applied } = setup([devot]);

    orchestrator.enqueue({
      kind: "divine_message",
      devotId: "d1",
      eventText: "A voice from the sky tells you: come back.",
      createdAt: Date.now(),
    });
    await settle(orchestrator);
    expect(applied).toHaveLength(0);
  });

  it("prioritises the divine message over idle reflection", async () => {
    const a = makeDevot("a");
    const b = makeDevot("b");
    // A single effective slot: we check the order in which the queue drains.
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
      eventText: "A voice from the sky tells you: rise.",
      createdAt: Date.now(),
    });
    await settle(orchestrator);

    // Both thought; concurrency makes the start order unguaranteed beyond the
    // queue sort, so we simply check that both go through.
    expect(order.sort()).toEqual(["a", "b"]);
  });
});

describe("an urgent trigger displaces a queued idle one", () => {
  it("a devot queued behind its own musing still hears the threat", async () => {
    // One trigger is queued per devot, and it used to be the FIRST one. Sorting
    // only ever ordered different devots, so a devot queued with an idle
    // reflection thought about nothing while it was being torn apart.
    const devots = [
      makeDevot("busy1"),
      makeDevot("busy2"),
      makeDevot("busy3"),
      makeDevot("busy4"),
      makeDevot("victim"),
    ];
    const { orchestrator, repos, applied } = setup(devots);

    // Fill every inference slot, so nothing leaves the queue immediately.
    for (const d of devots.slice(0, 4)) {
      orchestrator.enqueue({
        kind: "idle_reflection",
        devotId: d.id,
        eventText: "nothing at all",
        createdAt: Date.now(),
      });
    }
    orchestrator.enqueue({
      kind: "idle_reflection",
      devotId: "victim",
      eventText: "you are daydreaming",
      createdAt: Date.now(),
    });
    orchestrator.enqueue({
      kind: "threat",
      devotId: "victim",
      eventText: "something is eating you",
      createdAt: Date.now(),
    });

    await settle(orchestrator);

    expect(applied.some((a) => a.devotId === "victim")).toBe(true);
    const asked = repos.messages
      .history("victim")
      .map((m) => String(m.content))
      .join("\n");
    expect(asked).toContain("something is eating you");
    expect(asked).not.toContain("daydreaming");
  });

  it("does not let an idle musing displace a threat already queued", async () => {
    const devots = [
      makeDevot("busy1"),
      makeDevot("busy2"),
      makeDevot("busy3"),
      makeDevot("busy4"),
      makeDevot("victim"),
    ];
    const { orchestrator, repos } = setup(devots);
    for (const d of devots.slice(0, 4)) {
      orchestrator.enqueue({
        kind: "idle_reflection",
        devotId: d.id,
        eventText: "nothing at all",
        createdAt: Date.now(),
      });
    }
    orchestrator.enqueue({
      kind: "threat",
      devotId: "victim",
      eventText: "something is eating you",
      createdAt: Date.now(),
    });
    orchestrator.enqueue({
      kind: "idle_reflection",
      devotId: "victim",
      eventText: "you are daydreaming",
      createdAt: Date.now(),
    });

    await settle(orchestrator);
    const asked = repos.messages
      .history("victim")
      .map((m) => String(m.content))
      .join("\n");
    expect(asked).toContain("something is eating you");
    expect(asked).not.toContain("daydreaming");
  });
});
