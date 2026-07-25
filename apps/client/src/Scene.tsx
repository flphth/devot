import { Billboard, Grid, Html, OrbitControls } from "@react-three/drei";
import type { DevotView, FoodView, GodView, WorldSnapshot } from "./useWorld.js";

const FOOD_COLORS: Record<string, string> = {
  grain: "#d8c46a",
  fruit: "#e0634c",
  manne: "#9fe8ff",
  corrompu: "#7a4ce0",
};

function Devot({
  devot,
  color,
  selected,
  onSelect,
}: {
  devot: DevotView;
  color: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const dead = devot.state === "mort";
  const ratio = devot.hpMax > 0 ? devot.hp / devot.hpMax : 0;
  const bubble = devot.thinking ? "…" : devot.utterance;

  return (
    <group position={[devot.x, 0, devot.z]}>
      <mesh
        position={[0, dead ? 0.15 : 0.55, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(devot.id);
        }}
      >
        {dead ? (
          <boxGeometry args={[0.5, 0.3, 0.5]} />
        ) : (
          <capsuleGeometry args={[0.3, 0.6, 6, 12]} />
        )}
        <meshStandardMaterial
          color={dead ? "#555a63" : color}
          emissive={selected ? color : "#000000"}
          emissiveIntensity={selected ? 0.5 : 0}
        />
      </mesh>
      {!dead && (
        <Billboard position={[0, 1.45, 0]}>
          {/* jauge de vie */}
          <mesh position={[-(1 - ratio) * 0.4, 0, 0]}>
            <planeGeometry args={[Math.max(0.02, ratio * 0.8), 0.08]} />
            <meshBasicMaterial
              color={ratio > 0.4 ? "#5ee07a" : ratio > 0.15 ? "#e0b34c" : "#e0634c"}
            />
          </mesh>
        </Billboard>
      )}
      {bubble ? (
        <Html position={[0, 1.9, 0]} center distanceFactor={18} style={{ pointerEvents: "none" }}>
          <div
            style={{
              background: "rgba(255,255,255,0.92)",
              color: "#1c2028",
              borderRadius: 10,
              padding: "4px 10px",
              maxWidth: 220,
              font: "12px/1.35 system-ui, sans-serif",
              whiteSpace: "pre-wrap",
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}
          >
            {bubble}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

function Food({ food }: { food: FoodView }) {
  return (
    <mesh position={[food.x, 0.18, food.z]}>
      {food.kind === "manne" ? (
        <icosahedronGeometry args={[0.28]} />
      ) : (
        <sphereGeometry args={[0.2, 10, 10]} />
      )}
      <meshStandardMaterial
        color={FOOD_COLORS[food.kind] ?? "#d8c46a"}
        emissive={food.kind === "manne" ? "#9fe8ff" : "#000000"}
        emissiveIntensity={food.kind === "manne" ? 0.6 : 0}
      />
    </mesh>
  );
}

export function Scene({
  snapshot,
  selectedId,
  onSelect,
}: {
  snapshot: WorldSnapshot;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const godColor = (godId: string): string =>
    snapshot.gods.find((g: GodView) => g.id === godId)?.color ?? "#cccccc";

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[20, 30, 10]} intensity={1.2} />
      <fog attach="fog" args={["#0b0e14", 45, 110]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={() => onSelect(null)}>
        <planeGeometry args={[120, 120]} />
        <meshStandardMaterial color="#151a24" />
      </mesh>
      <Grid
        args={[120, 120]}
        position={[0, 0.01, 0]}
        cellColor="#232a38"
        sectionColor="#2e3748"
        fadeDistance={90}
      />

      {snapshot.devots.map((d: DevotView) => (
        <Devot
          key={d.id}
          devot={d}
          color={godColor(d.godId)}
          selected={d.id === selectedId}
          onSelect={onSelect}
        />
      ))}
      {snapshot.food.map((f: FoodView) => (
        <Food key={f.id} food={f} />
      ))}

      <OrbitControls
        makeDefault
        maxPolarAngle={Math.PI / 2.2}
        minDistance={8}
        maxDistance={70}
      />
    </>
  );
}
