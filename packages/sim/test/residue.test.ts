import { describe, expect, it } from "vitest";
import { dropResidue, residueValue } from "../src/residue.ts";

describe("dropResidue", () => {
  it("drops the leftover balance as ground food when a devot dies with life", () => {
    const r = dropResidue("res-1", "DVT-1", 3200);
    expect(r).toEqual({ id: "res-1", fromDevotId: "DVT-1", balance: 3200 });
  });

  it("drops nothing when the devot starved to zero (no zero-value litter)", () => {
    expect(dropResidue("res-2", "DVT-2", 0)).toBeNull();
    expect(dropResidue("res-3", "DVT-3", -5)).toBeNull();
  });

  it("residueValue returns the amount a consumer gains", () => {
    const r = dropResidue("res-4", "DVT-4", 900)!;
    expect(residueValue(r)).toBe(900);
  });
});
