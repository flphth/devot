import { useState } from "react";
import { MATERIAL_NAMES } from "@devot/sim-voxel";
import { SPEED_STEPS } from "./protocol.js";
import type { LabState } from "./useLab.js";

const panel: React.CSSProperties = {
  position: "absolute",
  background: "rgba(11, 15, 23, 0.9)",
  border: "1px solid #26303e",
  borderRadius: 12,
  padding: 14,
  color: "#dde3ee",
  font: "13px/1.45 system-ui, sans-serif",
  backdropFilter: "blur(6px)",
};

const btn = (active = false): React.CSSProperties => ({
  padding: "5px 10px",
  borderRadius: 8,
  border: `1px solid ${active ? "#e0b34c" : "#2a3245"}`,
  background: active ? "#e0b34c" : "#131924",
  color: active ? "#10131a" : "#aeb8c9",
  cursor: "pointer",
  fontWeight: active ? 700 : 400,
  fontSize: 12,
});

function fmt(n: number, d = 1): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Petite courbe en SVG, sans dépendance de graphique. */
function Spark({
  values,
  color,
  label,
  height = 34,
}: {
  values: number[];
  color: string;
  label: string;
  height?: number;
}) {
  if (values.length < 2) {
    return <div style={{ opacity: 0.4, fontSize: 11 }}>{label} — en cours…</div>;
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const w = 240;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: 0.7 }}>
        <span>{label}</span>
        <span style={{ color }}>{fmt(values[values.length - 1]!)}</span>
      </div>
      <svg width={w} height={height} style={{ display: "block" }}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
      </svg>
    </div>
  );
}

export function LabHud({ lab }: { lab: LabState }) {
  const { stats, history, inspected, conformity, logs, exported, actions } = lab;
  const [speedIdx, setSpeedIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [seedText, setSeedText] = useState("20260725");

  const setSpeed = (idx: number): void => {
    setSpeedIdx(idx);
    actions.setSpeed(SPEED_STEPS[idx]!);
  };

  return (
    <>
      {/* Barre de contrôle : vitesse et graine */}
      <div style={{ ...panel, top: 14, left: 14, width: 286 }}>
        <div style={{ fontWeight: 800, letterSpacing: 0.4, marginBottom: 8 }}>
          🧪 LABORATOIRE
          <span style={{ float: "right", fontWeight: 400, fontSize: 11, opacity: 0.6 }}>
            {stats?.backend === "webgpu" ? "WebGPU" : "CPU"}
          </span>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => {
              const next = !paused;
              setPaused(next);
              actions.setPaused(next);
            }}
            style={btn(paused)}
          >
            {paused ? "▶ reprendre" : "⏸ pause"}
          </button>
          {SPEED_STEPS.map((s, i) => (
            <button key={s} onClick={() => setSpeed(i)} style={btn(i === speedIdx)}>
              ×{s}
            </button>
          ))}
        </div>

        <div style={{ opacity: 0.6, fontSize: 11, marginTop: 6 }}>
          {stats ? `${fmt(stats.ticksPerSecond, 0)} ticks/s réels` : "démarrage…"}
          {" · tick "}
          {stats?.tick.toLocaleString("fr-FR") ?? 0}
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <input
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            style={{
              flex: 1,
              padding: "5px 8px",
              borderRadius: 8,
              border: "1px solid #2a3245",
              background: "#0e131c",
              color: "#dde3ee",
              fontSize: 12,
            }}
          />
          <button onClick={() => actions.reseed(Number(seedText) || 1, 160)} style={btn()}>
            nouveau monde
          </button>
        </div>
      </div>

      {/* Courbes */}
      <div style={{ ...panel, top: 14, right: 14, width: 268 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Émergence</div>
        {stats && (
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            {stats.population} vivants · génération max {stats.maxGeneration} (moy.{" "}
            {fmt(stats.avgGeneration)})
            <br />
            corps {fmt(stats.avgBodyVoxels)} voxels · bouches {fmt(stats.avgMouths, 2)} · muscles{" "}
            {fmt(stats.avgMuscles, 2)}
            <br />
            yeux {fmt(stats.avgEyes, 2)} · neurones {fmt(stats.avgNeurons, 2)}
          </div>
        )}
        <Spark values={history.map((h) => h.population)} color="#4ce07a" label="population" />
        <Spark values={history.map((h) => h.maxGeneration)} color="#e0b34c" label="génération max" />
        <Spark
          values={history.map((h) => h.avgIntakeRate)}
          color="#e0634c"
          label="ingestion / tick"
        />
        <Spark values={history.map((h) => h.biomassVoxels)} color="#7dbc5e" label="biomasse" />
      </div>

      {/* Inspecteur + sélection artificielle */}
      {inspected && (
        <div style={{ ...panel, bottom: 14, left: 14, width: 300 }}>
          <div style={{ fontWeight: 700 }}>
            Organisme #{inspected.id}{" "}
            <span style={{ opacity: 0.6, fontWeight: 400 }}>
              génération {inspected.generation}
            </span>
          </div>
          <div style={{ fontSize: 12, marginTop: 4, opacity: 0.9 }}>
            énergie {inspected.energy.toLocaleString("fr-FR")} /{" "}
            {inspected.capacity.toLocaleString("fr-FR")} · âge {inspected.age} ticks
            <br />
            corps {inspected.bodyVoxels} voxels · {inspected.mouths} bouche(s),{" "}
            {inspected.muscles} muscle(s), {inspected.eyes} œil/yeux, {inspected.neurons} neurone(s)
            <br />
            ingéré {inspected.eaten.toLocaleString("fr-FR")} · parcouru {inspected.distance} voxels
            <br />
            cerveau : {inspected.weightCount} poids · seuil de repro{" "}
            {(inspected.reproThreshold / 10).toFixed(0)} %
          </div>
          <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
            plan :{" "}
            {inspected.planTypes
              .map((t) => MATERIAL_NAMES[t] ?? "?")
              .join(", ")}
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => actions.protect(inspected.id, !inspected.protected)}
              style={btn(inspected.protected)}
            >
              {inspected.protected ? "🛡 protégé" : "🛡 protéger"}
            </button>
            <button onClick={() => actions.breed(inspected.id)} style={btn()}>
              🐣 croiser
            </button>
            <button onClick={() => actions.kill(inspected.id)} style={btn()}>
              ⚡ éliminer
            </button>
            <button onClick={() => actions.exportGenome(inspected.id)} style={btn()}>
              💾 exporter le génome
            </button>
          </div>
          {exported && exported.organismId === inspected.id && (
            <div
              style={{
                fontSize: 11,
                marginTop: 6,
                color: exported.valid ? "#7dbc5e" : "#e0634c",
              }}
            >
              Génome exporté : {exported.bytes} octets —{" "}
              {exported.valid
                ? "valide pour le monde commun"
                : "REFUSÉ par la validation du monde"}
            </div>
          )}
        </div>
      )}

      {/* Conformité CPU ↔ GPU */}
      <div style={{ ...panel, bottom: 14, right: 14, width: 300 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Conformité CPU ↔ GPU</div>
        <button onClick={() => actions.runConformity(120)} style={btn()}>
          vérifier sur 120 ticks
        </button>
        {conformity && (
          <div style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
            <div>
              CPU <code>{conformity.cpuHash.toString(16)}</code>
              {" · GPU "}
              <code>{conformity.gpuHash?.toString(16) ?? "—"}</code>
            </div>
            <div
              style={{
                marginTop: 4,
                color: conformity.identical
                  ? "#7dbc5e"
                  : conformity.gpuAvailable
                    ? "#e0634c"
                    : "#e0b34c",
              }}
            >
              {conformity.detail}
            </div>
          </div>
        )}
        {logs.length > 0 && (
          <div
            style={{
              marginTop: 8,
              maxHeight: 96,
              overflowY: "auto",
              fontSize: 11,
              opacity: 0.6,
              borderTop: "1px solid #26303e",
              paddingTop: 6,
            }}
          >
            {logs.slice(-6).map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
