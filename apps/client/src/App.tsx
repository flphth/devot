import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { CreationScreen } from "./creation/CreationScreen.js";
import { useWallet } from "./wallet.js";
import { Hud } from "./Hud.js";
import { Scene } from "./Scene.js";
import { useWorld } from "./useWorld.js";
import type { SpawnKind } from "@devot/shared";
import { LangPicker, useT } from "./i18n.js";

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
  const { t } = useT();
  const wallet = useWallet();
  const godName = useMemo(godNameFromUrl, []);
  const {
    snapshot,
    thoughtFeed,
    creatingStage,
    godId,
    status,
    lastRejection,
    lastSmite,
    combats,
    journals,
    actions,
  } = useWorld(godName);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [godMode, setGodMode] = useState(false);
  // What the next god-mode click brings into the world. Mirrored in a ref for
  // the same reason as godMode: the R3F handler must not wait for a commit.
  const [spawnKind, setSpawnKind] = useState<SpawnKind>("devot");
  const spawnKindRef = useRef<SpawnKind>("devot");
  // Synchronous ref: R3F handlers read it without depending on the React<->canvas
  // bridge commit (which can delay a prop update by a frame).
  const godModeRef = useRef(false);

  const selected = snapshot.devots.find((d) => d.id === selectedId) ?? null;

  // The creation screen takes over as long as the god has no living devot:
  // it is the first contact with the game, and the only moment of shaping.
  const god = snapshot.gods.find((g) => g.id === godId) ?? null;
  const hasLiving = snapshot.devots.some((d) => d.godId === godId && d.state !== "dead");
  /**
   * ESCAPE OPENS THE CREATION SCREEN, AND CLOSES IT AGAIN.
   *
   * It used to appear only when a god had nobody left, which meant a player who
   * simply wanted to look at it — at the traits, at the signature, at what a
   * different body would cost — had to wait for their whole line to die.
   *
   * It stays forced open only while it is asked for. The moment a line is
   * extinct it comes back on its own, exactly as before, and Escape cannot
   * dismiss it then: there is nothing behind it to go back to.
   */
  const [creationAsked, setCreationAsked] = useState(false);
  const creating = status === "connected" && godId !== null && (!hasLiving || creationAsked);

  /**
   * Look at the founder the moment it is born.
   *
   * The player has just spent a whole screen shaping this creature, and the
   * world is sixty units across — without this it appears somewhere off-camera
   * and the first thing the game does is lose it. Selecting it also opens its
   * Mind panel, which is where the point of the game actually is.
   *
   * Fires once per founder, tracked by id: after that the camera is the
   * player's again, and deselecting must not snap straight back.
   */
  const focused = useRef(new Set<string>());
  useEffect(() => {
    const founder = snapshot.devots.find(
      (d) => d.godId === godId && d.isFounder && d.state !== "dead",
    );
    if (!founder || focused.current.has(founder.id)) return;
    focused.current.add(founder.id);
    setSelectedId(founder.id);
  }, [snapshot.devots, godId]);

  // Driven-test hooks (dev only): state + programmable selection.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__devot = {
      snapshot,
      godId,
      godMode,
      creating,
      select: setSelectedId,
      createFounder: actions.createFounder,
      combats,
      // God-mode actions, exposed for driving: the only way to force an
      // encounter at will, the world being wide and wandering slow.
      spawnAt: actions.debugSpawnDevot,
    };
  });

  // Keys: 1 toggles god mode, Escape opens or closes the creation screen.
  // Both ignored while typing — Escape especially, since the soul field is a
  // textarea a player is very likely to be in when they hit it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "1") {
        setGodMode((g) => {
          godModeRef.current = !g;
          return !g;
        });
        return;
      }
      if (e.key === "Escape") setCreationAsked((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A birth closes the screen, however it was opened: the player asked for a
  // devot and got one, and leaving the panel up over it would hide the answer.
  useEffect(() => {
    if (hasLiving && creationAsked) setCreationAsked(false);
  }, [hasLiving, creationAsked]);

  // Journal of the selected devot: loaded on selection, then refreshed.
  useEffect(() => {
    if (!selectedId) return;
    actions.getJournal(selectedId);
    const t = setInterval(() => actions.getJournal(selectedId), 3000);
    return () => clearInterval(t);
  }, [selectedId, actions]);

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <LangPicker />
      <Canvas camera={{ position: [0, 22, 26], fov: 50 }}>
        <Scene
          snapshot={snapshot}
          godId={godId}
          selectedId={selectedId}
          godMode={godMode}
          godModeRef={godModeRef}
          lastSmite={lastSmite}
          combats={combats}
          onSelect={setSelectedId}
          onGroundClick={(x, z) =>
            spawnKindRef.current === "monster"
              ? actions.debugSpawnMonster(x, z)
              : actions.debugSpawnDevot(x, z)
          }
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
        spawnKind={spawnKind}
        onSpawnKind={(k) => {
          spawnKindRef.current = k;
          setSpawnKind(k);
        }}
        journal={selectedId ? (journals[selectedId] ?? []) : []}
        thoughtFeed={thoughtFeed}
        combats={combats}
      />
      {creating && (
        <CreationScreen
          dismissible={hasLiving}
          onClose={() => setCreationAsked(false)}
          paying={creatingStage === "paying"}
          godName={god?.name ?? godName}
          godColor={god?.color ?? "#4ca6e0"}
          rejection={lastRejection}
          wallet={wallet}
          onCreate={async (r) => {
            // The god signs the deposit themselves; the server is handed a hash
            // and goes and checks it. A refusal in the wallet stops here, and
            // the screen stays exactly where it was.
            const txHash = await wallet.payForDevot(`${godName}:${Date.now()}`);
            actions.createFounder({
              traits: r.traits,
              appearance: r.appearance,
              stats: r.stats,
              soul: r.soul,
              txHash,
            });
          }}
        />
      )}
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
          {t(status === "connecting" ? "app.connecting" : "app.unreachable")}
        </div>
      )}
    </div>
  );
}
