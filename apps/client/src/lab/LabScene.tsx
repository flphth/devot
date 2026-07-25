import { Grid, OrbitControls } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SX, SY, SZ, TISSUE_MIN } from "@devot/sim-voxel";
import {
  OrganicBodies,
  OrganicLighting,
  OrganicTerrain,
  SelectionMarker,
  type BodyVoxels,
  type SurfaceData,
} from "../render/organic.js";
import { unpackVoxel, type LabFrame } from "./protocol.js";

/**
 * Le laboratoire, en rendu ORGANIQUE : le terrain est une nappe continue, les
 * corps sont des sphères qui se soudent et respirent. La simulation, elle, reste
 * une grille de voxels — seul le regard change.
 */

const MAX_TISSUE = 24_000;

/**
 * Traduit l'image dérivée du worker en ce que la couche de rendu attend : une
 * hauteur et un matériau par colonne pour le terrain, une liste de positions
 * pour les corps. C'est le seul endroit qui connaît le format du worker.
 */
function useFrameGeometry(frame: LabFrame | null): { surface: SurfaceData; body: BodyVoxels } {
  const surfaceRef = useRef<SurfaceData>({
    heights: new Int16Array(SX * SZ).fill(-1),
    mats: new Uint8Array(SX * SZ),
    revision: 0,
  });
  const bodyRef = useRef<BodyVoxels>({
    positions: new Float32Array(MAX_TISSUE * 3),
    mats: new Uint8Array(MAX_TISSUE),
    vigor: new Float32Array(MAX_TISSUE),
    tint: new Uint8Array(MAX_TISSUE),
    selected: new Uint8Array(MAX_TISSUE),
    count: 0,
  });

  return useMemo(() => {
    const s = surfaceRef.current;
    const b = bodyRef.current;
    s.heights.fill(-1);
    s.mats.fill(0);
    let n = 0;

    if (frame) {
      for (let k = 0; k < frame.voxels.length; k++) {
        const v = unpackVoxel(frame.voxels[k]!);
        if (v.mat >= TISSUE_MIN) {
          if (n >= MAX_TISSUE) continue;
          b.positions[n * 3] = v.x - SX / 2;
          b.positions[n * 3 + 1] = v.y;
          b.positions[n * 3 + 2] = v.z - SZ / 2;
          b.mats[n] = v.mat;
          b.selected[n] = v.selected ? 1 : 0;
          // Teinte et vigueur arrivent avec le voxel : aucune recherche ici.
          b.tint[n] = v.tint;
          b.vigor[n] = v.vigor / 7;
          n++;
        } else {
          const col = v.z * SX + v.x;
          if (v.y > s.heights[col]!) {
            s.heights[col] = v.y;
            s.mats[col] = v.mat;
          }
        }
      }
    }

    b.count = n;
    s.revision++;
    return { surface: { ...s }, body: { ...b } };
  }, [frame]);
}

/**
 * CIBLES DE SÉLECTION. Une créature fait trois à cinq voxels : viser exactement
 * l'un d'eux à la souris est un jeu d'adresse, pas une interaction. On pose donc
 * sur chaque organisme une sphère nettement plus large que son corps — assez
 * visible pour dire « il y a quelqu'un ici », assez transparente pour ne pas
 * masquer le corps. C'est elle qu'on clique.
 */
const PICK_RADIUS = 2.4;
const MAX_TARGETS = 2048;

function OrganismTargets({
  frame,
  onPick,
}: {
  frame: LabFrame | null;
  onPick: (organismId: number) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const idsRef = useRef<number[]>([]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const ids: number[] = [];
    const m = new THREE.Matrix4();
    if (frame) {
      for (let k = 0; k + 4 < frame.organisms.length && ids.length < MAX_TARGETS; k += 5) {
        m.makeTranslation(
          frame.organisms[k + 1]! - SX / 2,
          frame.organisms[k + 2]! + 0.4,
          frame.organisms[k + 3]! - SZ / 2,
        );
        mesh.setMatrixAt(ids.length, m);
        ids.push(frame.organisms[k]!);
      }
    }
    idsRef.current = ids;
    mesh.count = ids.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [frame]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, MAX_TARGETS]}
      frustumCulled={false}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        const k = e.instanceId;
        if (k === undefined) return;
        const id = idsRef.current[k];
        if (id === undefined) return;
        e.stopPropagation();
        onPick(id);
      }}
    >
      <sphereGeometry args={[PICK_RADIUS, 10, 8]} />
      <meshBasicMaterial color="#e0b34c" transparent opacity={0.07} depthWrite={false} />
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
  const { surface, body } = useFrameGeometry(frame);

  // Où poser le marqueur : la moyenne des voxels marqués sélectionnés.
  const marked = useMemo(() => {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let n = 0;
    for (let k = 0; k < body.count; k++) {
      if (!body.selected[k]) continue;
      sx += body.positions[k * 3]!;
      sy += body.positions[k * 3 + 1]!;
      sz += body.positions[k * 3 + 2]!;
      n++;
    }
    return n === 0 ? null : { x: sx / n, y: sy / n, z: sz / n };
  }, [body]);

  /** Clic sur la nappe → organisme dont le germe est le plus proche. */
  const pickNear = (x: number, z: number): void => {
    if (!frame) return;
    let best = 0;
    let bestD = 36; // on pardonne une visée à six voxels près
    for (let k = 0; k + 4 < frame.organisms.length; k += 5) {
      const dx = frame.organisms[k + 1]! - SX / 2 - x;
      const dz = frame.organisms[k + 3]! - SZ / 2 - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = frame.organisms[k]!;
      }
    }
    if (best > 0) onPickOrganism(best);
  };

  return (
    <>
      <LabTestHooks />
      <OrganicLighting />
      <fog attach="fog" args={["#0b0e14", 150, 320]} />

      <group
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          pickNear(e.point.x, e.point.z);
        }}
      >
        <OrganicTerrain surface={surface} />
      </group>
      <OrganicBodies body={body} />
      <SelectionMarker position={marked} />
      <OrganismTargets frame={frame} onPick={onPickOrganism} />

      <Grid
        args={[SX, SZ]}
        position={[0, -0.51, 0]}
        cellColor="#1d2430"
        sectionColor="#26303e"
        cellSize={8}
        sectionSize={32}
        fadeDistance={320}
        infiniteGrid={false}
      />
      <OrbitControls target={[0, SY / 5, 0]} maxPolarAngle={Math.PI / 2.05} />
    </>
  );
}
