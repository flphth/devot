import { describe, expect, it } from "vitest";
import { PERCEPTION_RADIUS } from "../src/constants.js";
import {
  TERRAIN_AMPLITUDE,
  WORLD_HALF,
  hasLineOfSight,
  slopeSpeedFactor,
  terrainGrade,
  terrainHeight,
} from "../src/terrain.js";

const sample = <T,>(step: number, f: (x: number, z: number) => T): T[] => {
  const out: T[] = [];
  for (let x = -WORLD_HALF; x <= WORLD_HALF; x += step) {
    for (let z = -WORLD_HALF; z <= WORLD_HALF; z += step) out.push(f(x, z));
  }
  return out;
};

describe("terrain — the ground server and client must agree on", () => {
  it("is a pure function: same coordinates, same height, every time", () => {
    const once = sample(3.7, terrainHeight);
    const twice = sample(3.7, terrainHeight);
    expect(twice).toEqual(once);
  });

  it("stays inside its amplitude everywhere in the world", () => {
    for (const h of sample(0.5, terrainHeight)) {
      expect(Math.abs(h)).toBeLessThanOrEqual(TERRAIN_AMPLITUDE);
    }
  });

  it("has no crater at the origin, where devots are born", () => {
    // A zero-input hash that mixes to zero used to pin (0,0) to the floor.
    const heights = sample(1, terrainHeight);
    const min = Math.min(...heights);
    expect(terrainHeight(0, 0)).toBeGreaterThan(min + 0.5);
  });

  it("is continuous: no cliff between neighbouring points", () => {
    for (let x = -20; x <= 20; x += 1.3) {
      for (let z = -20; z <= 20; z += 1.3) {
        const jump = Math.abs(terrainHeight(x + 0.1, z) - terrainHeight(x, z));
        expect(jump).toBeLessThan(0.6);
      }
    }
  });
});

describe("slopes slow the body down", () => {
  it("climbing costs speed, descending gains a little", () => {
    expect(slopeSpeedFactor(1)).toBeLessThan(1);
    expect(slopeSpeedFactor(-1)).toBeGreaterThan(1);
    expect(slopeSpeedFactor(0)).toBe(1);
  });

  it("never stops a body dead, never launches it", () => {
    for (const grade of [-100, -3, 0, 3, 100]) {
      const f = slopeSpeedFactor(grade);
      expect(f).toBeGreaterThanOrEqual(0.35);
      expect(f).toBeLessThanOrEqual(1.25);
    }
  });

  it("reads the grade in the direction of travel, sign included", () => {
    // Walking up a slope and walking back down it are opposite grades.
    for (let x = -20; x <= 20; x += 6.1) {
      const up = terrainGrade(x, 3, 1, 0);
      const down = terrainGrade(x, 3, -1, 0);
      if (Math.abs(up) > 0.05) expect(Math.sign(up)).toBe(-Math.sign(down));
    }
  });
});

describe("hills block the line of sight", () => {
  it("sees itself and its immediate surroundings", () => {
    for (let x = -20; x <= 20; x += 7.3) {
      expect(hasLineOfSight({ x, y: 0, z: 0 }, { x, y: 0, z: 0 })).toBe(true);
      expect(hasLineOfSight({ x, y: 0, z: 0 }, { x: x + 0.4, y: 0, z: 0 })).toBe(true);
    }
  });

  it("actually hides part of the world at full perception range", () => {
    let blocked = 0;
    let total = 0;
    for (let x = -22; x <= 22; x += 2) {
      for (let z = -22; z <= 22; z += 2) {
        const to = { x: x + PERCEPTION_RADIUS, y: 0, z };
        if (Math.abs(to.x) > WORLD_HALF) continue;
        total++;
        if (!hasLineOfSight({ x, y: 0, z }, to)) blocked++;
      }
    }
    // A relief that hides nothing is decoration; one that hides everything is
    // a wall. Both would be bugs — this is the property that keeps it a game.
    const ratio = blocked / total;
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.6);
  });

  it("is symmetric: if I can see you, you can see me", () => {
    for (let x = -18; x <= 18; x += 5.7) {
      for (let z = -18; z <= 18; z += 5.7) {
        const a = { x, y: 0, z };
        const b = { x: x + 8, y: 0, z: z + 5 };
        expect(hasLineOfSight(a, b)).toBe(hasLineOfSight(b, a));
      }
    }
  });
});
