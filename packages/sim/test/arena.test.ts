import { describe, expect, it } from "vitest";
import { Arena } from "../src/arena.ts";

const joined = (a: Arena) => a.events.map((e) => e.text).join("\n");

describe("Arena — an autonomous predator/prey game", () => {
  it("a monster kills, grows, is slain and its treasure returns to a devot (invariant holds throughout)", () => {
    const a = new Arena({ monsterMetabolism: 250, devotThinkCost: 100, bountyThreshold: 1000 });
    a.addDevot("prey-1", 700);
    a.addDevot("prey-2", 1000);
    a.addDevot("hero", 8000, { hunter: true });
    a.addMonster("mon-1");

    // Act 1: the monster fattens on prey, then the hero cashes the bounty.
    for (let i = 0; i < 3; i++) {
      a.tick();
      expect(a.vault.checkInvariant()).toBe(true);
    }

    // Act 2: a fresh monster feeds, then starves and drops its hoard for the living.
    a.addMonster("mon-2");
    a.addDevot("prey-3", 600);
    for (let i = 0; i < 3; i++) {
      a.tick();
      expect(a.vault.checkInvariant()).toBe(true);
    }

    const log = joined(a);
    // monster killed prey and grew
    expect(log).toContain("le monstre mon-1 tue prey-1");
    expect(log).toContain("le monstre mon-1 tue prey-2");
    expect(log).toMatch(/il grossit à 1350 µ/);
    // hero slew the fat monster and claimed the treasure
    expect(log).toContain("hero abat le monstre mon-1 et réclame son trésor (1100 µ)");
    // second monster starved and released its hoard, which a devot grazed
    expect(log).toMatch(/le monstre mon-2, sans chasse, meurt de faim et relâche son magot \(100 µ\)/);
    expect(log).toContain("ramasse un résidu au sol (100 µ)");

    // Closed economy: at the end everything is still accounted for.
    expect(a.vault.checkInvariant()).toBe(true);
    expect(a.vault.held() + a.vault.burned + a.vault.withdrawn).toBe(a.vault.deposited);
  });

  it("keeps the invariant every tick of a larger autonomous game (many devots + monsters)", () => {
    // Deterministic-ish setup: a spread of deposits, a couple of hunters, 3 monsters.
    const a = new Arena({ monsterMetabolism: 137, devotThinkCost: 89, bountyThreshold: 500 });
    for (let i = 0; i < 12; i++) a.addDevot(`d${i}`, 1000 + i * 733, { hunter: i % 4 === 0 });
    a.addMonster("mA");
    a.addMonster("mB");
    a.addMonster("mC");

    for (let t = 0; t < 200; t++) {
      a.tick();
      expect(a.vault.checkInvariant()).toBe(true);
    }
    expect(a.vault.deposited).toBeGreaterThan(0);
    expect(a.vault.held() + a.vault.burned + a.vault.withdrawn).toBe(a.vault.deposited);
  });
});
