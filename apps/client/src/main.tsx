import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import App from "./App.js";
import Lab from "./lab/Lab.js";
import VoxelWorldView from "./world/VoxelWorldView.js";

/**
 * Deux natures, et c'est tout le pivot :
 * - le LABORATOIRE (P5.2) : votre monde privé, accéléré jusqu'à ×1000, où vous
 *   faites évoluer vos lignées et d'où vous n'exportez qu'un génome ;
 * - le MONDE COMMUN (P5.3) : l'unique monde autoritaire du serveur, simulé en
 *   continu pour tout le monde à la fois, où les lignées de chacun se dévorent
 *   et se reproduisent. Le client n'y simule rien.
 *
 * L'ancien jeu LLM (P0→P4) reste accessible par `?view=llm` ; le tag
 * v0.4-devot-llm en garde la version complète.
 */
type View = "lab" | "world" | "llm";

function initialView(): View {
  const q = new URLSearchParams(location.search).get("view");
  if (q === "world") return "world";
  if (q === "llm") return "llm";
  if (q === "lab") return "lab";
  return "lab";
}

function Root() {
  const [view, setView] = useState<View>(initialView);

  // Touche L / M pour basculer, sauf pendant la saisie de texte.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "l" || e.key === "L") setView("lab");
      if (e.key === "m" || e.key === "M") setView("world");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ height: "100%", position: "relative" }}>
      {view === "lab" ? <Lab /> : view === "world" ? <VoxelWorldView /> : <App />}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 6,
          background: "rgba(11,15,23,0.9)",
          border: "1px solid #26303e",
          borderRadius: 999,
          padding: 4,
          zIndex: 10,
        }}
      >
        {(
          [
            ["lab", "🧪 Laboratoire"],
            ["world", "🌍 Monde commun"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              padding: "5px 12px",
              borderRadius: 999,
              border: "none",
              background: view === v ? "#e0b34c" : "transparent",
              color: view === v ? "#10131a" : "#aeb8c9",
              fontWeight: view === v ? 700 : 400,
              cursor: "pointer",
              font: "12px system-ui, sans-serif",
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
