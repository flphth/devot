import { describe, expect, it } from "vitest";
import { consumeResidue, createDevot, killDevot } from "../src/devot.ts";

const base = { id: "DVT-000-0001", godId: "god-1", wallet: "0xGod", model: "claude-haiku-4-5" };

describe("createDevot (wallet connected at creation)", () => {
  it("is born from a wallet + deposit", () => {
    const d = createDevot({ ...base, deposit: 50_000 });
    expect(d.wallet).toBe("0xGod");
    expect(d.balance).toBe(50_000);
    expect(d.hpMax).toBe(50_000);
    expect(d.state).toBe("vivant");
  });

  it("cannot exist without a connected wallet", () => {
    expect(() => createDevot({ ...base, wallet: "", deposit: 50_000 })).toThrow(/wallet/);
  });

  it("cannot exist without a deposit", () => {
    expect(() => createDevot({ ...base, deposit: 0 })).toThrow(/deposit/);
  });
});

describe("death drops the balance to the ground", () => {
  it("a devot killed with life leaves a residue of its whole balance", () => {
    const d = createDevot({ ...base, deposit: 8_000 });
    const residue = killDevot(d, "res-1");
    expect(d.state).toBe("mort");
    expect(d.balance).toBe(0);
    expect(residue).toEqual({ id: "res-1", fromDevotId: "DVT-000-0001", balance: 8_000 });
  });

  it("a devot that starved to 0 leaves nothing", () => {
    const d = createDevot({ ...base, deposit: 8_000 });
    d.balance = 0;
    expect(killDevot(d, "res-x")).toBeNull();
  });
});

describe("the living recharge from residue (closed economy)", () => {
  it("transfers the residue's whole value — no money created or destroyed", () => {
    const victim = createDevot({ ...base, id: "DVT-victim", deposit: 5_000 });
    const eater = createDevot({ ...base, id: "DVT-eater", deposit: 2_000 });

    const totalBefore = victim.balance + eater.balance; // 7_000

    const residue = killDevot(victim, "res-42");
    expect(residue).not.toBeNull();
    const gained = consumeResidue(eater, residue!);

    expect(gained).toBe(5_000);
    expect(eater.balance).toBe(7_000);
    // conservation: victim(0) + eater(7_000) == total before, residue consumed
    expect(victim.balance + eater.balance).toBe(totalBefore);
  });

  it("a dead devot cannot eat", () => {
    const d = createDevot({ ...base, deposit: 1_000 });
    killDevot(d, "r");
    expect(() => consumeResidue(d, { id: "r2", fromDevotId: "x", balance: 100 })).toThrow(/dead/);
  });
});
