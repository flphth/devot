import { describe, expect, it } from "vitest";
import type { DevotEntity } from "@devot/shared";
import { DEFAULT_IDENTITY } from "@devot/shared";
import { createRepos, openDb } from "../src/index.js";

function makeDevot(id: string): DevotEntity {
  return {
    id,
    godId: "god-1",
    isFounder: true,
    name: "Test",
    pos: { x: 0, y: 0, z: 0 },
    hp: 1000,
    hpMax: 1000,
    state: "alive",
    profile: "frugal",
    traits: [],
    identity: DEFAULT_IDENTITY,
    age: 0,
    thinking: false,
    utterance: "",
    currentGoal: { kind: "idle" },
  };
}

describe("death = destruction of the context", () => {
  it("deletes all the devot's messages but keeps the gravestone", () => {
    const db = openDb(":memory:");
    const repos = createRepos(db);
    const devot = makeDevot("devot-1");
    repos.devots.insertFromEntity(devot);

    repos.messages.append("devot-1", "user", "Une voix venue du ciel te dit : vis.");
    repos.messages.append("devot-1", "assistant", [{ type: "text", text: '{"action":"idle"}' }]);
    expect(repos.devots.contextSize("devot-1")).toBe(2);

    repos.devots.kill("devot-1", "vital exhaustion");

    // Context erased, for good.
    expect(repos.devots.contextSize("devot-1")).toBe(0);
    expect(repos.messages.history("devot-1")).toEqual([]);

    // Gravestone: the devot row survives, marked dead.
    const row = repos.devots.get("devot-1");
    expect(row?.state).toBe("dead");
    expect(row?.diedAt).toBeTruthy();
    expect(row?.hp).toBe(0);
  });

  it("does not touch the context of other devots", () => {
    const db = openDb(":memory:");
    const repos = createRepos(db);
    repos.devots.insertFromEntity(makeDevot("devot-a"));
    repos.devots.insertFromEntity(makeDevot("devot-b"));
    repos.messages.append("devot-a", "user", "événement a");
    repos.messages.append("devot-b", "user", "événement b");

    repos.devots.kill("devot-a", "test");

    expect(repos.devots.contextSize("devot-a")).toBe(0);
    expect(repos.devots.contextSize("devot-b")).toBe(1);
  });

  it("the history persists and reads back in order", () => {
    const db = openDb(":memory:");
    const repos = createRepos(db);
    repos.devots.insertFromEntity(makeDevot("devot-1"));
    repos.messages.append("devot-1", "user", "premier");
    repos.messages.append("devot-1", "assistant", "deuxième");

    const history = repos.messages.history("devot-1");
    expect(history).toEqual([
      { role: "user", content: "premier" },
      { role: "assistant", content: "deuxième" },
    ]);
  });
});
