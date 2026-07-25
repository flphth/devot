import { useEffect, useState } from "react";
import { DIVINE_MSG_COOLDOWN_MS, DIVINE_MSG_MAX_CHARS } from "@devot/shared";
import type { DevotView, WorldActions, WorldSnapshot } from "./useWorld.js";

const panel: React.CSSProperties = {
  position: "absolute",
  background: "rgba(13, 17, 26, 0.88)",
  border: "1px solid #2a3245",
  borderRadius: 12,
  padding: 14,
  color: "#dde3ee",
  font: "13px/1.45 system-ui, sans-serif",
  backdropFilter: "blur(6px)",
};

export function Hud({
  snapshot,
  godId,
  selected,
  actions,
  rejection,
}: {
  snapshot: WorldSnapshot;
  godId: string | null;
  selected: DevotView | null;
  actions: WorldActions;
  rejection: string | null;
}) {
  const [text, setText] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const god = snapshot.gods.find((g) => g.id === godId);
  const myDevots = snapshot.devots.filter((d) => d.godId === godId);
  const hasLiving = myDevots.some((d) => d.state !== "mort");
  const cooldownLeft = god
    ? Math.max(0, DIVINE_MSG_COOLDOWN_MS - (now - god.lastSpeakAt))
    : 0;
  const canSpeak = cooldownLeft === 0 && selected && selected.godId === godId && selected.state !== "mort";

  const send = () => {
    if (!selected || !text.trim()) return;
    actions.speak(selected.id, text.trim());
    setText("");
  };

  return (
    <>
      {/* Panthéon / création */}
      <div style={{ ...panel, top: 14, left: 14, minWidth: 220 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          {god ? `⚡ ${god.name}` : "Connexion…"}
        </div>
        {!hasLiving && (
          <button
            onClick={() => actions.createFounder()}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "none",
              background: god?.color ?? "#4ca6e0",
              color: "#10131a",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Façonner ton devot fondateur
          </button>
        )}
        {myDevots.map((d) => (
          <div key={d.id} style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>
                {d.state === "mort" ? "☠ " : d.thinking ? "💭 " : ""}
                {d.name}
              </span>
              <span style={{ opacity: 0.7 }}>{d.state}</span>
            </div>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: "#232a38",
                marginTop: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${d.hpMax > 0 ? (d.hp / d.hpMax) * 100 : 0}%`,
                  background:
                    d.hp / d.hpMax > 0.4
                      ? "#5ee07a"
                      : d.hp / d.hpMax > 0.15
                        ? "#e0b34c"
                        : "#e0634c",
                  transition: "width .3s",
                }}
              />
            </div>
            <div style={{ opacity: 0.6, fontSize: 11, marginTop: 2 }}>
              {Math.round(d.hp)} / {d.hpMax} HP — {(d.hp / 1e6).toFixed(4)} $ de pensée
            </div>
          </div>
        ))}
      </div>

      {/* Devot sélectionné : verbe divin + nourrir */}
      {selected && (
        <div style={{ ...panel, bottom: 14, left: "50%", transform: "translateX(-50%)", width: 420 }}>
          <div style={{ marginBottom: 6 }}>
            <b>{selected.name}</b>{" "}
            <span style={{ opacity: 0.65 }}>
              ({selected.state}, {selected.age} cycles
              {selected.emotion ? `, ${selected.emotion}` : ""})
            </span>
          </div>
          {selected.godId === godId ? (
            <>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={text}
                  maxLength={DIVINE_MSG_MAX_CHARS}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && canSpeak && send()}
                  placeholder={
                    cooldownLeft > 0
                      ? `Ta voix se repose (${Math.ceil(cooldownLeft / 1000)} s)…`
                      : "Parle à ton devot (140 caractères, il t'en coûtera sa vie)…"
                  }
                  disabled={!canSpeak}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #2a3245",
                    background: "#10141d",
                    color: "#dde3ee",
                  }}
                />
                <button
                  onClick={send}
                  disabled={!canSpeak || !text.trim()}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "none",
                    background: canSpeak ? "#e0b34c" : "#2a3245",
                    color: "#10131a",
                    fontWeight: 700,
                    cursor: canSpeak ? "pointer" : "default",
                  }}
                >
                  🗣
                </button>
                <button
                  onClick={() => actions.feed(selected.id)}
                  title="Déposer de la nourriture près de lui"
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "none",
                    background: "#5ee07a",
                    color: "#10131a",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  🍞
                </button>
              </div>
              <div style={{ opacity: 0.55, fontSize: 11, marginTop: 5 }}>
                {text.length}/{DIVINE_MSG_MAX_CHARS} — une parole par minute. Le silence
                est parfois le plus grand des cadeaux.
              </div>
            </>
          ) : (
            <div style={{ opacity: 0.65 }}>Ce devot appartient à un autre dieu.</div>
          )}
        </div>
      )}

      {rejection && (
        <div
          style={{
            ...panel,
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            borderColor: "#e0634c",
            color: "#ffb3a7",
          }}
        >
          {rejection}
        </div>
      )}
    </>
  );
}
