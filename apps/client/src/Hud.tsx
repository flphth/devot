import { useEffect, useState } from "react";
import {
  DIVINE_MSG_COOLDOWN_MS,
  DIVINE_MSG_MAX_CHARS,
  TRAIT_POOL,
  type JournalEntry,
} from "@devot/shared";
import type { CombatFx, DevotView, WorldActions, WorldSnapshot } from "./useWorld.js";

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

const ACTION_ICONS: Record<string, string> = {
  idle: "🧘",
  move: "🚶",
  eat: "🍽",
  attack: "⚔",
  reproduce: "🐣",
  speak: "🗣",
  flee: "🏃",
};

function TraitPicker({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (t: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {TRAIT_POOL.map((t) => {
        const on = selected.includes(t);
        return (
          <button
            key={t}
            onClick={() => onToggle(t)}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              border: `1px solid ${on ? "#e0b34c" : "#2a3245"}`,
              background: on ? "#e0b34c" : "#10141d",
              color: on ? "#10131a" : "#aeb8c9",
              fontWeight: on ? 700 : 400,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

function Journal({ entries }: { entries: JournalEntry[] }) {
  const items = [...entries].reverse(); // newest first
  return (
    <div
      style={{
        maxHeight: 260,
        overflowY: "auto",
        marginTop: 8,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        paddingRight: 4,
      }}
    >
      {items.length === 0 && (
        <div style={{ opacity: 0.5 }}>No memory yet. They have not lived.</div>
      )}
      {items.map((e, i) => (
        <div
          key={i}
          style={{
            borderLeft: `3px solid ${e.kind === "event" ? "#4ca6e0" : "#e0b34c"}`,
            paddingLeft: 8,
          }}
        >
          <div style={{ opacity: 0.45, fontSize: 10 }}>
            {new Date(e.at).toLocaleTimeString()}
          </div>
          {e.kind === "event" ? (
            <div style={{ fontSize: 12 }}>🌍 {e.text}</div>
          ) : (
            <div style={{ fontSize: 12 }}>
              <div>
                {ACTION_ICONS[e.action ?? ""] ?? "⚡"} <b>{e.action}</b>
                {e.emotion ? <span style={{ opacity: 0.65 }}> — {e.emotion}</span> : null}
              </div>
              {e.thought && (
                <div style={{ fontStyle: "italic", color: "#aeb8c9" }}>« {e.thought} »</div>
              )}
              {e.text && <div>🗣 « {e.text} »</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Hud({
  snapshot,
  godId,
  selected,
  actions,
  rejection,
  godMode,
  journal,
  combats,
}: {
  snapshot: WorldSnapshot;
  godId: string | null;
  selected: DevotView | null;
  actions: WorldActions;
  rejection: string | null;
  godMode: boolean;
  journal: JournalEntry[];
  combats: CombatFx[];
}) {
  const [text, setText] = useState("");
  const [now, setNow] = useState(Date.now());
  const [traits, setTraits] = useState<string[]>([]);
  const [confirmSmite, setConfirmSmite] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => setConfirmSmite(false), [selected?.id]);

  const god = snapshot.gods.find((g) => g.id === godId);
  const myDevots = snapshot.devots.filter((d) => d.godId === godId);
  const hasLiving = myDevots.some((d) => d.state !== "dead");
  const cooldownLeft = god
    ? Math.max(0, DIVINE_MSG_COOLDOWN_MS - (now - god.lastSpeakAt))
    : 0;
  const canSpeak =
    cooldownLeft === 0 && selected && selected.godId === godId && selected.state !== "dead";

  const toggleTrait = (t: string) =>
    setTraits((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : prev.length < 3 ? [...prev, t] : prev,
    );

  const send = () => {
    if (!selected || !text.trim()) return;
    actions.speak(selected.id, text.trim());
    setText("");
  };

  return (
    <>
      {godMode && (
        <div
          style={{
            ...panel,
            top: 14,
            right: 14,
            borderColor: "#e0b34c",
            color: "#e0b34c",
            fontWeight: 800,
            letterSpacing: 1,
          }}
        >
          ⚡ GOD MODE — click: spawn devot · drag food · fog off ·
          press 1 to exit
        </div>
      )}

      <CombatLog combats={combats} devots={snapshot.devots} />

      {/* Pantheon / creation */}
      <div style={{ ...panel, top: 14, left: 14, width: 250 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          {god ? `⚡ ${god.name}` : "Connecting…"}
        </div>
        {/* Creation now lives in its own full-screen, centred view
            (CreationScreen): this panel is nothing but the pantheon. */}
        {myDevots.map((d) => (
          <div key={d.id} style={{ marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>
                {d.state === "dead" ? "☠ " : d.thinking ? "💭 " : ""}
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
              {Math.round(d.hp)} / {d.hpMax} HP — ${(d.hp / 1e6).toFixed(4)} of thinking
            </div>
          </div>
        ))}
      </div>

      {/* Mind panel: the inner life of the selected devot */}
      {selected && (
        <div style={{ ...panel, top: 14, left: 280, width: 320 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <b>Esprit de {selected.name}</b>
            <span style={{ opacity: 0.6, fontSize: 11 }}>
              {selected.state}, {selected.age} cycles
            </span>
          </div>
          {selected.thought && (
            <div style={{ fontStyle: "italic", color: "#aeb8c9", marginTop: 4 }}>
              « {selected.thought} »
            </div>
          )}
          <Journal entries={journal} />
        </div>
      )}

      {/* Selected devot: divine word + feed + smite */}
      {selected && (
        <div style={{ ...panel, bottom: 14, left: "50%", transform: "translateX(-50%)", width: 470 }}>
          <div style={{ marginBottom: 6 }}>
            <b>{selected.name}</b>{" "}
            <span style={{ opacity: 0.65 }}>
              ({selected.state}
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
                      : "Speak to your devot (140 characters, it will cost them their life)…"
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
                    padding: "8px 12px",
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
                  title="Drop food near them"
                  style={{
                    padding: "8px 12px",
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
                {selected.state !== "dead" && (
                  <button
                    onClick={() => {
                      if (!confirmSmite) return setConfirmSmite(true);
                      actions.smite(selected.id);
                      setConfirmSmite(false);
                    }}
                    title="Smite your devot — their memory will be destroyed forever"
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: confirmSmite ? "1px solid #ff8c7a" : "none",
                      background: confirmSmite ? "#e0634c" : "#3a2430",
                      color: confirmSmite ? "#fff" : "#ff9a8a",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {confirmSmite ? "Confirmer ⚡" : "⚡"}
                  </button>
                )}
              </div>
              <div style={{ opacity: 0.55, fontSize: 11, marginTop: 5 }}>
                {confirmSmite
                  ? "⚠ Smiting is irreversible: their mind will be erased forever."
                  : `${text.length}/${DIVINE_MSG_MAX_CHARS} — one word per minute. Silence is sometimes the greatest gift of all.`}
              </div>
            </>
          ) : (
            <div style={{ opacity: 0.65 }}>This devot belongs to another god.</div>
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


/**
 * LE JOURNAL DES COMBATS.
 *
 * It does not merely list transfers: it says what they are. In this world HP
 * are the thinking budget — a devot spends its life every time it thinks. To
 * steal someone's life is therefore to steal their thinking time: they think
 * less, decide worse, and die. The player must understand that by watching,
 * not by reading the documentation.
 */
function CombatLog({ combats, devots }: { combats: CombatFx[]; devots: DevotView[] }) {
  if (combats.length === 0) return null;
  const nameOf = (id: string) => devots.find((d) => d.id === id)?.name ?? "a stranger";
  const recent = [...combats].slice(-6).reverse();
  const total = combats.reduce((sum, c) => sum + c.drained, 0);

  return (
    <div style={{ ...panel, bottom: 14, left: 14, width: 300 }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>⚔ Life theft</div>
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8, lineHeight: 1.35 }}>
        HP are the thinking budget. Taking a devot's life takes away their thinking time:
        they think less, decide worse, then die.
      </div>
      {recent.map((c) => (
        <div key={c.id} style={{ fontSize: 12, marginTop: 3 }}>
          <span style={{ color: c.lethal ? "#ff6b6b" : "#ffc76b", fontWeight: 700 }}>
            {c.drained.toLocaleString("fr-FR")}
          </span>{" "}
          <span style={{ opacity: 0.85 }}>
            {nameOf(c.attackerId)} → {nameOf(c.victimId)}
          </span>
          {c.lethal && <span style={{ color: "#ff6b6b" }}> ☠</span>}
        </div>
      ))}
      <div style={{ fontSize: 11, opacity: 0.55, marginTop: 8 }}>
        {total.toLocaleString("fr-FR")} HP changed hands before your eyes.
      </div>
    </div>
  );
}
