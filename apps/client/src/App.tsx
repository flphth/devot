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
  // Synchronous ref: the R3F handlers read it without depending on the
  // React↔canvas bridge commit (which can delay prop updates by a frame).
  const godModeRef = useRef(false);

  const selected = snapshot.devots.find((d) => d.id === selectedId) ?? null;

  // Driven test hooks (dev only): state + programmable selection.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__devot = {
      snapshot,
      godId,
      godMode,
      select: setSelectedId,
    };
  });

  // Key 1: god mode (debug/creative) — ignored while typing text.
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

  // Journal of the selected devot: loaded on selection, then refreshed.
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
            ? "Ascending to the world…"
            : "The world is unreachable. Is the server running? (pnpm --filter @devot/server dev)"}
        </div>
      )}
    </div>
  );
}
