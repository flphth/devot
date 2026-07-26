import { describe, expect, it } from "vitest";
import {
  DAYS_PER_SEASON,
  DAY_MS,
  NIGHT_FRACTION,
  SEASONS,
  dayNumber,
  dayPhase,
  dayProgress,
  describeSky,
  foodSpawnMultiplier,
  isNight,
  metabolismMultiplier,
  monsterSightMultiplier,
  seasonOf,
} from "../src/clock.js";

describe("the world's clock", () => {
  it("runs from sunrise to sunrise", () => {
    expect(dayProgress(0)).toBe(0);
    expect(dayProgress(DAY_MS / 2)).toBeCloseTo(0.5, 6);
    expect(dayProgress(DAY_MS)).toBe(0);
    expect(dayProgress(DAY_MS * 3.25)).toBeCloseTo(0.25, 6);
  });

  it("counts days and turns them into seasons, in order and forever", () => {
    expect(dayNumber(0)).toBe(0);
    expect(dayNumber(DAY_MS * 5.9)).toBe(5);
    for (let i = 0; i < SEASONS.length * 3; i++) {
      const at = DAY_MS * DAYS_PER_SEASON * i;
      expect(seasonOf(at)).toBe(SEASONS[i % SEASONS.length]);
    }
  });

  it("spends the promised share of every day in the dark", () => {
    let dark = 0;
    const samples = 2000;
    for (let i = 0; i < samples; i++) {
      if (isNight((DAY_MS * i) / samples)) dark++;
    }
    expect(dark / samples).toBeCloseTo(NIGHT_FRACTION, 2);
  });

  it("agrees with itself: dayPhase says night exactly when isNight does", () => {
    for (let i = 0; i < 500; i++) {
      const at = (DAY_MS * i) / 500;
      expect(dayPhase(at) === "night").toBe(isNight(at));
    }
  });
});

describe("night and winter make existing expensive", () => {
  const noon = DAY_MS * 0.3;
  const midnight = DAY_MS * 0.9;

  it("costs more to live at night than by day", () => {
    expect(metabolismMultiplier(midnight)).toBeGreaterThan(metabolismMultiplier(noon));
  });

  it("costs more to live in winter than in summer", () => {
    const summer = SEASONS.indexOf("summer") * DAYS_PER_SEASON * DAY_MS + noon;
    const winter = SEASONS.indexOf("winter") * DAYS_PER_SEASON * DAY_MS + noon;
    expect(metabolismMultiplier(winter)).toBeGreaterThan(metabolismMultiplier(summer));
  });

  it("never makes living free, nor instantly fatal", () => {
    for (let i = 0; i < 400; i++) {
      const m = metabolismMultiplier((DAY_MS * DAYS_PER_SEASON * SEASONS.length * i) / 400);
      expect(m).toBeGreaterThanOrEqual(1);
      expect(m).toBeLessThanOrEqual(4);
    }
  });
});

describe("the world gives less in the dark and in the cold", () => {
  it("nothing much grows at night", () => {
    expect(foodSpawnMultiplier(DAY_MS * 0.9)).toBeLessThan(
      foodSpawnMultiplier(DAY_MS * 0.3),
    );
  });

  it("summer is generous, winter is lean", () => {
    const at = (name: (typeof SEASONS)[number]) =>
      SEASONS.indexOf(name) * DAYS_PER_SEASON * DAY_MS + DAY_MS * 0.3;
    expect(foodSpawnMultiplier(at("summer"))).toBeGreaterThan(foodSpawnMultiplier(at("winter")));
  });

  it("never stops the harvest entirely — a world with no food is a dead world", () => {
    for (let i = 0; i < 400; i++) {
      const m = foodSpawnMultiplier((DAY_MS * DAYS_PER_SEASON * SEASONS.length * i) / 400);
      expect(m).toBeGreaterThan(0);
    }
  });

  it("gives the night to the predators", () => {
    expect(monsterSightMultiplier(DAY_MS * 0.9)).toBeGreaterThan(1);
    expect(monsterSightMultiplier(DAY_MS * 0.3)).toBe(1);
  });
});

describe("what a devot is told about the sky", () => {
  it("always says both the hour and the season", () => {
    for (let i = 0; i < 40; i++) {
      const text = describeSky((DAY_MS * DAYS_PER_SEASON * SEASONS.length * i) / 40);
      expect(text.length).toBeGreaterThan(20);
      // One sentence for the hour, one for the season — never just one of them.
      expect(text.split(". ").length).toBeGreaterThanOrEqual(2);
    }
  });

  it("warns plainly at night, because that is when it matters", () => {
    expect(describeSky(DAY_MS * 0.9)).toContain("NIGHT");
  });
});
