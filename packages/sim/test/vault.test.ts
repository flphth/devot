import { describe, expect, it } from "vitest";
import { Vault } from "../src/vault.ts";

/** Deterministic PRNG so any invariant break reproduces from the seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("Vault — conservation on individual moves", () => {
  it("holds the invariant after a create + burn + transfer + death + eat + claim", () => {
    const v = new Vault();
    v.createDevot("d1", 10_000);
    v.createDevot("d2", 6_000);
    expect(v.checkInvariant()).toBe(true);

    v.burn("d1", 1_500); // d1 thinks
    expect(v.checkInvariant()).toBe(true);
    expect(v.burned).toBe(1_500);

    v.transfer("d2", "d1", 2_000); // combat: d1 robs d2
    expect(v.balanceOf("d1")).toBe(10_500);
    expect(v.balanceOf("d2")).toBe(4_000);
    expect(v.checkInvariant()).toBe(true);

    v.kill("d2", "r-d2"); // d2 dies, drops residue
    expect(v.balanceOf("d2")).toBe(0);
    expect(v.residueOf("r-d2")).toBe(4_000);
    expect(v.checkInvariant()).toBe(true);

    v.eatResidue("d1", "r-d2"); // d1 eats the residue
    expect(v.balanceOf("d1")).toBe(14_500);
    expect(v.checkInvariant()).toBe(true);

    const out = v.claim("d1"); // god withdraws d1
    expect(out).toBe(14_500);
    expect(v.withdrawn).toBe(14_500);
    expect(v.checkInvariant()).toBe(true);

    // Everything deposited (16_000) is now: 0 held + 1_500 burned + 14_500 withdrawn.
    expect(v.held()).toBe(0);
    expect(v.burned + v.withdrawn).toBe(v.deposited);
  });

  it("a monster starts with nothing and grows only by looting (zero creation)", () => {
    const v = new Vault();
    v.createDevot("prey", 8_000);
    v.spawnMonster("mon");
    expect(v.balanceOf("mon")).toBe(0);
    expect(v.checkInvariant()).toBe(true);

    v.burn("mon", 0); // metabolism can be zero here; still valid
    v.transfer("prey", "mon", 8_000); // monster kills+loots the prey's balance
    v.kill("prey", "r-prey"); // prey (now empty) dies, no residue
    expect(v.balanceOf("mon")).toBe(8_000);
    expect(v.residueOf("r-prey")).toBe(0);
    expect(v.checkInvariant()).toBe(true);
  });

  it("rejects moves that would break conservation", () => {
    const v = new Vault();
    v.createDevot("d1", 1_000);
    expect(() => v.burn("d1", 2_000)).toThrow(); // can't burn more than held
    expect(() => v.transfer("d1", "ghost", 100)).toThrow(); // unknown recipient
    expect(() => v.createDevot("d1", 500)).toThrow(); // duplicate token
    expect(v.checkInvariant()).toBe(true);
  });
});

describe("Vault — invariant holds across a whole simulated game", () => {
  it("stays exact after every op of a scripted full game (create/combat/death/withdraw)", () => {
    const v = new Vault();
    const steps: Array<() => void> = [
      () => v.createDevot("g1", 20_000),
      () => v.createDevot("g2", 15_000),
      () => v.createDevot("g3", 30_000),
      () => v.spawnMonster("M"),
      () => v.burn("g1", 3_000),
      () => v.burn("g2", 2_500),
      () => v.transfer("g1", "g2", 4_000), // g2 attacks g1
      () => v.burn("M", 0),
      () => v.transfer("g3", "M", 10_000), // monster mauls g3
      () => v.burn("g3", 1_000),
      () => v.kill("g1", "r1"), // g1 dies
      () => v.eatResidue("g2", "r1"), // g2 scavenges
      () => v.transfer("M", "g2", 5_000), // g2 slays the monster, claims loot... via transfer
      () => v.kill("M", "rM"), // monster dies
      () => v.claimResidue("rM"), // god claims the monster's residue
      () => v.burn("g2", 6_000),
      () => v.kill("g3", "r3"),
      () => v.claim("g2"), // god withdraws the survivor
      () => v.claimResidue("r3"),
    ];
    for (const step of steps) {
      step();
      expect(v.checkInvariant()).toBe(true);
    }
    expect(v.held()).toBe(0); // game fully settled
    expect(v.burned + v.withdrawn).toBe(v.deposited);
  });

  it("holds under randomized play (fuzz, 2000 valid ops)", () => {
    const rnd = mulberry32(0xc0ffee);
    const v = new Vault();
    const live = new Set<string>();
    const residues = new Set<string>();
    let n = 0;

    const pick = (s: Set<string>): string | undefined => {
      if (s.size === 0) return undefined;
      const arr = [...s];
      return arr[Math.floor(rnd() * arr.length)];
    };
    const amt = (max: number) => Math.max(1, Math.floor(rnd() * max));

    for (let i = 0; i < 2000; i++) {
      const roll = rnd();
      if (roll < 0.2 || live.size < 2) {
        const id = `t${n++}`;
        v.createDevot(id, amt(50_000));
        live.add(id);
      } else if (roll < 0.35) {
        const id = pick(live)!;
        const b = v.balanceOf(id);
        if (b > 0) v.burn(id, amt(b));
      } else if (roll < 0.55) {
        const a = pick(live)!;
        const b = pick(live)!;
        const ba = v.balanceOf(a);
        if (a !== b && ba > 0) v.transfer(a, b, amt(ba));
      } else if (roll < 0.7) {
        const id = pick(live)!;
        const rid = `r${n++}`;
        v.kill(id, rid);
        live.delete(id);
        if (v.residueOf(rid) > 0) residues.add(rid);
      } else if (roll < 0.85) {
        const id = pick(live);
        const rid = pick(residues);
        if (id && rid) {
          v.eatResidue(id, rid);
          residues.delete(rid);
        }
      } else if (roll < 0.93) {
        const id = pick(live);
        if (id) {
          v.claim(id);
          live.delete(id);
        }
      } else {
        const rid = pick(residues);
        if (rid) {
          v.claimResidue(rid);
          residues.delete(rid);
        }
      }
      expect(v.checkInvariant()).toBe(true);
    }
  });
});
