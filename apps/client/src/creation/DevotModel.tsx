import * as THREE from "three";
import { useMemo } from "react";
import { BUILDS, type Appearance, type Build, type ItemKind } from "@devot/shared";

/**
 * A DEVOT'S BODY, in a single definition.
 *
 * This component is used by the creation screen preview AND by the world scene.
 * That is deliberate: the promise made to the player is that what they shape is
 * exactly what will be born. Two separate models would drift at the first hat
 * added.
 */

/** Build affects width, not height: everything stays to scale. */
const BUILD_WIDTH: Record<Build, number> = {
  slim: 0.78,
  average: 1,
  heavy: 1.28,
};

export function buildWidth(build: Build): number {
  return BUILD_WIDTH[BUILDS.includes(build) ? build : "average"];
}

export function DevotModel({
  appearance,
  selected = false,
  emissive = 0,
  items = [],
}: {
  appearance: Appearance;
  selected?: boolean;
  emissive?: number;
  /** Forged items, worn on the body: they show, they were paid for. */
  items?: readonly ItemKind[];
}) {
  const w = buildWidth(appearance.build);
  const shirt = useMemo(() => new THREE.Color(appearance.shirt), [appearance.shirt]);
  const pants = useMemo(() => new THREE.Color(appearance.pants), [appearance.pants]);
  const skin = useMemo(() => new THREE.Color(appearance.skin), [appearance.skin]);
  const glow = selected ? 0.45 : emissive;

  return (
    <group>
      {/* legs */}
      <mesh position={[-0.12 * w, 0.14, 0]}>
        <boxGeometry args={[0.16 * w, 0.28, 0.2]} />
        <meshStandardMaterial color={pants} flatShading />
      </mesh>
      <mesh position={[0.12 * w, 0.14, 0]}>
        <boxGeometry args={[0.16 * w, 0.28, 0.2]} />
        <meshStandardMaterial color={pants} flatShading />
      </mesh>

      {/* torso: this is what carries the shirt colour */}
      <mesh position={[0, 0.53, 0]}>
        <boxGeometry args={[0.46 * w, 0.44, 0.32]} />
        <meshStandardMaterial
          color={shirt}
          flatShading
          emissive={glow > 0 ? shirt : "#000000"}
          emissiveIntensity={glow}
        />
      </mesh>

      {/* arms */}
      <mesh position={[-(0.29 * w), 0.55, 0]}>
        <boxGeometry args={[0.11 * w, 0.36, 0.16]} />
        <meshStandardMaterial color={skin} flatShading />
      </mesh>
      <mesh position={[0.29 * w, 0.55, 0]}>
        <boxGeometry args={[0.11 * w, 0.36, 0.16]} />
        <meshStandardMaterial color={skin} flatShading />
      </mesh>

      {/* head */}
      <mesh position={[0, 0.93, 0]}>
        <boxGeometry args={[0.4, 0.36, 0.36]} />
        <meshStandardMaterial color={skin} flatShading />
      </mesh>
      {/* eyes: hidden when the face is covered */}
      {appearance.face !== "mask" && appearance.face !== "blindfold" && (
        <>
          <mesh position={[-0.09, 0.95, 0.185]}>
            <boxGeometry args={[0.07, 0.09, 0.02]} />
            <meshStandardMaterial color="#1c2028" />
          </mesh>
          <mesh position={[0.09, 0.95, 0.185]}>
            <boxGeometry args={[0.07, 0.09, 0.02]} />
            <meshStandardMaterial color="#1c2028" />
          </mesh>
        </>
      )}

      <FaceGear appearance={appearance} />
      <Hat appearance={appearance} />
      <Cape appearance={appearance} width={w} />
      <CarriedItems items={items} width={w} />
    </group>
  );
}

function FaceGear({ appearance }: { appearance: Appearance }) {
  if (appearance.face === "none") return null;
  if (appearance.face === "glasses") {
    return (
      <group position={[0, 0.95, 0.19]}>
        <mesh position={[-0.09, 0, 0]}>
          <boxGeometry args={[0.11, 0.11, 0.03]} />
          <meshStandardMaterial color="#161a22" metalness={0.4} roughness={0.4} />
        </mesh>
        <mesh position={[0.09, 0, 0]}>
          <boxGeometry args={[0.11, 0.11, 0.03]} />
          <meshStandardMaterial color="#161a22" metalness={0.4} roughness={0.4} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.08, 0.02, 0.02]} />
          <meshStandardMaterial color="#161a22" />
        </mesh>
      </group>
    );
  }
  if (appearance.face === "blindfold") {
    return (
      <mesh position={[0, 0.95, 0.005]}>
        <boxGeometry args={[0.42, 0.08, 0.38]} />
        <meshStandardMaterial color="#b8453a" flatShading />
      </mesh>
    );
  }
  // mask: covers the whole lower face
  return (
    <mesh position={[0, 0.88, 0.01]}>
      <boxGeometry args={[0.42, 0.18, 0.38]} />
      <meshStandardMaterial color="#cfd6e0" flatShading />
    </mesh>
  );
}

function Hat({ appearance }: { appearance: Appearance }) {
  switch (appearance.hat) {
    case "none":
      return null;
    case "cap":
      return (
        <mesh position={[0, 1.14, 0]}>
          <boxGeometry args={[0.42, 0.16, 0.38]} />
          <meshStandardMaterial color="#8a5a3a" flatShading />
        </mesh>
      );
    case "widebrim":
      return (
        <group>
          <mesh position={[0, 1.13, 0]}>
            <boxGeometry args={[0.36, 0.14, 0.32]} />
            <meshStandardMaterial color="#6b5844" flatShading />
          </mesh>
          <mesh position={[0, 1.06, 0]}>
            <boxGeometry args={[0.78, 0.04, 0.72]} />
            <meshStandardMaterial color="#6b5844" flatShading />
          </mesh>
        </group>
      );
    case "helmet":
      return (
        <group>
          <mesh position={[0, 1.13, 0]}>
            <boxGeometry args={[0.44, 0.18, 0.4]} />
            <meshStandardMaterial color="#8f959e" metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh position={[0, 1.05, 0.2]}>
            <boxGeometry args={[0.1, 0.22, 0.04]} />
            <meshStandardMaterial color="#8f959e" metalness={0.6} roughness={0.35} />
          </mesh>
        </group>
      );
    case "crown":
    default:
      return (
        <group position={[0, 1.14, 0]}>
          <mesh>
            <boxGeometry args={[0.42, 0.1, 0.38]} />
            <meshStandardMaterial color="#e0b34c" metalness={0.8} roughness={0.25} />
          </mesh>
          {[-0.15, 0, 0.15].map((x) => (
            <mesh key={x} position={[x, 0.09, 0]}>
              <boxGeometry args={[0.07, 0.1, 0.07]} />
              <meshStandardMaterial color="#e0b34c" metalness={0.8} roughness={0.25} />
            </mesh>
          ))}
        </group>
      );
  }
}

function Cape({ appearance, width }: { appearance: Appearance; width: number }) {
  if (appearance.cape === "none") return null;
  const height = appearance.cape === "short" ? 0.34 : 0.62;
  return (
    <mesh position={[0, 0.72 - height / 2, -0.2]}>
      <boxGeometry args={[0.5 * width, height, 0.05]} />
      <meshStandardMaterial color="#6a2b3a" flatShading />
    </mesh>
  );
}


/**
 * WHAT THE DEVOT FORGED. Every item cost hit points, and therefore thinking
 * time: it must show on the body, otherwise the sacrifice stays abstract.
 */
function CarriedItems({ items, width }: { items: readonly ItemKind[]; width: number }) {
  return (
    <group>
      {items.includes("spear") && (
        <mesh position={[0.36 * width, 0.62, 0]} rotation={[0, 0, 0.18]}>
          <boxGeometry args={[0.045, 0.95, 0.045]} />
          <meshStandardMaterial color="#b98a4d" flatShading />
        </mesh>
      )}
      {items.includes("shield") && (
        <mesh position={[-(0.38 * width), 0.55, 0.06]}>
          <boxGeometry args={[0.06, 0.4, 0.34]} />
          <meshStandardMaterial color="#9aa3ae" metalness={0.5} roughness={0.4} />
        </mesh>
      )}
      {items.includes("boots") && (
        <>
          <mesh position={[-0.12 * width, 0.05, 0.02]}>
            <boxGeometry args={[0.19 * width, 0.12, 0.26]} />
            <meshStandardMaterial color="#6b4a2f" flatShading />
          </mesh>
          <mesh position={[0.12 * width, 0.05, 0.02]}>
            <boxGeometry args={[0.19 * width, 0.12, 0.26]} />
            <meshStandardMaterial color="#6b4a2f" flatShading />
          </mesh>
        </>
      )}
      {items.includes("scope") && (
        <mesh position={[0.13, 0.98, 0.24]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.06, 0.16, 10]} />
          <meshStandardMaterial color="#c8b06a" metalness={0.6} roughness={0.3} />
        </mesh>
      )}
    </group>
  );
}
