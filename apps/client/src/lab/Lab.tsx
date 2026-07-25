import { Canvas } from "@react-three/fiber";
import { useEffect } from "react";
import { SX, SY } from "@devot/sim-voxel";
import { LabHud } from "./LabHud.js";
import { LabScene } from "./LabScene.js";
import { useLab } from "./useLab.js";

/**
 * Le laboratoire : un monde privé, accéléré, sans conséquence. On y fait
 * évoluer des lignées, on sélectionne à la main, et on exporte le génome qui
 * plaît — c'est lui, et lui seul, qui partira vers le monde commun.
 */
export default function Lab() {
  const lab = useLab();

  // Hooks de test pilotés (dev uniquement).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__lab = {
      stats: lab.stats,
      inspected: lab.inspected,
      conformity: lab.conformity,
      exported: lab.exported,
      logs: lab.logs,
      voxelCount: lab.frame?.voxels.length ?? 0,
      organismCount: lab.frame ? lab.frame.organisms.length / 5 : 0,
      firstOrganismId: lab.frame && lab.frame.organisms.length > 0 ? lab.frame.organisms[0] : 0,
      actions: lab.actions,
    };
  });

  return (
    <div style={{ position: "relative", height: "100%", background: "#0b0e14" }}>
      <Canvas camera={{ position: [0, SY * 2.2, SX * 0.95], fov: 50 }}>
        <LabScene frame={lab.frame} onPickOrganism={lab.actions.select} />
      </Canvas>
      <LabHud lab={lab} />
      {!lab.stats && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "#dde3ee",
            font: "15px system-ui, sans-serif",
            background: "rgba(11,14,20,0.75)",
            pointerEvents: "none",
          }}
        >
          Ensemencement du laboratoire…
        </div>
      )}
    </div>
  );
}
