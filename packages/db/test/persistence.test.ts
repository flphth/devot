import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/client.js";
import { createRepos } from "../src/repos.js";

/**
 * A world that is not written down is a world that ends when the tab closes.
 * Devot rows had been accumulating since the first release and nothing ever
 * read one back.
 */

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "devot-persist-"));
  path = join(dir, "world.sqlite");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the world survives being closed", () => {
  it("gives back the relics it was given, funds and all", () => {
    // A relic holds a devot's whole birth deposit. Losing the ground on a
    // restart would destroy real value, silently.
    const repos = createRepos(openDb(path));
    repos.world.saveFood([
      { id: "legacy-1", x: 3, y: 0.5, z: -2, type: "legacy", worth: 0,
        source: "spawn", spawnedAt: 1000, ttlMs: 180_000, funds: 60_000, leftBy: "Adam" },
      { id: "f-2", x: 1, y: 0, z: 1, type: "grain", worth: 2000,
        source: "spawn", spawnedAt: 1000, ttlMs: 60_000, funds: 0, leftBy: "" },
    ]);

    const back = createRepos(openDb(path)).world.loadFood();
    const relic = back.find((f) => f.id === "legacy-1");
    expect(back).toHaveLength(2);
    expect(relic?.funds).toBe(60_000);
    expect(relic?.leftBy).toBe("Adam");
  });

  it("gives back a monster with its hoard", () => {
    const repos = createRepos(openDb(path));
    repos.world.saveMonsters([
      { id: "m1", name: "Beast-1", x: 4, y: 1, z: 5, balance: 41_000,
        capacity: 60_000, hoard: 138_000, state: "alive", age: 900,
        targetId: "d1", lastThoughtAt: 1234 },
    ]);

    const [m] = createRepos(openDb(path)).world.loadMonsters();
    expect(m?.hoard).toBe(138_000);
    expect(m?.targetId).toBe("d1");
  });

  it("replaces the ground rather than piling it up", () => {
    // Saving is a full overwrite. Diffing would leave a devot that vanished
    // from the world alive in the table, and it would walk back in on reboot.
    const repos = createRepos(openDb(path));
    const one = { id: "a", x: 0, y: 0, z: 0, type: "grain", worth: 1, source: "spawn",
      spawnedAt: 0, ttlMs: 1, funds: 0, leftBy: "" };
    repos.world.saveFood([one, { ...one, id: "b" }]);
    repos.world.saveFood([{ ...one, id: "c" }]);

    const back = repos.world.loadFood();
    expect(back.map((f) => f.id)).toEqual(["c"]);
  });

  it("remembers the world clock and its lineages", () => {
    const repos = createRepos(openDb(path));
    repos.world.put("worldMs", 987_654);
    repos.world.put("lineageStart", [["god-a", 42]]);

    const back = createRepos(openDb(path)).world;
    expect(back.get<number>("worldMs")).toBe(987_654);
    expect(back.get("lineageStart")).toEqual([["god-a", 42]]);
    expect(back.get("never-written")).toBeUndefined();
  });

  it("overwrites a key instead of failing on it", () => {
    const repos = createRepos(openDb(path)).world;
    repos.put("worldMs", 1);
    repos.put("worldMs", 2);
    expect(repos.get<number>("worldMs")).toBe(2);
  });

  it("hands back the living and leaves the gravestones alone", () => {
    const db = openDb(path);
    const repos = createRepos(db);
    const raw = new Database(path);
    const insert = raw.prepare(
      `INSERT INTO devots (id, god_id, name, balance, capacity, born_with, generation,
        items_json, cognition_profile, state, born_at, died_at, last_action_at, traits_json)
       VALUES (?, 'g1', ?, 100, 100, 100, 1, '["spear"]', 'balanced', ?, 1, ?, ?, '[]')`,
    );
    const now = Date.now();
    insert.run("alive-1", "Adam", "alive", null, now);
    insert.run("dead-1", "Eve", "dead", now, now);
    insert.run("buried", "Cain", "alive", now, now); // died_at set: still a corpse
    raw.close();

    const living = repos.world.livingDevots();
    expect(living.map((d) => d.id)).toEqual(["alive-1"]);
    expect(living[0]!.itemsJson).toBe('["spear"]');
  });
});

describe("the ghosts of worlds that ended", () => {
  it("retires devots nothing has touched in a long time", () => {
    // Rows written by sessions whose room was disposed. Restoring them would
    // resurrect fifty creatures at once, each thinking every ten seconds.
    const first = new Database(path);
    first.exec(`
      CREATE TABLE devots (
        id TEXT PRIMARY KEY, god_id TEXT NOT NULL, is_founder INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL, balance REAL NOT NULL, capacity REAL NOT NULL,
        cognition_profile TEXT NOT NULL, x REAL DEFAULT 0, y REAL DEFAULT 0, z REAL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'alive', current_goal_json TEXT, age INTEGER DEFAULT 0,
        traits_json TEXT NOT NULL DEFAULT '[]', identity_json TEXT NOT NULL DEFAULT '',
        wallet TEXT NOT NULL DEFAULT '', parent_a TEXT, parent_b TEXT,
        born_at INTEGER NOT NULL, died_at INTEGER, last_action_at INTEGER NOT NULL DEFAULT 0
      );`);
    const ins = first.prepare(
      `INSERT INTO devots (id, god_id, name, balance, capacity, cognition_profile, born_at, last_action_at)
       VALUES (?, 'g1', ?, 100, 100, 'balanced', 1, ?)`,
    );
    ins.run("ghost", "Old", Date.now() - 3 * 60 * 60_000); // three hours ago
    ins.run("current", "Now", Date.now()); // this session
    // Version 5: the table above is the shape it had then. Claiming a later
    // version would skip the migrations that add born_with and items_json, and
    // the failure would look like a product bug rather than a bad fixture.
    first.pragma("user_version = 5");
    first.close();

    const living = createRepos(openDb(path)).world.livingDevots();
    expect(living.map((d) => d.id)).toEqual(["current"]);
  });
});
