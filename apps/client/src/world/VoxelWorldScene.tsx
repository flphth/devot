import { Grid, OrbitControls } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { CHUNK, SX, SY, SZ, TISSUE_MIN, VIEW_RADIUS, hash32 } from "@devot/sim-voxel";
import {
  OrganicBodies,
  OrganicLighting,
  OrganicTerrain,
  SelectionMarker,
  type BodyVoxels,
  type SurfaceData,
} from "../render/organic.js";
import type { VoxelWorldClient } from "./useVoxelWorld.js";

/**
 * Le monde commun, tel que le client le connaît : les chunks qu'il a reçus et
 * les corps qu'on lui a décrits. Le reste du monde n'est pas caché par un
 * effet — il n'est simplement pas là, et la nappe de terrain s'y interrompt.
 *
 * Même rendu organique que le laboratoire : c'est le même monde, il doit avoir
 * le même visage.
 */

const MAX_TISSUE = 24_000;

/** Assemble les chunks reçus en une surface, et les corps décrits en sphères. */
function useWorldGeometry(world: VoxelWorldClient): { surface: SurfaceData; body: BodyVoxels } {
  const surface = useMemo(() => {
    const heights = new Int16Array(SX * SZ).fill(-1);
    const mats = new Uint8Array(SX * SZ);
    for (const chunk of world.chunks.values()) {
      let at = 0;
      for (let ly = 0; ly < CHUNK; ly++) {
        const y = chunk.cy * CHUNK + ly;
        for (let lz = 0; lz < CHUNK; lz++) {
          const z = chunk.cz * CHUNK + lz;
          for (let lx = 0; lx < CHUNK; lx++) {
            const value = chunk.materials[at++]!;
            if (value === 0) continue;
            const col = z * SX + chunk.cx * CHUNK + lx;
            if (y > heights[col]!) {
              heights[col] = y;
              mats[col] = value;
            }
          }
        }
      }
    }
    return { heights, mats, revision: world.chunkRevision };
  }, [world.chunkRevision, world.chunks]);

  const body = useMemo(() => {
    const positions = new Float32Array(MAX_TISSUE * 3);
    const mats = new Uint8Array(MAX_TISSUE);
    const vigor = new Float32Array(MAX_TISSUE);
    const tint = new Uint8Array(MAX_TISSUE);
    const selected = new Uint8Array(MAX_TISSUE);
    let n = 0;
    for (const org of world.organisms) {
      const shape = world.bodies.get(org.id);
      if (!shape) continue;
      const vig = org.energy / 1000;
      const isSelected = org.id === world.selected ? 1 : 0;
      // Même dérivation que dans le laboratoire : une créature garde sa couleur
      // en passant d'un monde à l'autre.
      const hue = hash32(org.id, 0x7a1e, 0) & 0x1f;
      for (let k = 0; k < shape.mat.length && n < MAX_TISSUE; k++) {
        if (shape.mat[k]! < TISSUE_MIN) continue;
        positions[n * 3] = org.x + shape.dx[k]! - SX / 2;
        positions[n * 3 + 1] = org.y + shape.dy[k]!;
        positions[n * 3 + 2] = org.z + shape.dz[k]! - SZ / 2;
        mats[n] = shape.mat[k]!;
        vigor[n] = vig;
        tint[n] = hue;
        selected[n] = isSelected;
        n++;
      }
    }
    return { positions, mats, vigor, tint, selected, count: n };
  }, [world.organisms, world.bodies, world.selected]);

  return { surface, body };
}

/** Le bord du champ de vision : montrer où s'arrête ce que le serveur consent. */
function ViewBoundary({ world }: { world: VoxelWorldClient }) {
  const points = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let a = 0; a <= 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      pts.push(
        new THREE.Vector3(
          world.eye.x + Math.cos(t) * VIEW_RADIUS - SX / 2,
          0.6,
          world.eye.z + Math.sin(t) * VIEW_RADIUS - SZ / 2,
        ),
      );
    }
    return pts;
  }, [world.eye.x, world.eye.z]);

  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  return (
    <primitive
      object={new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#e0b34c" }))}
    />
  );
}

export function VoxelWorldScene({ world }: { world: VoxelWorldClient }) {
  const { surface, body } = useWorldGeometry(world);
  const marked = useMemo(() => {
    const org = world.organisms.find((o) => o.id === world.selected);
    return org ? { x: org.x - SX / 2, y: org.y, z: org.z - SZ / 2 } : null;
  }, [world.organisms, world.selected]);
  return (
    <>
      <OrganicLighting />
      <fog attach="fog" args={["#0b0e14", 160, 340]} />
      <Grid
        args={[SX, SZ]}
        cellSize={8}
        sectionSize={32}
        cellColor="#1d2531"
        sectionColor="#2b3648"
        position={[0, -0.01, 0]}
        infiniteGrid={false}
        fadeDistance={400}
      />
      <OrganicTerrain surface={surface} />
      <OrganicBodies body={body} />
      <SelectionMarker position={marked} />
      <ViewBoundary world={world} />
      <OrbitControls target={[0, SY / 6, 0]} maxPolarAngle={Math.PI / 2.1} />
    </>
  );
}
