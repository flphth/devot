import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  BUILDS,
  CAPES,
  DEFAULT_APPEARANCE,
  DEFAULT_STATS,
  FACES,
  HATS,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_COLORS,
  SOUL_MAX_CHARS,
  STAT_BUDGET,
  STAT_KEYS,
  STAT_LABELS,
  STAT_MAX,
  STAT_MIN,
  TRAIT_POOL,
  signatureOf,
  statMultiplier,
  type Appearance,
  type Stats,
  type StatKey,
} from "@devot/shared";
import { DevotModel } from "./DevotModel.js";

/**
 * THE CREATION SCREEN — the first contact with the game.
 *
 * Full-screen and centred: this is not a settings panel, it is the moment a
 * being is shaped. Three columns — personality on the left, the creature in the
 * middle, appearance and body on the right — so the preview stays in sight the
 * whole time you are choosing.
 *
 * Everything chosen here is REVALIDATED by the server. This screen only helps
 * compose a legal request; it holds no authority.
 */

export interface CreationResult {
  traits: string[];
  appearance: Appearance;
  stats: Stats;
  soul: string;
}

const CARD: React.CSSProperties = {
  background: "rgba(14, 19, 28, 0.92)",
  border: "1px solid #26303e",
  borderRadius: 14,
  padding: 18,
};

export function CreationScreen({
  godName,
  godColor,
  rejection,
  onCreate,
}: {
  godName: string;
  godColor: string;
  rejection: string | null;
  onCreate: (result: CreationResult) => void;
}) {
  const [traits, setTraits] = useState<string[]>([]);
  const [soul, setSoul] = useState("");
  const [appearance, setAppearance] = useState<Appearance>({ ...DEFAULT_APPEARANCE });
  const [stats, setStats] = useState<Stats>({ ...DEFAULT_STATS });

  const spent = STAT_KEYS.reduce((sum, k) => sum + stats[k], 0);
  const left = STAT_BUDGET - spent;
  const ready = traits.length >= 2 && left === 0;
  const signature = useMemo(
    () => signatureOf(appearance, stats, traits, soul),
    [appearance, stats, traits, soul],
  );

  const toggleTrait = (t: string) =>
    setTraits((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : prev.length < 3 ? [...prev, t] : prev,
    );

  const set = <K extends keyof Appearance>(key: K, value: Appearance[K]) =>
    setAppearance((prev) => ({ ...prev, [key]: value }));

  const bump = (key: StatKey, delta: number) =>
    setStats((prev) => {
      const next = prev[key] + delta;
      if (next < STAT_MIN || next > STAT_MAX) return prev;
      if (delta > 0 && left <= 0) return prev;
      return { ...prev, [key]: next };
    });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "radial-gradient(circle at 50% 35%, #141b26 0%, #080b11 70%)",
        zIndex: 50,
        overflowY: "auto",
        padding: 24,
      }}
      data-testid="creation-screen"
    >
      <div style={{ width: "min(1180px, 96vw)" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div
            style={{
              font: "700 26px/1.2 system-ui, sans-serif",
              color: "#dde3ee",
              letterSpacing: 0.5,
            }}
          >
            Shape your founder
          </div>
          <div style={{ color: "#7f8a9c", font: "13px system-ui, sans-serif", marginTop: 6 }}>
            ⚡ {godName} — the first of your line. Everything you choose here follows them to the
            grave, and passes on to their descendants.
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(260px, 1fr) minmax(320px, 1.1fr) minmax(300px, 1fr)",
            gap: 16,
            alignItems: "start",
          }}
        >
          {/* ── Column 1: the soul ────────────────────────────────────────── */}
          <div style={CARD}>
            <SectionTitle>Their soul</SectionTitle>
            <Help>
              Two or three traits. They go literally into their head: these are what they will
              decide with.
            </Help>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {TRAIT_POOL.map((t) => (
                <Chip key={t} on={traits.includes(t)} onClick={() => toggleTrait(t)} color={godColor}>
                  {t}
                </Chip>
              ))}
            </div>

            <SectionTitle style={{ marginTop: 18 }}>What they believe they are</SectionTitle>
            <Help>
              One sentence, written by you, that they will carry as a conviction. It will be in
              their prompt at every thought.
            </Help>
            <textarea
              value={soul}
              maxLength={SOUL_MAX_CHARS}
              onChange={(e) => setSoul(e.target.value)}
              placeholder="&quot;I was born to protect my own&quot;"
              style={{
                width: "100%",
                marginTop: 8,
                minHeight: 68,
                resize: "vertical",
                background: "#0b0f16",
                border: "1px solid #2a3245",
                borderRadius: 10,
                color: "#dde3ee",
                padding: "8px 10px",
                font: "13px/1.4 system-ui, sans-serif",
              }}
            />
            <div style={{ textAlign: "right", color: "#5a6478", fontSize: 11 }}>
              {soul.length} / {SOUL_MAX_CHARS}
            </div>
          </div>

          {/* ── Column 2: the preview ─────────────────────────────────────── */}
          <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
            <div style={{ height: 380, background: "#0a0e15" }}>
              <Canvas camera={{ position: [0, 0.05, 2.9], fov: 40 }}>
                <hemisphereLight args={["#cfe3ff", "#1a1a20", 1.0]} />
                <directionalLight position={[3, 5, 3]} intensity={1.3} color="#fff3e2" />
                <directionalLight position={[-3, 2, -2]} intensity={0.4} color="#8fb6ff" />
                {/* The R3F camera looks straight ahead: we drop the scene so
                    the middle of the body falls on its axis, rather than
                    aiming at the top of the skull and cropping the head. */}
                <group position={[0, -0.62, 0]}>
                  <Turntable>
                    <DevotModel appearance={appearance} emissive={0.12} />
                  </Turntable>
                  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
                    <circleGeometry args={[1.1, 48]} />
                    <meshStandardMaterial color="#141a24" />
                  </mesh>
                </group>
              </Canvas>
            </div>
            <div style={{ padding: "12px 16px 16px" }}>
              <div
                style={{
                  font: "700 13px system-ui, sans-serif",
                  color: godColor,
                  letterSpacing: 1.5,
                }}
                data-testid="signature"
              >
                {signature}
              </div>
              <div style={{ color: "#7f8a9c", fontSize: 11, marginTop: 4 }}>
                Their signature — derived from each of your choices. Change one thing and it
                changes.
              </div>

              {rejection && (
                <div
                  style={{
                    marginTop: 12,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "rgba(224,99,76,0.12)",
                    border: "1px solid #e0634c",
                    color: "#e0634c",
                    fontSize: 12,
                  }}
                  data-testid="creation-rejection"
                >
                  The server refused: {rejection}
                </div>
              )}

              <button
                data-testid="create-founder"
                onClick={() => onCreate({ traits, appearance, stats, soul: soul.trim() })}
                disabled={!ready}
                style={{
                  width: "100%",
                  marginTop: 12,
                  padding: "11px 10px",
                  borderRadius: 10,
                  border: "none",
                  background: ready ? godColor : "#222a37",
                  color: ready ? "#10131a" : "#5a6478",
                  font: "700 14px system-ui, sans-serif",
                  cursor: ready ? "pointer" : "default",
                }}
              >
                {traits.length < 2
                  ? "Choose at least two traits"
                  : left !== 0
                    ? `${left} point${Math.abs(left) > 1 ? "s" : ""} left to spend`
                    : "Give them life"}
              </button>
            </div>
          </div>

          {/* ── Column 3: the body ────────────────────────────────────────── */}
          <div style={CARD}>
            <SectionTitle>Their look</SectionTitle>
            <Row label="Hat">
              <Options values={HATS} value={appearance.hat} onPick={(v) => set("hat", v)} color={godColor} />
            </Row>
            <Row label="Shirt">
              <Swatches values={SHIRT_COLORS} value={appearance.shirt} onPick={(v) => set("shirt", v)} />
            </Row>
            <Row label="Trousers">
              <Swatches values={PANTS_COLORS} value={appearance.pants} onPick={(v) => set("pants", v)} />
            </Row>
            <Row label="Skin">
              <Swatches values={SKIN_COLORS} value={appearance.skin} onPick={(v) => set("skin", v)} />
            </Row>
            <Row label="Cape">
              <Options values={CAPES} value={appearance.cape} onPick={(v) => set("cape", v)} color={godColor} />
            </Row>
            <Row label="Face">
              <Options values={FACES} value={appearance.face} onPick={(v) => set("face", v)} color={godColor} />
            </Row>
            <Row label="Build">
              <Options values={BUILDS} value={appearance.build} onPick={(v) => set("build", v)} color={godColor} />
            </Row>

            <SectionTitle style={{ marginTop: 18 }}>
              Their body —{" "}
              <span style={{ color: left === 0 ? "#7dbc5e" : godColor }}>
                {left} point{Math.abs(left) > 1 ? "s" : ""} to spend
              </span>
            </SectionTitle>
            <Help>
              A fixed budget: what you give here, you take from somewhere else. There is no devot
              who is good at everything.
            </Help>
            <div style={{ marginTop: 10 }}>
              {STAT_KEYS.map((k) => (
                <StatRow
                  key={k}
                  statKey={k}
                  value={stats[k]}
                  canRaise={left > 0 && stats[k] < STAT_MAX}
                  onBump={(d) => bump(k, d)}
                  color={godColor}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The preview turns slowly: you see the cape and the back without acting. */
function Turntable({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.45;
  });
  return (
    <group ref={ref} position={[0, 0, 0]}>
      {children}
    </group>
  );
}

function SectionTitle({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ font: "700 13px system-ui, sans-serif", color: "#dde3ee", ...style }}>
      {children}
    </div>
  );
}

function Help({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "#7f8a9c", font: "11px/1.45 system-ui, sans-serif", marginTop: 4 }}>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
      <div style={{ width: 78, color: "#8b95a6", fontSize: 11, flexShrink: 0 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{children}</div>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
  color,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${on ? color : "#2a3245"}`,
        background: on ? color : "#131924",
        color: on ? "#10131a" : "#aeb8c9",
        font: "12px system-ui, sans-serif",
        fontWeight: on ? 700 : 400,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Options<T extends string>({
  values,
  value,
  onPick,
  color,
}: {
  values: readonly T[];
  value: T;
  onPick: (v: T) => void;
  color: string;
}) {
  return (
    <>
      {values.map((v) => (
        <Chip key={v} on={v === value} onClick={() => onPick(v)} color={color}>
          {v}
        </Chip>
      ))}
    </>
  );
}

function Swatches({
  values,
  value,
  onPick,
}: {
  values: readonly string[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <>
      {values.map((hex) => (
        <button
          key={hex}
          onClick={() => onPick(hex)}
          aria-label={hex}
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: hex,
            border: hex === value ? "2px solid #ffffff" : "1px solid #2a3245",
            cursor: "pointer",
            padding: 0,
          }}
        />
      ))}
    </>
  );
}

function StatRow({
  statKey,
  value,
  canRaise,
  onBump,
  color,
}: {
  statKey: StatKey;
  value: number;
  canRaise: boolean;
  onBump: (delta: number) => void;
  color: string;
}) {
  const pct = Math.round(statMultiplier(value) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
      <div style={{ width: 62, color: "#aeb8c9", fontSize: 12 }}>{STAT_LABELS[statKey]}</div>
      <div style={{ display: "flex", gap: 3 }}>
        {Array.from({ length: STAT_MAX }, (_, i) => (
          <div
            key={i}
            style={{
              width: 16,
              height: 9,
              borderRadius: 2,
              background: i < value ? color : "#222a37",
            }}
          />
        ))}
      </div>
      <div style={{ color: "#5a6478", fontSize: 11, width: 42 }}>{pct} %</div>
      <button
        onClick={() => onBump(-1)}
        disabled={value <= STAT_MIN}
        style={stepBtn(value > STAT_MIN)}
        aria-label={`lower ${STAT_LABELS[statKey]}`}
      >
        −
      </button>
      <button
        onClick={() => onBump(1)}
        disabled={!canRaise}
        style={stepBtn(canRaise)}
        aria-label={`raise ${STAT_LABELS[statKey]}`}
      >
        +
      </button>
    </div>
  );
}

function stepBtn(enabled: boolean): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    borderRadius: 6,
    border: "1px solid #2a3245",
    background: enabled ? "#1b2230" : "#141a24",
    color: enabled ? "#dde3ee" : "#3d4655",
    cursor: enabled ? "pointer" : "default",
    font: "14px system-ui, sans-serif",
    lineHeight: 1,
    padding: 0,
  };
}
