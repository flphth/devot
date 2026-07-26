import { describe, expect, it } from "vitest";
import { LifeLedger, LocalSettler, WalletForge, shortAddress, type Settlement } from "../src/index.js";

const SEED = "test test test test test test test test test test test junk";

describe("every devot is a wallet", () => {
  it("derives a real, distinct address per creature", () => {
    const forge = new WalletForge(SEED);
    const addresses = Array.from({ length: 20 }, (_, i) => forge.addressAt(i));
    expect(new Set(addresses).size).toBe(20);
    for (const a of addresses) expect(a).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("recomputes the same address from the same seed and index", () => {
    // This is what lets the database hold addresses and no keys at all: losing
    // the database loses nothing the seed cannot restore.
    expect(new WalletForge(SEED).addressAt(7)).toBe(new WalletForge(SEED).addressAt(7));
  });

  it("gives a different world different wallets", () => {
    const other = "legal winner thank year wave sausage worth useful legal winner thank yellow";
    expect(new WalletForge(SEED).addressAt(0)).not.toBe(new WalletForge(other).addressAt(0));
  });

  it("makes a fresh world when no seed is given", () => {
    expect(new WalletForge().addressAt(0)).not.toBe(new WalletForge().addressAt(0));
  });

  it("can prove a wallet signed something, without handing out the key", async () => {
    const forge = new WalletForge(SEED);
    const signature = await forge.sign(3, "I was here");
    expect(signature).toMatch(/^0x[0-9a-f]+$/i);
  });

  it("shortens an address for a screen without mangling a short one", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(shortAddress("0xabc")).toBe("0xabc");
  });
});

describe("the life deposit settles in batches, not per movement", () => {
  const forge = new WalletForge(SEED);
  const addr = forge.addressAt(0);

  it("nets a devot's movements into a single settlement", async () => {
    // The point of batching: a life that fell 900 and rose 800 settles once,
    // for 100 — not seventeen times for every bite and blow.
    let batch: Settlement | undefined;
    const ledger = new LifeLedger(new LocalSettler((b) => (batch = b)), 1_000);

    ledger.record("d1", addr, 10_000);
    ledger.record("d1", addr, 9_100);
    ledger.record("d1", addr, 9_900);

    await ledger.flush(Date.now(), true);
    expect(batch?.movements).toHaveLength(1);
    expect(batch?.movements[0]!.delta).toBe(-100);
    expect(batch?.movements[0]!.balance).toBe(9_900);
  });

  it("measures the first sighting from where the life stands, not from zero", async () => {
    // Otherwise a devot's opening balance would settle as a vast deposit.
    let batch: Settlement | undefined;
    const ledger = new LifeLedger(new LocalSettler((b) => (batch = b)), 1_000);
    ledger.record("d1", addr, 150_000);
    expect(await ledger.flush(Date.now(), true)).toBeUndefined();
    expect(batch).toBeUndefined();
  });

  it("stays quiet until the interval has elapsed", async () => {
    const ledger = new LifeLedger(new LocalSettler(), 10_000);
    const now = Date.now();
    ledger.record("d1", addr, 10_000);
    ledger.record("d1", addr, 9_000);
    expect(await ledger.flush(now)).toBeUndefined();
    expect(await ledger.flush(now + 10_001)).toBeDefined();
  });

  it("carries the balance over and clears only the delta", async () => {
    const batches: Settlement[] = [];
    const ledger = new LifeLedger(new LocalSettler((b) => batches.push(b)), 0);

    ledger.record("d1", addr, 10_000);
    ledger.record("d1", addr, 9_000);
    await ledger.flush(Date.now(), true);
    ledger.record("d1", addr, 8_500);
    await ledger.flush(Date.now(), true);

    expect(batches.map((b) => b.movements[0]!.delta)).toEqual([-1_000, -500]);
    expect(batches[1]!.movements[0]!.balance).toBe(8_500);
  });

  it("never lets a slow settlement queue up behind itself", async () => {
    // A batch that double-counted because the previous one had not returned
    // would corrupt every balance after it.
    let running = 0;
    let overlapped = false;
    const ledger = new LifeLedger(
      {
        async settle() {
          running++;
          if (running > 1) overlapped = true;
          await new Promise((r) => setTimeout(r, 30));
          running--;
        },
      },
      0,
    );

    ledger.record("d1", addr, 10_000);
    ledger.record("d1", addr, 9_000);
    const first = ledger.flush(Date.now(), true);
    const second = await ledger.flush(Date.now(), true);
    await first;

    expect(overlapped).toBe(false);
    expect(second).toBeUndefined();
  });

  it("stops settling for a devot that no longer exists", async () => {
    let batch: Settlement | undefined;
    const ledger = new LifeLedger(new LocalSettler((b) => (batch = b)), 0);
    ledger.record("d1", addr, 10_000);
    ledger.record("d1", addr, 9_000);
    ledger.forget("d1");
    expect(await ledger.flush(Date.now(), true)).toBeUndefined();
    expect(batch).toBeUndefined();
    expect(ledger.trackedCount).toBe(0);
  });
});
