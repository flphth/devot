import { Billboard, Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { CombatFx, DevotView } from "./useWorld.js";

/**
 * LE VOL DE VIE, RENDU VISIBLE.
 *
 * Le combat existait déjà et fonctionnait : un agresseur draine les PV de sa
 * victime et en absorbe une part. Mais il ne se voyait pas — c'était une ligne
 * dans un journal, alors que c'est le geste le plus lourd de sens du jeu.
 *
 * Ici, un vol de vie produit trois choses, et chacune dit quelque chose de
 * différent :
 *
 * - un TRAIT qui va de l'agresseur à la victime : qui prend à qui ;
 * - des CHIFFRES qui montent depuis la victime : combien de temps de pensée
 *   vient de changer de mains ;
 * - un ÉCLAT rouge au sol quand le coup est fatal.
 *
 * Chaque effet vit environ une seconde puis s'efface tout seul : la file
 * d'effets est bornée en amont, donc rien ne s'accumule.
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
    // Les chiffres montent : ce qui est parti de la victime s'élève et s'efface.
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
 * Un devot vient-il d'être mordu ? Sert au clignotement du corps : la victime
 * doit se signaler, pas seulement voir sa barre descendre.
 */
export function recentlyBitten(combats: CombatFx[], devotId: string): boolean {
  const now = Date.now();
  return combats.some((c) => c.victimId === devotId && now - c.at < 420);
}
