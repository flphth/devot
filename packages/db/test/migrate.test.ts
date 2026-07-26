import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/client.js";
import { createRepos } from "../src/repos.js";

/**
 * Migrations are tested against a database that already exists, because that is
 * the only case where they do anything: `CREATE TABLE IF NOT EXISTS` is a no-op
 * on a file with a devots table, so a schema change made in the DDL alone
 * reaches every fresh database and no existing one. That gap has now broken a
 * running world twice — once for identity_json, once for balance.
 */

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "devot-db-"));
  path = join(dir, "world.sqlite");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A database as it stood at version 4: hp and hp_max, before the rename. */
function seedV4(): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE devots (
      id TEXT PRIMARY KEY,
      god_id TEXT NOT NULL,
      is_founder INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      hp REAL NOT NULL,
      hp_max REAL NOT NULL,
      cognition_profile TEXT NOT NULL,
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      z REAL NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'alive',
      current_goal_json TEXT,
      age INTEGER NOT NULL DEFAULT 0,
      traits_json TEXT NOT NULL DEFAULT '[]',
      identity_json TEXT NOT NULL DEFAULT '',
      wallet TEXT NOT NULL DEFAULT '',
      parent_a TEXT,
      parent_b TEXT,
      born_at INTEGER NOT NULL,
      died_at INTEGER,
      last_action_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare(
    `INSERT INTO devots (id, god_id, name, hp, hp_max, cognition_profile, born_at)
     VALUES ('devot-old', 'god-1', 'Adam', 41000, 60000, 'balanced', 1)`,
  ).run();
  db.pragma("user_version = 4");
  db.close();
}

function columns(table: string): string[] {
  const db = new Database(path);
  const names = (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map(
    (c) => c.name,
  );
  db.close();
  return names;
}

describe("an existing world survives the schema moving under it", () => {
  it("renames hp to balance, keeping what was in it", () => {
    seedV4();
    openDb(path);

    const cols = columns("devots");
    expect(cols).toContain("balance");
    expect(cols).toContain("capacity");
    expect(cols).not.toContain("hp");

    // The devot that was alive before the migration is still alive after, with
    // the life it had. A rename that dropped the value would be a silent
    // extinction.
    const db = new Database(path);
    const row = db.prepare(`SELECT balance, capacity FROM devots WHERE id = 'devot-old'`).get() as {
      balance: number;
      capacity: number;
    };
    db.close();
    expect(row.balance).toBe(41_000);
    expect(row.capacity).toBe(60_000);
  });

  it("runs twice without complaining", () => {
    seedV4();
    openDb(path);
    expect(() => openDb(path)).not.toThrow();
    expect(columns("devots")).toContain("balance");
  });

  it("leaves a fresh database alone", () => {
    // A new file already gets balance from the DDL; migration 5 must find
    // nothing to do rather than fail on a missing hp column.
    expect(() => openDb(path)).not.toThrow();
    expect(columns("devots")).toContain("balance");
  });
});

describe("a deposit can only be spent once, and stays spent", () => {
  const receipt = {
    txHash: "0xAABBCC",
    tokenId: 12n,
    god: "0x10ef82f6",
    deposit: 1_000_000_000_000_000n,
  };

  it("refuses the second claim on the same hash", () => {
    const repos = createRepos(openDb(path));
    expect(repos.mintReceipts.claim(receipt)).toBe(true);
    expect(repos.mintReceipts.claim(receipt)).toBe(false);
  });

  it("remembers across a restart", () => {
    // The whole point. An in-memory set forgot every deposit when the server
    // came back up, and the same payment minted a second devot for free.
    createRepos(openDb(path)).mintReceipts.claim(receipt);

    const afterRestart = createRepos(openDb(path)).mintReceipts;
    expect(afterRestart.spent(receipt.txHash)).toBe(true);
    expect(afterRestart.claim(receipt)).toBe(false);
  });

  it("ignores the case a wallet happens to use", () => {
    const repos = createRepos(openDb(path)).mintReceipts;
    repos.claim(receipt);
    expect(repos.spent("0xaabbcc")).toBe(true);
    expect(repos.claim({ ...receipt, txHash: "0xaabbcc" })).toBe(false);
  });

  it("keeps a uint256 exactly, rather than as a float", () => {
    const huge = { ...receipt, txHash: "0xdead", deposit: 123_456_789_012_345_678_901n };
    const repos = createRepos(openDb(path)).mintReceipts;
    repos.claim(huge);

    const db = new Database(path);
    const row = db.prepare(`SELECT deposit FROM mint_receipts WHERE tx_hash = '0xdead'`).get() as {
      deposit: string;
    };
    db.close();
    expect(BigInt(row.deposit)).toBe(huge.deposit);
  });

  it("does not consider an unseen hash spent", () => {
    expect(createRepos(openDb(path)).mintReceipts.spent("0xnever")).toBe(false);
  });
});
