import { Grid, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CHUNK, SX, SY, SZ, VIEW_RADIUS } from "@devot/sim-voxel";
import type { VoxelWorldClient } from "./useVoxelWorld.js";

const COLORS: Record<number, string> = {
  1: "#2a6f97", // eau
  2: "#4a4f57", // roche
  3: "#7dbc5e", // biomasse
  4: "#e8e4d8", // os
  5: "#4ce07a", // muscle
  6: "#4ca6e0", // réserve
  7: "#e0634c", // bouche
  8: "#e8c95c", // œil
  9: "#9c4ce0", // neurone
};

const MAX_PER_MATERIAL = 60_000;

/**
 * Le monde commun, tel que le client le connaît : les chunks qu'il a reçus et
 * les corps qu'on lui a décrits. Le reste du monde n'est pas caché par un
 * effet — il n'est simplement pas là.
 *
 * Seule la face SUPÉRIEURE de chaque colonne de terrain est instanciée : sous
 * elle, rien n'est visible, et instancier 500 000 cubes tuerait le rendu.
 */
function TerrainLayer({ material, world }: { material: number; world: VoxelWorldClient }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const color = COLORS[material] ?? "#888888";

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    let n = 0;

    // Hauteur du plus haut voxel non vide par colonne, tous chunks confondus.
    const top = new Int16Array(SX * SZ).fill(-1);
    const mat = new Uint8Array(SX * SZ);
    for (const chunk of world.chunks.values()) {
      let at = 0;
      for (let ly = 0; ly < CHUNK; ly++) {
        const y = chunk.cy * CHUNK + ly;
        for (let lz = 0; lz < CHUNK; lz++) {
          const z = chunk.cz * CHUNK + lz;
          for (let lx = 0; lx < CHUNK; lx++) {
            const value = chunk.materials[at++]!;
            if (value === 0) continue;
            const x = chunk.cx * CHUNK + lx;
            const col = z * SX + x;
            if (y > top[col]!) {
              top[col] = y;
              mat[col] = value;
            }
          }
        }
      }
    }

    for (let col = 0; col < top.length && n < MAX_PER_MATERIAL; col++) {
      if (top[col]! < 0 || mat[col] !== material) continue;
      const x = col % SX;
      const z = (col / SX) | 0;
      m.makeTranslation(x - SX / 2, top[col]!, z - SZ / 2);
      mesh.setMatrixAt(n++, m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }, [world.chunkRevision, material, world.chunks]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX_PER_MATERIAL]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial color={color} />
    </instancedMesh>
  );
}

/** Les corps : un cube par voxel de tissu, à partir des descripteurs reçus. */
function BodiesLayer({ material, world }: { material: number; world: VoxelWorldClient }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const color = COLORS[material] ?? "#888888";

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    let n = 0;
    for (const org of world.organisms) {
      const body = world.bodies.get(org.id);
      if (!body) continue;
      for (let k = 0; k < body.mat.length && n < MAX_PER_MATERIAL; k++) {
        if (body.mat[k] !== material) continue;
        // La position vient de l'état par tick, la forme du descripteur : c'est
        // exactement la séparation qui rend le protocole si léger.
        m.makeTranslation(
          org.x + body.dx[k]! - SX / 2,
          org.y + body.dy[k]!,
          org.z + body.dz[k]! - SZ / 2,
        );
        mesh.setMatrixAt(n++, m);
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }, [world.organisms, world.bodies, material]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX_PER_MATERIAL]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial color={color} />
    </instancedMesh>
  );
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
  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[60, 90, 40]} intensity={1.15} />
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
      {[1, 2, 3].map((m) => (
        <TerrainLayer key={m} material={m} world={world} />
      ))}
      {[4, 5, 6, 7, 8, 9].map((m) => (
        <BodiesLayer key={m} material={m} world={world} />
      ))}
      <ViewBoundary world={world} />
      <OrbitControls target={[0, SY / 6, 0]} maxPolarAngle={Math.PI / 2.1} />
    </>
  );
}
