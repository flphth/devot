import { Billboard, Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { CombatFx, DevotView } from "./useWorld.js";

/**
 * LE VOL DE VIE, RENDU VISIBLE.
 *
 * Combat already existed and worked: an attacker drains their victim's HP and
 * absorbs a share of it. But it could not be seen — it was a line in a log,
 * when it is the most meaningful act in the game.
 *
 * Here, a theft of life produces three things, each saying something
 * different:
 *
 * - a BEAM running from attacker to victim: who is taking from whom;
 * - NUMBERS rising from the victim: how much thinking time
 *   vient de changer de mains ;
 * - a red FLASH on the ground when the blow is fatal.
 *
 * Each effect lives about a second and then fades on its own: the effect queue
 * is bounded upstream, so nothing piles up.
 */

const LIFETIME_MS = 1100;

export function CombatEffects({
  combats,
  devots,
}: {
  combats: CombatFx[];
  devots: DevotView[];
}) {
  const byId = useMemo(() => new Map(devots.map((d) => [d.id, d])), [devots]);
  const now = Date.now();
  const live = combats.filter((c) => now - c.at < LIFETIME_MS);

  return (
    <>
      {live.map((c) => {
        const attacker = byId.get(c.attackerId);
        return (
          <CombatBeam
            key={c.id}
            combat={c}
            from={attacker ? [attacker.x, 0.6, attacker.z] : null}
          />
        );
      })}
    </>
  );
}

function CombatBeam({
  combat,
  from,
}: {
  combat: CombatFx;
  from: [number, number, number] | null;
}) {
  const lineRef = useRef<THREE.Line>(null);
  const labelRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const a = from ?? [combat.x, 0.6, combat.z];
    g.setFromPoints([
      new THREE.Vector3(a[0], a[1], a[2]),
      new THREE.Vector3(combat.x, 0.6, combat.z),
    ]);
    return g;
  }, [from, combat.x, combat.z]);

  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: combat.lethal ? "#ff4d4d" : "#ffb14d",
        transparent: true,
        opacity: 0.9,
      }),
    [combat.lethal],
  );

  const line = useMemo(() => new THREE.Line(geometry, material), [geometry, material]);

  useFrame(() => {
    const age = (Date.now() - combat.at) / LIFETIME_MS;
    const fade = Math.max(0, 1 - age);
    material.opacity = fade * 0.9;
    // The numbers rise: what left the victim floats up and fades.
    if (labelRef.current) labelRef.current.position.y = 1.1 + age * 0.9;
    if (flashRef.current) {
      const s = 0.4 + age * 1.6;
      flashRef.current.scale.set(s, s, s);
      (flashRef.current.material as THREE.MeshBasicMaterial).opacity = fade * 0.5;
    }
  });

  return (
    <group>
      <primitive object={line} />
      <group ref={labelRef} position={[combat.x, 1.1, combat.z]}>
        <Billboard>
          <Html center distanceFactor={14} style={{ pointerEvents: "none" }}>
            <div
              style={{
                font: "700 13px system-ui, sans-serif",
                color: combat.lethal ? "#ff6b6b" : "#ffc76b",
                textShadow: "0 1px 3px rgba(0,0,0,0.9)",
                whiteSpace: "nowrap",
              }}
            >
              −{combat.drained.toLocaleString("fr-FR")}
            </div>
          </Html>
        </Billboard>
      </group>
      {combat.lethal && (
        <mesh ref={flashRef} rotation={[-Math.PI / 2, 0, 0]} position={[combat.x, 0.03, combat.z]}>
          <ringGeometry args={[0.5, 0.9, 24]} />
          <meshBasicMaterial color="#ff4d4d" transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

/**
 * Has a devot just been bitten? Drives the body flash: the victim must flag
 * itself, not merely watch its bar drop.
 */
export function recentlyBitten(combats: CombatFx[], devotId: string): boolean {
  const now = Date.now();
  return combats.some((c) => c.victimId === devotId && now - c.at < 420);
}
