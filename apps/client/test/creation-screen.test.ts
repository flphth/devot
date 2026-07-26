import { describe, expect, it } from "vitest";

/**
 * WHEN THE CREATION SCREEN CLOSES ITSELF.
 *
 * The rule pulled out of App.tsx so it can be checked without a browser. It
 * shipped once as `hasLiving && creationAsked`, and `hasLiving` is true the
 * whole time a god has anybody at all — so Escape set the flag and the effect
 * cleared it in the same breath. The player asked for the creation menu and got
 * a blink.
 */
function shouldClose(
  creationAsked: boolean,
  livingWhenAsked: Set<string> | null,
  livingNow: string[],
): boolean {
  if (!creationAsked || !livingWhenAsked) return false;
  return livingNow.some((id) => !livingWhenAsked.has(id));
}

describe("the creation screen stays where it was put", () => {
  it("stays open when the god already has a line", () => {
    // The bug, exactly: opening it with devots alive must not close it.
    expect(shouldClose(true, new Set(["a", "b"]), ["a", "b"])).toBe(false);
  });

  it("stays open while those devots go about their lives", () => {
    // Positions, balances and thoughts change twenty times a second. None of
    // that is a birth.
    expect(shouldClose(true, new Set(["a"]), ["a"])).toBe(false);
  });

  it("stays open even when the line dies out underneath it", () => {
    expect(shouldClose(true, new Set(["a"]), [])).toBe(false);
  });

  it("closes the moment a devot that was not there appears", () => {
    expect(shouldClose(true, new Set(["a"]), ["a", "newborn"])).toBe(true);
  });

  it("closes on a birth even if the old line died first", () => {
    expect(shouldClose(true, new Set(["a"]), ["newborn"])).toBe(true);
  });

  it("does nothing at all when the screen was not asked for", () => {
    // The screen a dead line opens on its own is governed by hasLiving, not by
    // this rule — it must not be closed out from under the player.
    expect(shouldClose(false, null, ["newborn"])).toBe(false);
    expect(shouldClose(false, new Set(["a"]), ["newborn"])).toBe(false);
  });
});
