import { Grid, OrbitControls } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { MATERIAL_COUNT, SX, SY, SZ } from "@devot/sim-voxel";
import { unpackVoxel, type LabFrame } from "./protocol.js";

/** Palette voxel : terrain sobre, tissus saturés pour se lire d'un coup d'œil. */
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

const MAX_PER_MATERIAL = 40_000;

/**
 * Rendu voxel par matériau : une InstancedMesh par type, remplie depuis la
 * liste dérivée que le worker envoie. Aucun objet par voxel côté React.
 */
function VoxelLayer({
  material,
  frame,
  onPick,
}: {
  material: number;
  frame: LabFrame | null;
  onPick?: (x: number, y: number, z: number) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const color = COLORS[material] ?? "#888888";
  const isTissue = material >= 4;

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    if (!frame) {
      mesh.count = 0;
      return;
    }
    const m = new THREE.Matrix4();
    const highlight = new THREE.Color("#ffffff");
    const base = new THREE.Color(color);
    let n = 0;
    for (let k = 0; k < frame.voxels.length && n < MAX_PER_MATERIAL; k++) {
      const v = unpackVoxel(frame.voxels[k]!);
      if (v.mat !== material) continue;
      m.makeTranslation(v.x - SX / 2, v.y, v.z - SZ / 2);
      mesh.setMatrixAt(n, m);
      if (isTissue) mesh.setColorAt(n, v.selected ? highlight : base);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [frame, material, color, isTissue]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, MAX_PER_MATERIAL]}
      frustumCulled={false}
      onClick={
        onPick
          ? (e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              onPick(
                Math.round(e.point.x + SX / 2),
                Math.round(e.point.y),
                Math.round(e.point.z + SZ / 2),
              );
            }
          : undefined
      }
    >
      <boxGeometry args={[1, 1, 1]} />
      {isTissue ? (
        <meshLambertMaterial color="#ffffff" />
      ) : (
        <meshLambertMaterial color={color} />
      )}
    </instancedMesh>
  );
}

/** Expose la caméra pour les tests pilotés (dev uniquement). */
function LabTestHooks() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__labCam = { camera, size };
  }, [camera, size]);
  return null;
}

export function LabScene({
  frame,
  onPickOrganism,
}: {
  frame: LabFrame | null;
  onPickOrganism: (organismId: number) => void;
}) {
  const materials = useMemo(
    () => Array.from({ length: MATERIAL_COUNT - 1 }, (_, k) => k + 1),
    [],
  );

  /** Clic dans la scène → organisme dont le germe est le plus proche. */
  const pick = (x: number, y: number, z: number): void => {
    if (!frame) return;
    let best = 0;
    let bestD = 25;
    for (let k = 0; k + 4 < frame.organisms.length; k += 5) {
      const id = frame.organisms[k]!;
      const dx = frame.organisms[k + 1]! - x;
      const dy = frame.organisms[k + 2]! - y;
      const dz = frame.organisms[k + 3]! - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (best > 0) onPickOrganism(best);
  };

  return (
    <>
      <LabTestHooks />
      <ambientLight intensity={0.85} color="#eef4ff" />
      <directionalLight position={[40, 60, 25]} intensity={1.1} color="#fff6e8" />
      <fog attach="fog" args={["#0b0e14", 120, 260]} />

      {materials.map((m) => (
        <VoxelLayer key={m} material={m} frame={frame} onPick={m >= 4 ? pick : undefined} />
      ))}

      <Grid
        args={[SX, SZ]}
        position={[0, -0.51, 0]}
        cellColor="#1d2430"
        sectionColor="#26303e"
        fadeDistance={220}
      />

      <OrbitControls
        makeDefault
        target={[0, SY / 4, 0]}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={20}
        maxDistance={260}
      />
    </>
  );
}
