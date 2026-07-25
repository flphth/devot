import { describe, expect, it } from "vitest";
import { WEI_PER_MICRO, microToWei, weiRemainder, weiToMicro } from "../src/conversion.ts";

describe("wei ↔ µ-unit boundary", () => {
  it("1 OG = 1,000,000 µ-units", () => {
    const oneOG = 1_000_000_000_000_000_000n; // 1e18 wei
    expect(weiToMicro(oneOG)).toBe(1_000_000);
  });

  it("0.05 OG = 50,000 µ (default lifespan scale)", () => {
    expect(weiToMicro(50_000n * WEI_PER_MICRO)).toBe(50_000);
  });

  it("round-trips µ → wei → µ exactly", () => {
    for (const m of [0, 1, 50_000, 999_999, 1_000_000]) {
      expect(weiToMicro(microToWei(m))).toBe(m);
    }
  });

  it("floors wei that doesn't fill a whole µ-unit (never over-credits)", () => {
    expect(weiToMicro(WEI_PER_MICRO - 1n)).toBe(0);
    expect(weiToMicro(WEI_PER_MICRO + 1n)).toBe(1);
    expect(weiRemainder(WEI_PER_MICRO + 1n)).toBe(1n);
  });

  it("rejects negative wei and non-integer µ (no silent rounding loss)", () => {
    expect(() => weiToMicro(-1n)).toThrow();
    expect(() => microToWei(1.5)).toThrow();
    expect(() => microToWei(-5)).toThrow();
  });
});
