import { describe, expect, it } from "vitest";
import { Economy } from "../src/economy.js";

describe("a god pays for every devot it makes", () => {
  it("endows a god once, and ignores a second endowment", () => {
    // Otherwise a reconnect would print money.
    const e = new Economy();
    e.endow("g1", 1000);
    e.endow("g1", 1000);
    expect(e.balanceOf("g1")).toBe(1000);
    expect(e.snapshot().endowed).toBe(1000);
  });

  it("refuses a deposit it cannot cover, and moves nothing", () => {
    const e = new Economy();
    e.endow("g1", 100);
    expect(e.withdraw("g1", 150)).toBe(false);
    expect(e.balanceOf("g1")).toBe(100);
  });

  it("lets a god spend exactly what it has", () => {
    const e = new Economy();
    e.endow("g1", 100);
    expect(e.withdraw("g1", 100)).toBe(true);
    expect(e.balanceOf("g1")).toBe(0);
    expect(e.canAfford("g1", 1)).toBe(false);
  });

  it("knows nothing of a god it has never seen", () => {
    const e = new Economy();
    expect(e.balanceOf("ghost")).toBe(0);
    expect(e.withdraw("ghost", 1)).toBe(false);
  });
});

describe("the books balance, always", () => {
  it("accounts a full life: deposit, burn, relic, recovery", () => {
    const e = new Economy();
    e.endow("g1", 1000);

    // A devot is made: 600 leaves the treasury and becomes its life.
    expect(e.withdraw("g1", 600)).toBe(true);
    expect(e.conserves(600, 0)).toBe(true);

    // It thinks away 400 of that life.
    e.burn(400);
    expect(e.conserves(200, 0)).toBe(true);

    // It dies holding 200: a relic worth 150 drops where it fell, and the
    // remaining 50 is destroyed. Death releases some and eats the rest.
    e.burn(50);
    expect(e.conserves(0, 150)).toBe(true);

    // Someone picks the relic up.
    e.credit("g1", 150);
    expect(e.conserves(0, 0)).toBe(true);
    expect(e.balanceOf("g1")).toBe(550);
  });

  it("notices when value appears from nowhere", () => {
    // The invariant has to FAIL on a leak, or it is decoration.
    const e = new Economy();
    e.endow("g1", 100);
    e.credit("g1", 50); // minted out of thin air
    expect(e.conserves(0, 0)).toBe(false);
  });

  it("notices when value silently disappears", () => {
    const e = new Economy();
    e.endow("g1", 100);
    e.withdraw("g1", 100); // became a devot's life…
    expect(e.conserves(0, 0)).toBe(false); // …which nobody accounted for
  });

  it("ignores a burn of nothing", () => {
    const e = new Economy();
    e.endow("g1", 100);
    e.burn(0);
    e.burn(-50);
    expect(e.snapshot().burned).toBe(0);
    expect(e.conserves(100, 0)).toBe(false);
  });

  it("holds across a long, messy run", () => {
    const e = new Economy();
    const gods = ["g1", "g2", "g3"];
    for (const g of gods) e.endow(g, 1000);

    let living = 0;
    let ground = 0;
    let seed = 42;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    for (let i = 0; i < 2000; i++) {
      const g = gods[Math.floor(rand() * gods.length)]!;
      const roll = rand();
      if (roll < 0.3) {
        const deposit = Math.floor(rand() * 200);
        if (e.withdraw(g, deposit)) living += deposit;
      } else if (roll < 0.6 && living > 0) {
        const spent = Math.min(living, Math.floor(rand() * 50));
        living -= spent;
        e.burn(spent);
      } else if (roll < 0.8 && living > 0) {
        const died = Math.min(living, Math.floor(rand() * 100));
        living -= died;
        const relic = Math.floor(died * 0.35);
        ground += relic;
        e.burn(died - relic);
      } else if (ground > 0) {
        const taken = Math.min(ground, Math.floor(rand() * 80));
        ground -= taken;
        e.credit(g, taken);
      }
      expect(e.conserves(living, ground)).toBe(true);
    }
  });
});
