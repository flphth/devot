import { Canvas } from "@react-three/fiber";
import { useEffect } from "react";
import { SX, SY } from "@devot/sim-voxel";
import { VoxelWorldHud } from "./VoxelWorldHud.js";
import { VoxelWorldScene } from "./VoxelWorldScene.js";
import { useVoxelWorld } from "./useVoxelWorld.js";

/**
 * La vue du monde commun. Elle ne simule rien : elle assemble ce que le serveur
 * consent à lui montrer. C'est l'autre moitié du pivot — le laboratoire est à
 * vous, ce monde-ci est à tout le monde.
 */
export default function VoxelWorldView() {
  const world = useVoxelWorld();

  // Hooks de test pilotés (dev uniquement).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__world = {
      connected: world.connected,
      error: world.error,
      aggregates: world.aggregates,
      chunkCount: world.chunks.size,
      bodyCount: world.bodies.size,
      organismCount: world.organisms.length,
      gods: world.gods,
      eye: world.eye,
      bytesReceived: world.bytesReceived,
      champion: world.champion,
      lastRelease: world.lastRelease,
      lookAt: world.lookAt,
      release: world.release,
    };
  });

  return (
    <div style={{ position: "relative", height: "100%", background: "#0b0e14" }}>
      <Canvas camera={{ position: [0, SY * 2.4, SX * 0.9], fov: 50 }}>
        <VoxelWorldScene world={world} />
      </Canvas>
      <VoxelWorldHud world={world} />
      {!world.aggregates && !world.error && (
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
          Connexion au monde commun…
        </div>
      )}
    </div>
  );
}
