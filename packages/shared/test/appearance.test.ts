import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_STATS,
  SHIRT_COLORS,
  STAT_BUDGET,
  STAT_KEYS,
  STAT_MAX,
  decodeIdentity,
  defaultIdentity,
  encodeIdentity,
  signatureOf,
  statMultiplier,
  validateAppearance,
  validateStats,
  type Stats,
} from "../src/appearance.js";

/**
 * Appearance arrives from a client, so nothing is taken on trust. These tests
 * cover exactly what a tampered client would attempt: a made-up piece, a colour
 * outside the palette, and above all stats maxed out everywhere.
 */

describe("appearance — what the server accepts", () => {
  it("lets a legal appearance through", () => {
    expect(validateAppearance(DEFAULT_APPEARANCE)).toBeNull();
  });

  it("refuses a piece that does not exist", () => {
    expect(validateAppearance({ ...DEFAULT_APPEARANCE, hat: "haut-de-forme" })).toMatchObject({
      reason: expect.stringContaining("hat"),
    });
    expect(validateAppearance({ ...DEFAULT_APPEARANCE, cape: "immense" })).not.toBeNull();
    expect(validateAppearance({ ...DEFAULT_APPEARANCE, build: "colossal" })).not.toBeNull();
  });

  it("refuses a colour outside the palette", () => {
    // A free-form colour would be an injection vector into the rendering and
    // into the descriptions sent to the model.
    expect(validateAppearance({ ...DEFAULT_APPEARANCE, shirt: "#ff00ff" })).not.toBeNull();
    expect(
      validateAppearance({ ...DEFAULT_APPEARANCE, skin: "<script>alert(1)</script>" }),
    ).not.toBeNull();
  });

  it("refuses a missing or malformed appearance", () => {
    expect(validateAppearance(null)).not.toBeNull();
    expect(validateAppearance("red")).not.toBeNull();
    expect(validateAppearance({})).not.toBeNull();
  });
});

describe("stats — the budget is the anti-cheat of creation", () => {
  it("lets through a spread that fits the budget", () => {
    expect(validateStats(DEFAULT_STATS)).toBeNull();
    expect(validateStats({ vitality: 5, power: 1, speed: 5, sight: 1 })).toBeNull();
  });

  it("REFUSES the maximum everywhere", () => {
    // The case that matters: a tampered client granting itself 5 on all four stats.
    const cheat: Stats = { vitality: 5, power: 5, speed: 5, sight: 5 };
    const rejection = validateStats(cheat);
    expect(rejection).not.toBeNull();
    expect(rejection!.reason).toContain(String(STAT_BUDGET));
  });

  it("refuses a total that is too low as well as one too high", () => {
    expect(validateStats({ vitality: 1, power: 1, speed: 1, sight: 1 })).not.toBeNull();
    expect(validateStats({ vitality: 4, power: 4, speed: 4, sight: 4 })).not.toBeNull();
  });

  it("refuses an out-of-range stat, even when the total is right", () => {
    // 9 + 1 + 1 + 1 = 12: the total is right, but 9 exceeds the maximum.
    expect(validateStats({ vitality: 9, power: 1, speed: 1, sight: 1 })).not.toBeNull();
    expect(validateStats({ vitality: 0, power: 5, speed: 5, sight: 2 })).not.toBeNull();
  });

  it("refuses anything that is not a whole number", () => {
    expect(validateStats({ vitality: 3.5, power: 3, speed: 3, sight: 2.5 })).not.toBeNull();
    expect(validateStats({ vitality: "5", power: 3, speed: 2, sight: 2 })).not.toBeNull();
    expect(validateStats(null)).not.toBeNull();
  });

  it("the default spread does spend the whole budget", () => {
    const total = STAT_KEYS.reduce((sum, k) => sum + DEFAULT_STATS[k], 0);
    expect(total).toBe(STAT_BUDGET);
  });
});

describe("effect of a stat", () => {
  it("3 is the neutral point", () => {
    expect(statMultiplier(3)).toBeCloseTo(1, 6);
  });

  it("the gap between minimum and maximum is clear but bounded", () => {
    expect(statMultiplier(1)).toBeCloseTo(0.6, 6);
    expect(statMultiplier(STAT_MAX)).toBeCloseTo(1.4, 6);
    // A little over twofold between the extremes: visible, never crushing.
    expect(statMultiplier(STAT_MAX) / statMultiplier(1)).toBeLessThan(2.5);
  });

  it("clamps absurd values instead of propagating them", () => {
    expect(statMultiplier(99)).toBe(statMultiplier(STAT_MAX));
    expect(statMultiplier(-4)).toBe(statMultiplier(1));
    expect(statMultiplier(Number.NaN)).toBe(statMultiplier(1));
  });
});

describe("signature", () => {
  it("the same devot always yields the same signature", () => {
    const a = signatureOf(DEFAULT_APPEARANCE, DEFAULT_STATS, ["curious", "cautious"], "I doubt");
    const b = signatureOf(DEFAULT_APPEARANCE, DEFAULT_STATS, ["cautious", "curious"], "I doubt");
    // Trait order does not matter: it is the same being.
    expect(a).toBe(b);
    expect(a).toMatch(/^DVT-[0-9A-Z]{3}-[0-9A-Z]{4}$/);
  });

  it("a single different choice yields a clearly different signature", () => {
    const base = signatureOf(DEFAULT_APPEARANCE, DEFAULT_STATS, ["curious"], "");
    const hat = signatureOf(
      { ...DEFAULT_APPEARANCE, hat: "crown" },
      DEFAULT_STATS,
      ["curious"],
      "",
    );
    const shirt = signatureOf(
      { ...DEFAULT_APPEARANCE, shirt: SHIRT_COLORS[5]! },
      DEFAULT_STATS,
      ["curious"],
      "",
    );
    const stats = signatureOf(
      DEFAULT_APPEARANCE,
      { vitality: 5, power: 1, speed: 3, sight: 3 },
      ["curious"],
      "",
    );
    expect(new Set([base, hat, shirt, stats]).size).toBe(4);
  });

  it("varied combinations do not collide", () => {
    const seen = new Set<string>();
    for (const hat of ["none", "cap", "widebrim", "helmet", "crown"] as const) {
      for (const shirt of SHIRT_COLORS) {
        seen.add(signatureOf({ ...DEFAULT_APPEARANCE, hat, shirt }, DEFAULT_STATS, [], ""));
      }
    }
    expect(seen.size).toBe(5 * SHIRT_COLORS.length);
  });
});

describe("identity persistence", () => {
  it("a round trip returns exactly the same identity", () => {
    const identity = defaultIdentity(["curious", "ravenous"]);
    const back = decodeIdentity(encodeIdentity(identity));
    expect(back).toEqual(identity);
  });

  it("an unreadable or illegal identity is refused, not guessed", () => {
    expect(decodeIdentity(null)).toBeNull();
    expect(decodeIdentity("")).toBeNull();
    expect(decodeIdentity("{not json")).toBeNull();
    // An identity whose stats were tampered with in the database must not pass.
    const tampered = JSON.stringify({
      ...defaultIdentity(),
      stats: { vitality: 5, power: 5, speed: 5, sight: 5 },
    });
    expect(decodeIdentity(tampered)).toBeNull();
  });
});
