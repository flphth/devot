import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const { snapshot, godId, status, lastRejection, lastSmite, journals, actions } =
    useWorld(godName);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [godMode, setGodMode] = useState(false);
  // Ref synchrone : les handlers R3F la lisent sans dépendre du commit du
  // pont React↔canvas (qui peut retarder d'une frame la mise à jour des props).
  const godModeRef = useRef(false);

  const selected = snapshot.devots.find((d) => d.id === selectedId) ?? null;

  // Hooks de test pilotés (dev uniquement) : état + sélection programmable.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__devot = {
      snapshot,
      godId,
      godMode,
      select: setSelectedId,
    };
  });

  // Touche 1 : mode god (debug/créatif) — ignorée quand on tape du texte.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "1") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      setGodMode((g) => {
        godModeRef.current = !g;
        return !g;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Journal du devot sélectionné : chargé à la sélection puis rafraîchi.
  useEffect(() => {
    if (!selectedId) return;
    actions.getJournal(selectedId);
    const t = setInterval(() => actions.getJournal(selectedId), 3000);
    return () => clearInterval(t);
  }, [selectedId, actions]);

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <Canvas camera={{ position: [0, 22, 26], fov: 50 }}>
        <Scene
          snapshot={snapshot}
          godId={godId}
          selectedId={selectedId}
          godMode={godMode}
          godModeRef={godModeRef}
          lastSmite={lastSmite}
          onSelect={setSelectedId}
          onGroundClick={(x, z) => actions.debugSpawnDevot(x, z)}
          onFoodMove={(foodId, x, z) => actions.debugMoveFood(foodId, x, z)}
        />
      </Canvas>
      <Hud
        snapshot={snapshot}
        godId={godId}
        selected={selected}
        actions={actions}
        rejection={lastRejection}
        godMode={godMode}
        journal={selectedId ? (journals[selectedId] ?? []) : []}
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
