import { Canvas } from "@react-three/fiber";
import { useMemo, useState } from "react";
import { Hud } from "./Hud.js";
import { Scene } from "./Scene.js";
import { useWorld } from "./useWorld.js";

function godNameFromUrl(): string {
  const fromUrl = new URLSearchParams(location.search).get("god");
  if (fromUrl) return fromUrl;
  const stored = localStorage.getItem("devot.godName");
  if (stored) return stored;
  const name = `Dieu-${Math.random().toString(36).slice(2, 6)}`;
  localStorage.setItem("devot.godName", name);
  return name;
}

export default function App() {
  const godName = useMemo(godNameFromUrl, []);
  const { snapshot, godId, status, lastRejection, actions } = useWorld(godName);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = snapshot.devots.find((d) => d.id === selectedId) ?? null;

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <Canvas camera={{ position: [0, 22, 26], fov: 50 }}>
        <Scene snapshot={snapshot} selectedId={selectedId} onSelect={setSelectedId} />
      </Canvas>
      <Hud
        snapshot={snapshot}
        godId={godId}
        selected={selected}
        actions={actions}
        rejection={lastRejection}
      />
      {status !== "connected" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "#dde3ee",
            font: "16px system-ui, sans-serif",
            background: "rgba(11,14,20,0.8)",
          }}
        >
          {status === "connecting"
            ? "Ascension vers le monde…"
            : "Le monde est inaccessible. Le serveur tourne-t-il ? (pnpm --filter @devot/server dev)"}
        </div>
      )}
    </div>
  );
}
