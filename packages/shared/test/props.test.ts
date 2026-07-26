import { describe, expect, it } from "vitest";
import {
  BODY_RADIUS,
  FLOWER_COUNT,
  ROCK_COUNT,
  resolveRockCollisions,
  worldProps,
} from "../src/props.js";
import { WORLD_HALF, terrainHeight } from "../src/terrain.js";

describe("world props — decoration server and client must agree on", () => {
  it("generates the asked-for population", () => {
    const { rocks, flowers } = worldProps();
    expect(rocks).toHaveLength(ROCK_COUNT);
    expect(flowers).toHaveLength(FLOWER_COUNT);
  });

  it("returns the very same props every call", () => {
    // The client draws these and the server collides against them. If the two
    // sequences ever diverged, devots would bounce off invisible boulders.
    expect(worldProps()).toEqual(worldProps());
  });

  it("keeps everything inside the world and on the ground", () => {
    const { rocks, flowers } = worldProps();
    for (const p of [...rocks, ...flowers]) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(WORLD_HALF);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(WORLD_HALF);
      expect(p.y).toBeCloseTo(terrainHeight(p.x, p.z), 6);
    }
  });

  it("never overlaps two boulders — bodies could get pinched between them", () => {
    const { rocks } = worldProps();
    for (let i = 0; i < rocks.length; i++) {
      for (let j = i + 1; j < rocks.length; j++) {
        const a = rocks[i]!;
        const b = rocks[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(a.radius + b.radius);
      }
    }
  });

  it("leaves the middle of the map clear, where founders are born", () => {
    for (const r of worldProps().rocks) {
      expect(Math.hypot(r.x, r.z)).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("rocks are solid", () => {
  it("pushes a body that walked into a boulder back out of it", () => {
    const rock = worldProps().rocks[0]!;
    const pos = { x: rock.x + 0.05, y: 0, z: rock.z };
    resolveRockCollisions(pos);
    expect(Math.hypot(pos.x - rock.x, pos.z - rock.z)).toBeGreaterThanOrEqual(
      rock.radius + BODY_RADIUS - 1e-9,
    );
  });

  it("survives a body exactly at a boulder's centre without dividing by zero", () => {
    const rock = worldProps().rocks[1]!;
    const pos = { x: rock.x, y: 0, z: rock.z };
    resolveRockCollisions(pos);
    expect(Number.isFinite(pos.x)).toBe(true);
    expect(Number.isFinite(pos.z)).toBe(true);
    expect(Math.hypot(pos.x - rock.x, pos.z - rock.z)).toBeGreaterThan(rock.radius);
  });

  it("leaves a body standing in the open exactly where it was", () => {
    const pos = { x: 0, y: 0, z: 0 }; // the cleared centre
    resolveRockCollisions(pos);
    expect(pos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("resolves to a resting place that is itself collision-free", () => {
    // One pass must be enough: if pushing out of one rock pushed a body into
    // another, devots would jitter between boulders forever.
    for (const rock of worldProps().rocks) {
      for (const [dx, dz] of [
        [0.1, 0],
        [0, 0.1],
        [-0.1, -0.05],
      ]) {
        const pos = { x: rock.x + dx!, y: 0, z: rock.z + dz! };
        resolveRockCollisions(pos);
        const after = { ...pos };
        resolveRockCollisions(pos);
        expect(pos.x).toBeCloseTo(after.x, 9);
        expect(pos.z).toBeCloseTo(after.z, 9);
      }
    }
  });
});
