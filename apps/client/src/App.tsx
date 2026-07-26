import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useReducer, useRef, type CSSProperties } from "react";
import { EntityView } from "./EntityView";
import { makeWorld, stepWorld, type Entity } from "./world";

function Ticker({ world }: { world: Entity[] }) {
  useFrame((_, dt) => stepWorld(world, Math.min(dt, 0.05)));
  return null;
}

export default function App() {
  const world = useRef<Entity[]>(makeWorld());
  const [, force] = useReducer((x: number) => x + 1, 0);

  // Motion is per-frame (refs); bubble TEXT only needs a low-frequency refresh.
  useEffect(() => {
    const id = setInterval(force, 200);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <div style={hud}>
        <strong>Devot — monde</strong>
        <div style={{ opacity: 0.7, fontSize: 12 }}>
          la pensée flotte au-dessus de chaque devot · les agents se déplacent en ligne droite (pas de rotation en rond)
        </div>
      </div>
      <Canvas shadows camera={{ position: [0, 9, 16], fov: 50 }}>
        <color attach="background" args={["#0b1020"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[8, 14, 6]} intensity={1.15} castShadow shadow-mapSize={[1024, 1024]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[24, 24]} />
          <meshStandardMaterial color="#111a33" />
        </mesh>
        <gridHelper args={[24, 24, "#2b3b63", "#1b2440"]} position={[0, 0.02, 0]} />
        <Ticker world={world.current} />
        {world.current.map((e) => (
          <EntityView key={e.id} e={e} />
        ))}
        <OrbitControls target={[0, 1, 0]} enablePan={false} maxPolarAngle={Math.PI / 2.1} minDistance={6} maxDistance={30} />
      </Canvas>
    </>
  );
}

const hud: CSSProperties = {
  position: "absolute",
  top: 14,
  left: 16,
  zIndex: 10,
  color: "#e2e8f0",
  pointerEvents: "none",
};
