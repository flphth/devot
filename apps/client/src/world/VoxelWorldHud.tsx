import { SX, SZ } from "@devot/sim-voxel";
import type { VoxelWorldClient } from "./useVoxelWorld.js";

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

const btn = (primary = false): React.CSSProperties => ({
  padding: "6px 12px",
  borderRadius: 8,
  border: `1px solid ${primary ? "#e0b34c" : "#2a3245"}`,
  background: primary ? "#e0b34c" : "#131924",
  color: primary ? "#10131a" : "#aeb8c9",
  cursor: "pointer",
  font: "12px system-ui, sans-serif",
});

export function VoxelWorldHud({ world }: { world: VoxelWorldClient }) {
  const a = world.aggregates;

  return (
    <>
      <div style={{ ...panel, top: 14, left: 14, width: 300 }}>
        <div style={{ fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
          <span>🌍 MONDE COMMUN</span>
          <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 11 }}>
            {world.connected ? "connecté" : "hors ligne"}
          </span>
        </div>
        {world.error && (
          <div style={{ marginTop: 8, color: "#e0634c", fontSize: 12 }}>{world.error}</div>
        )}
        {a && (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9 }}>
            tick {a.tick.toLocaleString("fr-FR")} · {a.population} vivants · génération max{" "}
            {a.maxGeneration}
            <br />
            corps {a.avgBodyVoxels.toFixed(2)} voxels · neurones {a.avgNeurons.toFixed(2)}
            <br />
            biomasse {a.biomass.toLocaleString("fr-FR")} voxels
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: 11, opacity: 0.65 }}>
          Le serveur simule ce monde en continu, pour tout le monde à la fois. Vous n'en recevez
          que ce que vous pouvez voir : {world.chunks.size} chunks de terrain et{" "}
          {world.organisms.length} organismes, soit {(world.bytesReceived / 1024).toFixed(1)} Ko
          depuis votre arrivée — la grille entière en pèserait 512.
        </div>
      </div>

      <div style={{ ...panel, top: 14, right: 14, width: 250 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Dieux présents</div>
        {world.gods.length === 0 && <div style={{ opacity: 0.6, fontSize: 12 }}>personne</div>}
        {world.gods.map((g) => (
          <div key={g.id} style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: g.color,
                display: "inline-block",
              }}
            />
            {g.name} — {g.living} vivant(s) sur {g.released} lâché(s)
          </div>
        ))}
      </div>

      <div style={{ ...panel, bottom: 14, left: 14, width: 330 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Relâcher une créature</div>
        {world.champion ? (
          <div style={{ fontSize: 12, opacity: 0.9 }}>
            Champion du laboratoire : organisme #{world.champion.organismId}, génome de{" "}
            {Math.round((world.champion.genome.length * 3) / 4)} octets.
          </div>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Aucun génome en réserve. Passez au laboratoire, sélectionnez un individu et exportez
            son génome : c'est la seule chose qui voyage jusqu'ici.
          </div>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button
            style={btn(true)}
            onClick={world.release}
            disabled={!world.champion || !world.connected}
          >
            🌱 relâcher dans le monde
          </button>
        </div>
        {world.lastRelease && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: world.lastRelease.ok ? "#7dbc5e" : "#e0634c",
            }}
          >
            {world.lastRelease.ok
              ? `Née : organisme #${world.lastRelease.organismId}. Elle paiera son métabolisme comme les autres.`
              : `Refusé par le serveur : ${world.lastRelease.reason}`}
          </div>
        )}
      </div>

      <div style={{ ...panel, bottom: 14, right: 14, width: 260 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Où regardez-vous</div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          ({world.eye.x}, {world.eye.z}) — le cercle doré marque la limite de ce que le serveur
          vous transmet.
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {(
            [
              ["nord-ouest", 24, 24],
              ["centre", SX >> 1, SZ >> 1],
              ["sud-est", SX - 24, SZ - 24],
            ] as const
          ).map(([label, x, z]) => (
            <button key={label} style={btn()} onClick={() => world.lookAt(x, z)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
