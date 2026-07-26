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
const IMPACT_MS = 520;
const SHARDS = 7;

/**
 * The moment of contact.
 *
 * The beam says a transfer happened and the numbers say how much; neither says
 * that something was STRUCK. A short burst of shards thrown out of the victim
 * gives the blow a place and an instant.
 */
function Impact({ fx }: { fx: CombatFx }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dirs = useMemo(
    () =>
      Array.from({ length: SHARDS }, (_, i) => {
        // Deterministic from the effect's own id: a burst must not reshuffle
        // itself on every frame.
        const a = ((fx.id * 37 + i * 53) % 360) * (Math.PI / 180);
        return { x: Math.cos(a), z: Math.sin(a), up: 0.5 + ((i * 7) % 10) / 12 };
      }),
    [fx.id],
  );

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const age = (Date.now() - fx.at) / IMPACT_MS;
    if (age >= 1) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const m = new THREE.Matrix4();
    const spread = age * 1.1;
    const fall = age * age * 1.4;
    dirs.forEach((d, i) => {
      m.makeScale(1 - age, 1 - age, 1 - age);
      m.setPosition(d.x * spread, 0.6 + d.up * spread - fall, d.z * spread);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group position={[fx.x, 0, fx.z]}>
      <instancedMesh ref={ref} args={[undefined, undefined, SHARDS]} frustumCulled={false}>
        <boxGeometry args={[0.09, 0.09, 0.09]} />
        <meshBasicMaterial color={fx.lethal ? "#ff5a3c" : "#ffc76b"} />
      </instancedMesh>
    </group>
  );
}

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
      {live.map((c) => <Impact key={`impact-${c.id}`} fx={c} />)}
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

/**
 * Is this creature swinging right now, and at what?
 *
 * The beam already said who was taking from whom. What it could not say is
 * that a FIGHT is happening: two bodies stood perfectly still while one
 * emptied the other. This gives the body something to lunge at.
 */
export function strikingAt(
  combats: CombatFx[],
  attackerId: string,
): { x: number; z: number } | undefined {
  const now = Date.now();
  const blow = combats.find((c) => c.attackerId === attackerId && now - c.at < 380);
  return blow ? { x: blow.x, z: blow.z } : undefined;
}

/** How far through its lunge a striker is, 0 → 1 → 0 over the blow. */
export function lungeProgress(combats: CombatFx[], attackerId: string): number {
  const now = Date.now();
  const blow = combats.find((c) => c.attackerId === attackerId && now - c.at < 380);
  if (!blow) return 0;
  const t = (now - blow.at) / 380;
  // Out fast, back slower: a strike, not a sway.
  return t < 0.3 ? t / 0.3 : Math.max(0, 1 - (t - 0.3) / 0.7);
}
