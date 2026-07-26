import { describe, expect, it } from "vitest";
import {
  BODY_RADIUS,
  resolveRockCollisions,
  worldProps,
} from "../src/props.js";
import { WORLD_HALF, terrainHeight } from "../src/terrain.js";

describe("world props — decoration server and client must agree on", () => {
  it("populates the whole map, not a few lucky patches", () => {
    // The real requirement was never a headcount, it was coverage. Uniform
    // random with a couple of hundred samples clumped: whole quadrants of the
    // world came up bare, which is what made the map read as empty. Asserting
    // a total would have passed happily through that.
    const { rocks, flowers } = worldProps();
    const G = 6;
    const cell = (2 * WORLD_HALF) / G;
    const at = (v: number) => Math.min(G - 1, Math.max(0, Math.floor((v + WORLD_HALF) / cell)));
    const rockRegions = new Set<string>();
    const flowerCounts = new Map<string, number>();

    for (const r of rocks) rockRegions.add(`${at(r.x)},${at(r.z)}`);
    for (const f of flowers) {
      const key = `${at(f.x)},${at(f.z)}`;
      flowerCounts.set(key, (flowerCounts.get(key) ?? 0) + 1);
    }

    // Every one of the 36 regions of the world has both.
    expect(rockRegions.size).toBe(G * G);
    expect(flowerCounts.size).toBe(G * G);
    // And no region is a token sprinkle next to a dense one.
    expect(Math.min(...flowerCounts.values())).toBeGreaterThan(10);
  });

  it("is dense enough to be a landscape rather than a scattering", () => {
    const { rocks, flowers } = worldProps();
    expect(rocks.length).toBeGreaterThan(100);
    expect(flowers.length).toBeGreaterThan(800);
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
