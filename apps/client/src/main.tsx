import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import App from "./App.js";
import Lab from "./lab/Lab.js";

/**
 * Deux vues, deux natures :
 * - le LABORATOIRE (P5.2) : monde privé, accéléré, où l'on fait évoluer ses
 *   lignées et d'où l'on exporte un génome ;
 * - le MONDE (jeu Devot LLM actuel ; sera remplacé par le monde commun voxel
 *   en P5.3, où le serveur reste autoritaire).
 */
type View = "lab" | "world";

function initialView(): View {
  const q = new URLSearchParams(location.search).get("view");
  if (q === "world") return "world";
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
      {view === "lab" ? <Lab /> : <App />}
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
            ["world", "🌍 Monde"],
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
