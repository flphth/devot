import { Billboard, Grid, Html, OrbitControls } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_STATS,
  sightRadiusFromStats,
  decodeIdentity,
  type ItemKind,
} from "@devot/shared";
import type {
  CombatFx,
  DevotView,
  FoodView,
  MonsterView,
  SmiteFx,
  WorldSnapshot,
} from "./useWorld.js";
import { CombatEffects, recentlyBitten } from "./CombatFx.js";
import { DevotModel } from "./creation/DevotModel.js";

const WORLD_HALF = 30;
const GROUND_SIZE = 120;
const GRASS_COUNT = 900;

// Palette prairie / voxel, couleurs plates.
const GRASS_LIT = new THREE.Color("#69a84f");
const GRASS_DARK = new THREE.Color("#1c2c1e");
const TUFT_LIT = new THREE.Color("#7dbc5e");
const TUFT_DARK = new THREE.Color("#243526");

const FOOD_COLORS: Record<string, string> = {
  grain: "#e8c95c",
  fruit: "#e0634c",
  manne: "#9fe8ff",
  corrompu: "#9c4ce0",
};

/**
 * One devot's field of view. The radius is PER DEVOT, from its sight stat, and
 * comes from the same formula the simulation uses to decide what enters that
 * devot's prompt. A fixed radius here would draw a circle that lies: a
 * sharp-eyed devot would perceive things the player sees as dark, and a
 * short-sighted one would appear to see what it cannot.
 */
type VisionCircle = { x: number; z: number; r: number };

function isVisible(x: number, z: number, vision: VisionCircle[], godMode: boolean): boolean {
  if (godMode) return true;
  return vision.some((v) => {
    const dx = x - v.x;
    const dz = z - v.z;
    return dx * dx + dz * dz <= v.r * v.r;
  });
}

// ── Sol prairie avec brouillard de guerre (shader) ──────────────────────────

const MAX_VISION = 16;

function PrairieGround({
  vision,
  godMode,
  onClick,
  onPointerMove,
  onPointerUp,
}: {
  vision: VisionCircle[];
  godMode: boolean;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onPointerMove: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp: () => void;
}) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          // xy = centre, z = that devot's own sight radius.
          uVision: { value: Array.from({ length: MAX_VISION }, () => new THREE.Vector3()) },
          uCount: { value: 0 },
          uAllLit: { value: 0 },
          uLit: { value: GRASS_LIT },
          uDark: { value: GRASS_DARK },
        },
        vertexShader: /* glsl */ `
          varying vec2 vWorld;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorld = world.xz;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uVision[${MAX_VISION}];
          uniform int uCount;
          uniform float uAllLit;
          uniform vec3 uLit;
          uniform vec3 uDark;
          varying vec2 vWorld;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }

          void main() {
            // Meadow-patchwork hue variation (flat areas, no fine noise).
            float n = hash(floor(vWorld * 0.8));
            vec3 grass = uLit * (0.92 + 0.16 * n);

            float vis = uAllLit;
            for (int i = 0; i < ${MAX_VISION}; i++) {
              if (i >= uCount) break;
              float r = uVision[i].z;
              float d = distance(vWorld, uVision[i].xy);
              vis = max(vis, 1.0 - smoothstep(r - 1.5, r + 3.5, d));
            }
            gl_FragColor = vec4(mix(uDark, grass, clamp(vis, 0.0, 1.0)), 1.0);
          }
        `,
      }),
    [],
  );

  useFrame(() => {
    const arr = material.uniforms.uVision!.value as THREE.Vector3[];
    for (let i = 0; i < MAX_VISION; i++) {
      const v = vision[i];
      if (v) arr[i]!.set(v.x, v.z, v.r);
    }
    material.uniforms.uCount!.value = Math.min(vision.length, MAX_VISION);
    material.uniforms.uAllLit!.value = godMode ? 1 : 0;
  });

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      material={material}
      onClick={onClick}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
    </mesh>
  );
}

// ── Instanced grass tufts ───────────────────────────────────────────────────

function GrassTufts({ vision, godMode }: { vision: VisionCircle[]; godMode: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  const tufts = useMemo(() => {
    const out: Array<{ x: number; z: number; s: number; r: number }> = [];
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < GRASS_COUNT; i++) {
      out.push({
        x: (rand() - 0.5) * 2 * WORLD_HALF * 1.05,
        z: (rand() - 0.5) * 2 * WORLD_HALF * 1.05,
        s: 0.6 + rand() * 0.9,
        r: rand() * Math.PI,
      });
    }
    return out;
  }, []);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    tufts.forEach((t, i) => {
      m.makeRotationY(t.r);
      m.setPosition(t.x, 0.09 * t.s, t.z);
      m.scale(new THREE.Vector3(t.s, t.s, t.s));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [tufts]);

  // Les touffes hors de vue s'assombrissent comme le sol.
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    tufts.forEach((t, i) => {
      const lit = isVisible(t.x, t.z, vision, godMode);
      mesh.setColorAt(i, lit ? TUFT_LIT : TUFT_DARK);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [tufts, vision, godMode]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, GRASS_COUNT]} frustumCulled={false}>
      <coneGeometry args={[0.07, 0.32, 4]} />
      <meshLambertMaterial />
    </instancedMesh>
  );
}

// ── Devot voxel ─────────────────────────────────────────────────────────────

function VoxelDevot({
  devot,
  color,
  selected,
  bitten,
  onSelect,
}: {
  devot: DevotView;
  color: string;
  selected: boolean;
  /** Just bitten: the body flags it — a dropping bar is not enough. */
  bitten: boolean;
  onSelect: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const bodyGroup = useRef<THREE.Group>(null);
  const target = useRef(new THREE.Vector3(devot.x, 0, devot.z));
  const heading = useRef(0);
  const dead = devot.state === "dead";

  target.current.set(devot.x, 0, devot.z);

  useFrame(({ clock }, dt) => {
    const g = group.current;
    const b = bodyGroup.current;
    if (!g || !b) return;

    // Interpolation: no more teleporting between two network patches.
    const before = g.position.clone();
    g.position.lerp(target.current, 1 - Math.exp(-dt * 7));
    const delta = g.position.clone().sub(before);
    const speed = delta.length() / Math.max(dt, 1e-4);
    const moving = speed > 0.15 && !dead;

    // Turn toward the direction of travel (damped).
    if (moving) {
      const desired = Math.atan2(delta.x, delta.z);
      let diff = desired - heading.current;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      heading.current += diff * Math.min(1, dt * 10);
      g.rotation.y = heading.current;
    }

    const t = clock.elapsedTime;
    if (dead) {
      b.position.y = 0;
      b.rotation.z = 0;
      b.scale.setScalar(1);
      return;
    }
    // Walking: bob + sway. Hunger: trembling. Thinking: pulsing.
    const bob = moving ? Math.abs(Math.sin(t * 9)) * 0.07 : 0;
    const tremble =
      devot.state === "dying"
        ? Math.sin(t * 40) * 0.02
        : devot.state === "starving"
          ? Math.sin(t * 25) * 0.01
          : 0;
    b.position.y = bob;
    b.position.x = tremble;
    b.rotation.z = moving ? Math.sin(t * 9) * 0.06 : 0;
    const pulse = devot.thinking ? 1 + Math.sin(t * 6) * 0.05 : 1;
    b.scale.setScalar(pulse);
  });

  // Appearance comes from the identity frozen at birth; a devot from before
  // this version, or born outside the creation screen, falls back to the
  // neutral look.
  const identity = decodeIdentity(devot.identity);
  const look = identity?.appearance ?? DEFAULT_APPEARANCE;
  // A bite flashes the body red for an instant: that is what makes the theft
  // of life perceptible without reading a number.
  const struck = bitten;
  // What this devot forged, and therefore paid for with its life.
  const carried = (devot.items ? devot.items.split(",") : []) as ItemKind[];
  // Vital state washes the colours out: a dying devot is visibly extinguished.
  const appearance =
    devot.state === "dying"
      ? { ...look, shirt: fade(look.shirt, "#444444", 0.55), skin: fade(look.skin, "#444444", 0.45) }
      : devot.state === "starving"
        ? { ...look, shirt: fade(look.shirt, "#888888", 0.3) }
        : look;
  const ratio = devot.hpMax > 0 ? devot.hp / devot.hpMax : 0;
  const bubble = devot.thinking ? "…" : devot.utterance || "";
  const innerVoice = !devot.thinking && !devot.utterance ? devot.thought : "";

  return (
    <group ref={group} position={[devot.x, 0, devot.z]}>
      <group
        ref={bodyGroup}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(devot.id);
        }}
      >
        {dead ? (
          // Pierre tombale voxel.
          <group>
            <mesh position={[0, 0.3, 0]}>
              <boxGeometry args={[0.5, 0.6, 0.18]} />
              <meshStandardMaterial color="#7a8089" flatShading />
            </mesh>
            <mesh position={[0, 0.62, 0]}>
              <boxGeometry args={[0.34, 0.14, 0.18]} />
              <meshStandardMaterial color="#666c75" flatShading />
            </mesh>
            <mesh position={[0, 0.02, 0.14]}>
              <boxGeometry args={[0.6, 0.06, 0.3]} />
              <meshStandardMaterial color="#565c64" flatShading />
            </mesh>
          </group>
        ) : (
          // The SAME model as the creation screen preview: what the player
          // shaped is exactly what lives here. Two separate models would have
          // drifted at the very first hat added.
          <DevotModel
            appearance={
              struck
                ? { ...appearance, shirt: "#ff5a4d", skin: "#ff9a8d" }
                : appearance
            }
            selected={selected}
            emissive={struck ? 0.7 : 0}
            items={carried}
          />
        )}
      </group>

      {!dead && (
        <Billboard position={[0, 1.35, 0]}>
          <mesh position={[-(1 - ratio) * 0.4, 0, 0]}>
            <planeGeometry args={[Math.max(0.02, ratio * 0.8), 0.08]} />
            <meshBasicMaterial
              color={ratio > 0.4 ? "#5ee07a" : ratio > 0.15 ? "#e0b34c" : "#e0634c"}
            />
          </mesh>
        </Billboard>
      )}

      {bubble ? (
        <Html position={[0, 1.8, 0]} center distanceFactor={18} style={{ pointerEvents: "none" }}>
          <div
            style={{
              background: "rgba(255,255,255,0.92)",
              color: "#1c2028",
              borderRadius: 10,
              padding: "4px 10px",
              maxWidth: 220,
              font: "12px/1.35 system-ui, sans-serif",
              whiteSpace: "pre-wrap",
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}
          >
            {bubble}
          </div>
        </Html>
      ) : innerVoice ? (
        <Html position={[0, 1.8, 0]} center distanceFactor={18} style={{ pointerEvents: "none" }}>
          <div
            style={{
              background: "rgba(28,32,40,0.75)",
              color: "#c6cede",
              borderRadius: 10,
              padding: "3px 9px",
              maxWidth: 220,
              font: "italic 11px/1.35 system-ui, sans-serif",
              whiteSpace: "pre-wrap",
            }}
          >
            {innerVoice}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

// ── Nourriture voxel ────────────────────────────────────────────────────────

function VoxelFood({
  food,
  godModeRef,
  onDragStart,
}: {
  food: FoodView;
  godModeRef: React.RefObject<boolean>;
  onDragStart: (id: string) => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const target = useRef(new THREE.Vector3(food.x, 0, food.z));
  target.current.set(food.x, 0, food.z);

  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    g.position.lerp(target.current, 1 - Math.exp(-dt * 10));
    if (food.kind === "manna") {
      g.rotation.y = clock.elapsedTime * 1.2;
      g.position.y = 0.15 + Math.sin(clock.elapsedTime * 2) * 0.08;
    }
  });

  const color = FOOD_COLORS[food.kind] ?? "#e8c95c";
  return (
    <group
      ref={ref}
      position={[food.x, 0, food.z]}
      onPointerDown={(e) => {
        if (!godModeRef.current) return;
        e.stopPropagation();
        onDragStart(food.id);
      }}
    >
      {food.kind === "fruit" ? (
        <group>
          <mesh position={[0, 0.16, 0]}>
            <boxGeometry args={[0.26, 0.26, 0.26]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
          <mesh position={[0, 0.34, 0]}>
            <boxGeometry args={[0.06, 0.12, 0.06]} />
            <meshStandardMaterial color="#4c8a3f" flatShading />
          </mesh>
        </group>
      ) : food.kind === "manna" ? (
        <mesh position={[0, 0.2, 0]}>
          <octahedronGeometry args={[0.22]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} flatShading />
        </mesh>
      ) : (
        <group>
          <mesh position={[0, 0.1, 0]}>
            <boxGeometry args={[0.24, 0.2, 0.24]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
          <mesh position={[0.08, 0.24, 0.05]}>
            <boxGeometry args={[0.1, 0.1, 0.1]} />
            <meshStandardMaterial color={color} flatShading />
          </mesh>
        </group>
      )}
    </group>
  );
}

// ── Foudre divine ───────────────────────────────────────────────────────────

function LightningFx({ fx }: { fx: SmiteFx }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const age = (Date.now() - fx.at) / 500;
    const opacity = Math.max(0, 1 - age);
    g.visible = opacity > 0;
    g.children.forEach((c) => {
      const mat = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = opacity;
    });
  });
  return (
    <group ref={ref} position={[fx.x, 0, fx.z]}>
      <mesh position={[0, 6, 0]}>
        <cylinderGeometry args={[0.08, 0.25, 12, 5]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={1} />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.2, 16]} />
        <meshBasicMaterial color="#fff6c0" transparent opacity={1} />
      </mesh>
    </group>
  );
}

/**
 * A MONSTER, drawn to read as danger at a glance: dark, angular, bigger than a
 * devot, and crowned by the size of its hoard. A fat monster must look like a
 * fat monster — that is the whole wager the player is being offered.
 */
function MonsterMesh({
  monster,
  onSelect,
}: {
  monster: MonsterView;
  onSelect: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const target = useRef(new THREE.Vector3(monster.x, 0, monster.z));
  target.current.set(monster.x, 0, monster.z);

  useFrame((_, dt) => {
    if (group.current) group.current.position.lerp(target.current, 1 - Math.exp(-dt * 7));
  });

  // Bulk grows with the hoard: what it ate is written on its body.
  const bulk = 1 + Math.min(0.6, monster.hoard / 120_000);
  const hunting = monster.targetId !== "";

  return (
    <group
      ref={group}
      position={[monster.x, 0, monster.z]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(monster.id);
      }}
    >
      <mesh position={[0, 0.55 * bulk, 0]}>
        <boxGeometry args={[0.85 * bulk, 0.9 * bulk, 0.7 * bulk]} />
        <meshStandardMaterial
          color="#2b1f2c"
          flatShading
          emissive={hunting ? "#8b1e2d" : "#000000"}
          emissiveIntensity={hunting ? 0.5 : 0}
        />
      </mesh>
      {/* eyes: the only bright thing on it */}
      <mesh position={[-0.2, 0.85 * bulk, 0.36 * bulk]}>
        <boxGeometry args={[0.12, 0.1, 0.03]} />
        <meshStandardMaterial color="#ff5a3c" emissive="#ff5a3c" emissiveIntensity={1.4} />
      </mesh>
      <mesh position={[0.2, 0.85 * bulk, 0.36 * bulk]}>
        <boxGeometry args={[0.12, 0.1, 0.03]} />
        <meshStandardMaterial color="#ff5a3c" emissive="#ff5a3c" emissiveIntensity={1.4} />
      </mesh>
      {/* legs */}
      {[-0.28, 0.28].map((x) => (
        <mesh key={x} position={[x * bulk, 0.14, 0]}>
          <boxGeometry args={[0.22 * bulk, 0.3, 0.24 * bulk]} />
          <meshStandardMaterial color="#1b1420" flatShading />
        </mesh>
      ))}
      <Billboard position={[0, 1.5 * bulk, 0]}>
        <Html center distanceFactor={16} style={{ pointerEvents: "none" }}>
          <div
            style={{
              font: "700 11px system-ui, sans-serif",
              color: "#ffb3a7",
              textShadow: "0 1px 3px #000",
              whiteSpace: "nowrap",
            }}
          >
            {monster.name} · {Math.round(monster.hoard).toLocaleString()}
          </div>
        </Html>
      </Billboard>
    </group>
  );
}

/**
 * Camera follow: while a devot is selected, the OrbitControls target glides
 * toward it (damped) and the camera moves by the same vector — the angle and
 * zoom chosen by the player are preserved, rotation/zoom stay free.
 */
function CameraFollow({
  snapshot,
  selectedId,
}: {
  snapshot: WorldSnapshot;
  selectedId: string | null;
}) {
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3;
    object: THREE.Camera;
    update: () => void;
  } | null;

  useFrame((_, dt) => {
    if (!controls || !selectedId) return;
    const devot = snapshot.devots.find((d) => d.id === selectedId);
    if (!devot) return;
    const desired = new THREE.Vector3(devot.x, 0.5, devot.z);
    const step = desired.sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 5));
    controls.target.add(step);
    controls.object.position.add(step);
    controls.update();
  });
  return null;
}

/** Exposes the camera to driven tests (dev only). */
function DevTestHooks() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__devotCam = { camera, size };
  }, [camera, size]);
  return null;
}

// ── Scene ───────────────────────────────────────────────────────────────────

export function Scene({
  snapshot,
  godId,
  selectedId,
  godMode,
  godModeRef,
  lastSmite,
  combats,
  onSelect,
  onGroundClick,
  onFoodMove,
}: {
  snapshot: WorldSnapshot;
  godId: string | null;
  selectedId: string | null;
  godMode: boolean;
  godModeRef: React.RefObject<boolean>;
  lastSmite: SmiteFx | null;
  combats: CombatFx[];
  onSelect: (id: string | null) => void;
  onGroundClick: (x: number, z: number) => void;
  onFoodMove: (foodId: string, x: number, z: number) => void;
}) {
  const [draggingFood, setDraggingFood] = useState<string | null>(null);
  const lastDragSent = useRef(0);

  const godColor = (id: string): string =>
    snapshot.gods.find((g) => g.id === id)?.color ?? "#cccccc";

  // Fog of war: the world is only clear around my own living devots, each one
  // seeing exactly as far as its sight stat allows.
  const vision: VisionCircle[] = snapshot.devots
    .filter((d) => d.godId === godId && d.state !== "dead")
    .map((d) => ({
      x: d.x,
      z: d.z,
      r: sightRadiusFromStats(decodeIdentity(d.identity)?.stats ?? DEFAULT_STATS),
    }));

  const visibleDevots = snapshot.devots.filter(
    (d) => d.godId === godId || isVisible(d.x, d.z, vision, godMode),
  );
  const visibleFood = snapshot.food.filter((f) => isVisible(f.x, f.z, vision, godMode));
  // Monsters obey the same fog: one you cannot see is one you cannot avoid.
  const visibleMonsters = snapshot.monsters.filter(
    (m) => m.state !== "dead" && isVisible(m.x, m.z, vision, godMode),
  );

  const handleGroundClick = (e: ThreeEvent<MouseEvent>) => {
    if (draggingFood) return;
    // godModeRef, pas la prop : le commit R3F peut retarder d'une frame.
    if (godModeRef.current) {
      onGroundClick(e.point.x, e.point.z);
    } else {
      onSelect(null);
    }
  };

  const handleGroundPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!draggingFood || !godModeRef.current) return;
    const now = Date.now();
    if (now - lastDragSent.current < 90) return;
    lastDragSent.current = now;
    onFoodMove(draggingFood, e.point.x, e.point.z);
  };

  return (
    <>
      <DevTestHooks />
      <ambientLight intensity={0.75} color="#eef4ff" />
      <directionalLight position={[18, 28, 12]} intensity={1.3} color="#fff4dd" />
      <fog attach="fog" args={["#101720", 55, 130]} />

      <PrairieGround
        vision={vision}
        godMode={godMode}
        onClick={handleGroundClick}
        onPointerMove={handleGroundPointerMove}
        onPointerUp={() => setDraggingFood(null)}
      />
      <GrassTufts vision={vision} godMode={godMode} />
      {/* Le maillage reste visible par-dessus la prairie — choix de style. */}
      <Grid
        args={[GROUND_SIZE, GROUND_SIZE]}
        position={[0, 0.02, 0]}
        cellColor="#3a5236"
        sectionColor="#2c3f2a"
        fadeDistance={95}
      />

      {visibleDevots.map((d) => (
        <VoxelDevot
          key={d.id}
          devot={d}
          color={godColor(d.godId)}
          selected={d.id === selectedId}
          bitten={recentlyBitten(combats, d.id)}
          onSelect={onSelect}
        />
      ))}
      {visibleFood.map((f) => (
        <VoxelFood key={f.id} food={f} godModeRef={godModeRef} onDragStart={setDraggingFood} />
      ))}
      {visibleMonsters.map((m) => (
        <MonsterMesh key={m.id} monster={m} onSelect={onSelect} />
      ))}

      {lastSmite && Date.now() - lastSmite.at < 600 && <LightningFx fx={lastSmite} />}
      <CombatEffects combats={combats} devots={visibleDevots} />

      <OrbitControls
        makeDefault
        enabled={!draggingFood}
        maxPolarAngle={Math.PI / 2.2}
        minDistance={8}
        maxDistance={70}
      />
      <CameraFollow snapshot={snapshot} selectedId={selectedId} />
    </>
  );
}

/** Washes one colour toward another: vital state reads on the body. */
function fade(hex: string, towards: string, amount: number): string {
  return "#" + new THREE.Color(hex).lerp(new THREE.Color(towards), amount).getHexString();
}
