import { useEffect, useState } from "react";
import { DIVINE_WORD_MAX_CHARS } from "@devot/shared";
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

      <SocialPanel world={world} />
      <MindPanel world={world} />

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
        <div style={{ marginTop: 10, fontSize: 11, opacity: 0.6 }}>
          Touche <b>1</b> : mode god {world.godMode ? "(actif)" : "(inactif)"} — poser du terrain,
          de la biomasse, faire naître. Le serveur l'autorise ou non, pas le client.
        </div>
      </div>
    </>
  );
}


/**
 * LES POUVOIRS DIVINS et la mémoire du monde. Les cooldowns affichés viennent
 * du serveur : le client les montre, il ne les décide pas.
 */
function SocialPanel({ world }: { world: VoxelWorldClient }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    world.askRegistry();
    const t = setInterval(() => world.askRegistry(), 8000);
    return () => clearInterval(t);
  }, [world.connected]);

  const target = world.organisms.find((o) => o.id === world.selected) ?? world.organisms[0];
  void now;

  return (
    <div style={{ ...panel, top: 190, right: 14, width: 250, maxHeight: 420, overflowY: "auto" }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Pouvoirs</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button
          style={btn()}
          onClick={() => world.divine("feed", { x: world.eye.x, z: world.eye.z })}
        >
          🌾 nourrir
        </button>
        <button
          style={btn()}
          onClick={() => target && world.divine("protect", { organismId: target.id })}
          disabled={!target}
        >
          🛡 protéger
        </button>
        <button
          style={btn()}
          onClick={() =>
            world.divine(
              "smite",
              target
                ? { organismId: target.id }
                : { x: world.eye.x, z: world.eye.z },
            )
          }
          disabled={!target}
        >
          ⚡ foudroyer
        </button>
      </div>
      {world.lastDivine && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: world.lastDivine.ok ? "#7dbc5e" : "#e0634c",
          }}
        >
          {world.lastDivine.ok
            ? `${world.lastDivine.power} : fait.`
            : `${world.lastDivine.power} refusé — ${world.lastDivine.reason}` +
              (world.lastDivine.cooldownMs
                ? ` (${Math.ceil(world.lastDivine.cooldownMs / 1000)} s)`
                : "")}
        </div>
      )}

      <div style={{ fontWeight: 700, margin: "12px 0 6px" }}>Lignées</div>
      {(world.registry?.lineages.length ?? 0) === 0 && (
        <div style={{ fontSize: 11, opacity: 0.6 }}>aucune lignée relâchée</div>
      )}
      {world.registry?.lineages.map((l) => (
        <div key={l.id} style={{ fontSize: 11, opacity: 0.9 }}>
          {l.name} — {l.born} nés, {l.died} morts, gén. {l.maxGeneration}
        </div>
      ))}

      <div style={{ fontWeight: 700, margin: "12px 0 6px" }}>Pierres tombales</div>
      {(world.registry?.tombstones.length ?? 0) === 0 && (
        <div style={{ fontSize: 11, opacity: 0.6 }}>personne n'est encore mort</div>
      )}
      {world.registry?.tombstones.slice(0, 8).map((t) => (
        <div key={`${t.organismId}-${t.diedTick}`} style={{ fontSize: 11, opacity: 0.85 }}>
          🪦 #{t.organismId} · gén {t.generation} · {t.cause}
          {t.crossbred ? " · croisé" : ""} · a vécu {t.diedTick - t.bornTick} ticks
        </div>
      ))}
    </div>
  );
}

/**
 * LE PANNEAU ESPRIT. Un éveillé pense avec Claude, et chaque pensée lui coûte
 * de l'énergie — c'est écrit ici, tick par tick, parce que c'est le cœur du
 * jeu : penser coûte la vie.
 */
function MindPanel({ world }: { world: VoxelWorldClient }) {
  const [text, setText] = useState("");
  const target = world.organisms.find((o) => o.id === world.selected) ?? world.organisms[0];
  const mine = world.thoughts.filter((t) => t.organismId === (target?.id ?? -1));
  const last = mine.at(-1);

  useEffect(() => {
    if (target) world.askJournal(target.id);
  }, [target?.id, world.thoughts.length]);

  return (
    <div style={{ ...panel, bottom: 14, left: 360, width: 340, maxHeight: 380, overflowY: "auto" }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        Esprit {target ? `— organisme #${target.id}` : ""}
      </div>
      {!target && <div style={{ fontSize: 12, opacity: 0.6 }}>aucun organisme en vue</div>}
      {target && (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button style={btn(true)} onClick={() => world.awaken(target.id)}>
              ✨ éveiller
            </button>
            <button style={btn()} onClick={() => world.select(target.id)}>
              suivre
            </button>
          </div>
          {world.lastAwaken && (
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: world.lastAwaken.ok ? "#7dbc5e" : "#e0634c",
              }}
            >
              {world.lastAwaken.ok
                ? "Il est éveillé. Chacune de ses pensées lui coûtera de l'énergie."
                : `Refusé — ${world.lastAwaken.reason}`}
            </div>
          )}

          {last && (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              <div style={{ fontStyle: "italic" }}>« {last.monologue} »</div>
              <div style={{ opacity: 0.7, fontSize: 11, marginTop: 2 }}>
                intention : {last.intent} · {last.energyCost} d'énergie ·{" "}
                {last.inputTokens}+{last.outputTokens} tokens
              </div>
            </div>
          )}

          <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
            <input
              value={text}
              maxLength={DIVINE_WORD_MAX_CHARS}
              onChange={(e) => setText(e.target.value)}
              placeholder={`parler (${DIVINE_WORD_MAX_CHARS} car., 1/min)`}
              style={{
                flex: 1,
                background: "#131924",
                border: "1px solid #2a3245",
                borderRadius: 8,
                color: "#dde3ee",
                padding: "5px 8px",
                font: "12px system-ui, sans-serif",
              }}
            />
            <button
              style={btn()}
              onClick={() => {
                world.speak(target.id, text);
                setText("");
              }}
            >
              dire
            </button>
          </div>
          {world.lastWord && !world.lastWord.ok && (
            <div style={{ marginTop: 4, fontSize: 11, color: "#e0634c" }}>
              {world.lastWord.reason}
              {world.lastWord.cooldownMs
                ? ` (${Math.ceil(world.lastWord.cooldownMs / 1000)} s)`
                : ""}
            </div>
          )}

          {(world.journal?.entries.length ?? 0) > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>
                Journal ({world.journal?.mind}) — {world.journal?.entries.length} pensées
              </div>
              {world.journal?.entries.slice(-6).map((e, k) => (
                <div key={k} style={{ fontSize: 11, opacity: 0.8, marginBottom: 3 }}>
                  t{e.tick} · {e.monologue} <span style={{ opacity: 0.6 }}>(−{e.energyCost})</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
