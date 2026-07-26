import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, type CSSProperties } from "react";
import type { Group } from "three";
import type { Entity } from "./world";

const BODY_H = 1.6;
const BUBBLE_Y = BODY_H + 0.7; // the thought floats ABOVE the head — never over the body

export function EntityView({ e }: { e: Entity }) {
  const group = useRef<Group>(null);

  // Per-frame: copy the world entity's transform onto the group. Position and a
  // held facing only — no continuous rotation, so the agent never spins.
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    g.position.set(e.x, 0, e.z);
    g.rotation.y = e.heading;
  });

  const isMonster = e.kind === "monster";
  const speaking = e.speakUntil > 0 && e.speech;

  return (
    <group ref={group}>
      {isMonster ? (
        <mesh position={[0, 0.9, 0]} castShadow>
          <icosahedronGeometry args={[0.9, 0]} />
          <meshStandardMaterial color={e.color} flatShading roughness={0.6} />
        </mesh>
      ) : (
        <>
          <mesh position={[0, 0.8, 0]} castShadow>
            <capsuleGeometry args={[0.38, 0.8, 6, 16]} />
            <meshStandardMaterial color={e.color} roughness={0.5} />
          </mesh>
          {/* a small "nose" showing which way it faces (+z) */}
          <mesh position={[0, 1.0, 0.42]}>
            <coneGeometry args={[0.1, 0.22, 12]} />
            <meshStandardMaterial color="#1e293b" />
          </mesh>
        </>
      )}

      {!isMonster && (
        <Html position={[0, BUBBLE_Y, 0]} center distanceFactor={11} occlude={false} zIndexRange={[10, 0]}>
          <div style={bubble(speaking ? "speech" : "thought")}>
            {speaking ? `« ${e.speech} »` : e.thought}
            <span style={tail(speaking ? "speech" : "thought")} />
          </div>
        </Html>
      )}
    </group>
  );
}

function bubble(kind: "thought" | "speech"): CSSProperties {
  const speech = kind === "speech";
  return {
    position: "relative",
    transform: "translateY(-50%)", // anchor the bubble ABOVE the point, tail pointing down at the head
    maxWidth: 180,
    padding: "7px 11px",
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 1.25,
    textAlign: "center",
    whiteSpace: "normal",
    background: speech ? "#fef9c3" : "#ffffff",
    color: "#0f172a",
    border: speech ? "1px solid #eab308" : "1px solid #cbd5e1",
    boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
    pointerEvents: "none",
    userSelect: "none",
    fontStyle: speech ? "italic" : "normal",
  };
}

function tail(kind: "thought" | "speech"): CSSProperties {
  const speech = kind === "speech";
  return {
    position: "absolute",
    left: "50%",
    bottom: -6,
    width: 12,
    height: 12,
    marginLeft: -6,
    background: speech ? "#fef9c3" : "#ffffff",
    borderRight: speech ? "1px solid #eab308" : "1px solid #cbd5e1",
    borderBottom: speech ? "1px solid #eab308" : "1px solid #cbd5e1",
    transform: "rotate(45deg)",
  };
}
