import { Billboard, Html, OrbitControls } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  DEFAULT_APPEARANCE,
  DEFAULT_STATS,
  WORLD_HALF,
  dayPhase,
  hasLineOfSight,
  sightRadiusFromStats,
  decodeIdentity,
  terrainHeight,
  worldProps,
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
import {
  CombatEffects,
  lungeProgress,
  recentlyBitten,
  strikingAt,
} from "./CombatFx.js";
import { DevotModel, type Limbs } from "./creation/DevotModel.js";

const GROUND_SIZE = 120;
/** Quads across the ground. The relief is only as sharp as this grid is fine. */
const GROUND_SEGMENTS = 160;
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
  const target = { x, y: 0, z };
  return vision.some((v) => {
    const dx = x - v.x;
    const dz = z - v.z;
    if (dx * dx + dz * dz > v.r * v.r) return false;
    // Same rule the server applies: the player never sees a creature their
    // devots are blind to, whether it is too far or behind a ridge.
    return hasLineOfSight({ x: v.x, y: 0, z: v.z }, target);
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
          varying vec3 vNormal;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorld = world.xz;
            vNormal = normalize(mat3(modelMatrix) * normal);
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
          varying vec3 vNormal;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }

          void main() {
            // Meadow-patchwork hue variation (flat areas, no fine noise).
            float n = hash(floor(vWorld * 0.8));
            vec3 grass = uLit * (0.92 + 0.16 * n);

            // Without this the relief is invisible: a flat-shaded hill and flat
            // ground paint the exact same pixels. Slopes facing the sun read
            // bright, the far sides of hills read dark.
            vec3 sun = normalize(vec3(0.45, 0.8, 0.35));
            float lambert = clamp(dot(normalize(vNormal), sun), 0.0, 1.0);
            grass *= 0.62 + 0.38 * lambert;

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

  // Built once: the relief never changes, so the displaced grid is static
  // geometry. Same terrainHeight the server walks its devots on.
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(
      GROUND_SIZE,
      GROUND_SIZE,
      GROUND_SEGMENTS,
      GROUND_SEGMENTS,
    );
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }, []);

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
      geometry={geometry}
      material={material}
      onClick={onClick}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
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
      m.setPosition(t.x, terrainHeight(t.x, t.z) + 0.09 * t.s, t.z);
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

// ── The sky ─────────────────────────────────────────────────────────────────

/**
 * Light, colour and fog, all derived from the one world clock the server sends.
 * Night is not a filter over the picture: it is the same darkness the
 * simulation is charging the devots for.
 */
function Sky({ worldMs }: { worldMs: number }) {
  const phase = dayPhase(worldMs);
  const night = phase === "night";
  const twilight = phase === "dawn" || phase === "dusk";

  const ambient = night ? 0.22 : twilight ? 0.45 : 0.75;
  const sun = night ? 0.25 : twilight ? 0.8 : 1.3;
  const ambientColor = night ? "#7f8fc4" : twilight ? "#ffd8b0" : "#eef4ff";
  const sunColor = night ? "#9fb4ff" : twilight ? "#ffb072" : "#fff4dd";
  const fogColor = night ? "#070a12" : twilight ? "#2a1f24" : "#101720";
  // Night closes the world in as well as darkening it.
  const fogNear = night ? 26 : twilight ? 40 : 55;

  return (
    <>
      <ambientLight intensity={ambient} color={ambientColor} />
      <directionalLight position={[18, 28, 12]} intensity={sun} color={sunColor} />
      <fog attach="fog" args={[fogColor, fogNear, night ? 90 : 130]} />
      <color attach="background" args={[fogColor]} />
    </>
  );
}

// ── Rocks and flowers ───────────────────────────────────────────────────────

const ROCK_LIT = new THREE.Color("#8d8f96");
const ROCK_DARK = new THREE.Color("#2b3033");
const FLOWER_LIT = ["#e8657f", "#f0d24c", "#c98ce8", "#f2f2f2"].map((c) => new THREE.Color(c));
const FLOWER_DARK = new THREE.Color("#2a2733");

/** Boulders. Solid in the simulation too — bodies slide around them. */
function Rocks({ vision, godMode }: { vision: VisionCircle[]; godMode: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const rocks = useMemo(() => worldProps().rocks, []);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    rocks.forEach((r, i) => {
      // Squashed and tilted, so a field of boulders never looks like a field
      // of identical balls.
      q.setFromEuler(new THREE.Euler(r.rotation * 0.2, r.rotation, r.rotation * 0.15));
      scale.set(r.scale, r.scale * (0.6 + (r.variant % 3) * 0.18), r.scale);
      m.compose(new THREE.Vector3(r.x, r.y + r.scale * 0.28, r.z), q, scale);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [rocks]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    rocks.forEach((r, i) => {
      mesh.setColorAt(i, isVisible(r.x, r.z, vision, godMode) ? ROCK_LIT : ROCK_DARK);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [rocks, vision, godMode]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, rocks.length]} frustumCulled={false}>
      <dodecahedronGeometry args={[0.62, 0]} />
      <meshStandardMaterial flatShading />
    </instancedMesh>
  );
}

/** Flowers. Pure decoration: nothing in the simulation knows they exist. */
function Flowers({ vision, godMode }: { vision: VisionCircle[]; godMode: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const flowers = useMemo(() => worldProps().flowers, []);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    flowers.forEach((f, i) => {
      m.makeRotationY(f.rotation);
      m.setPosition(f.x, f.y + 0.22 * f.scale, f.z);
      m.scale(new THREE.Vector3(f.scale, f.scale, f.scale));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [flowers]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    flowers.forEach((f, i) => {
      const lit = isVisible(f.x, f.z, vision, godMode);
      mesh.setColorAt(i, lit ? FLOWER_LIT[f.variant % FLOWER_LIT.length]! : FLOWER_DARK);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [flowers, vision, godMode]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, flowers.length]} frustumCulled={false}>
      <boxGeometry args={[0.16, 0.16, 0.16]} />
      <meshStandardMaterial flatShading />
    </instancedMesh>
  );
}

// ── Devot voxel ─────────────────────────────────────────────────────────────

function VoxelDevot({
  devot,
  color,
  selected,
  bitten,
  strikeAt,
  lunge,
  onSelect,
}: {
  devot: DevotView;
  color: string;
  selected: boolean;
  /** Just bitten: the body flags it — a dropping bar is not enough. */
  bitten: boolean;
  /** Where this devot is striking, if it is. Drives the lunge. */
  strikeAt?: { x: number; z: number };
  /** How far through that lunge, 0 → 1 → 0. */
  lunge: number;
  onSelect: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const bodyGroup = useRef<THREE.Group>(null);
  const target = useRef(new THREE.Vector3(devot.x, devot.y, devot.z));
  const heading = useRef(0);
  const limbs = useRef<Limbs>({ legL: null, legR: null, armL: null, armR: null });
  /** Phase of the walk cycle, advanced by DISTANCE covered rather than by time. */
  const stride = useRef(0);
  const dead = devot.state === "dead";

  target.current.set(devot.x, devot.y, devot.z);

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

    // THE FIGHT ITSELF. Two bodies used to stand perfectly still while one
    // emptied the other, with nothing but a beam between them to say so.
    // A striker throws itself at what it is hitting; a body that has just been
    // hit is knocked back off it. Both read instantly, from any camera angle.
    let lungeX = 0;
    let lungeZ = 0;
    let pitch = 0;
    if (lunge > 0 && strikeAt) {
      const dx = strikeAt.x - g.position.x;
      const dz = strikeAt.z - g.position.z;
      const len = Math.hypot(dx, dz) || 1;
      // In LOCAL space: the group is already turned to face its heading, so a
      // world-space offset here would send the body sideways.
      const facing = Math.atan2(dx / len, dz / len) - heading.current;
      lungeX = Math.sin(facing) * lunge * 0.45;
      lungeZ = Math.cos(facing) * lunge * 0.45;
      pitch = -lunge * 0.35;
    }
    // Recoil: struck bodies snap away from the blow and shudder.
    const recoil = struck ? Math.sin(t * 45) * 0.05 : 0;

    b.position.y = bob + lunge * 0.12;
    b.position.x = tremble + lungeX + recoil;
    b.position.z = lungeZ;
    b.rotation.x = pitch;
    b.rotation.z = (moving ? Math.sin(t * 9) * 0.06 : 0) + (struck ? 0.12 : 0);
    const pulse = devot.thinking ? 1 + Math.sin(t * 6) * 0.05 : 1;
    b.scale.setScalar(pulse);

    // THE WALK.
    //
    // Advanced by the distance actually covered, not by the clock: a body that
    // stops must stop walking, and one held up by a hill must slow down with it.
    // Driving this off elapsed time gives a corpse that keeps marching on the
    // spot, which is worse than no animation at all.
    stride.current += speed * dt * 4.2;
    const swing = moving ? Math.sin(stride.current) * 0.55 : 0;
    const l = limbs.current;
    // Arms swing against the legs, which is what makes a walk read as a walk.
    if (l.legL) l.legL.rotation.x = swing;
    if (l.legR) l.legR.rotation.x = -swing;
    if (l.armL) l.armL.rotation.x = -swing * 0.7;
    if (l.armR) l.armR.rotation.x = swing * 0.7;
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
  const ratio = devot.capacity > 0 ? devot.balance / devot.capacity : 0;
  const bubble = devot.thinking ? "…" : devot.utterance || "";
  const innerVoice = !devot.thinking && !devot.utterance ? devot.thought : "";

  return (
    <group ref={group} position={[devot.x, devot.y, devot.z]}>
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
            limbs={limbs}
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
  const ground = terrainHeight(food.x, food.z);
  const target = useRef(new THREE.Vector3(food.x, ground, food.z));
  target.current.set(food.x, ground, food.z);

  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    g.position.lerp(target.current, 1 - Math.exp(-dt * 10));

    // Wilting: food shrinks over the last quarter of its life, so a god can
    // see a meal slipping away instead of being surprised by its absence.
    if (food.ttlMs > 0) {
      const life = (Date.now() - food.spawnedAt) / food.ttlMs;
      const wilt = life < 0.75 ? 1 : Math.max(0.25, 1 - (life - 0.75) * 3);
      g.scale.setScalar(wilt);
    }

    if (food.kind === "legacy") {
      g.rotation.y = clock.elapsedTime * 1.6;
      // It is thrown clear of the body and settles: the moment money changes
      // hands should be visible, not simply appear on the floor.
      const born = (Date.now() - food.spawnedAt) / 900;
      const arc = born < 1 ? Math.sin(born * Math.PI) * 1.1 : 0;
      g.position.y = ground + 0.06 + arc + Math.sin(clock.elapsedTime * 2.4) * 0.05;
      if (born < 1) g.scale.setScalar(Math.min(1, 0.2 + born * 1.6));
    }
    if (food.kind === "manna") {
      g.rotation.y = clock.elapsedTime * 1.2;
      g.position.y = ground + 0.15 + Math.sin(clock.elapsedTime * 2) * 0.08;
    }
  });

  const color = FOOD_COLORS[food.kind] ?? "#e8c95c";
  return (
    <group
      ref={ref}
      position={[food.x, ground, food.z]}
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
      ) : food.kind === "legacy" ? (
        // A relic reads as treasure, not as a meal: a coin standing on edge,
        // turning, catching the light even at night.
        <group>
          <mesh position={[0, 0.3, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.22, 0.22, 0.06, 12]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.55}
              flatShading
            />
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
    <group ref={ref} position={[fx.x, terrainHeight(fx.x, fx.z), fx.z]}>
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
/**
 * A BEAST, NOT A BOX.
 *
 * It was one cube for the body, two for the eyes, and two legs that never
 * moved — a monster slid across the ground by `position.lerp` and stood
 * perfectly still while eating someone. It reads as a beast now: a long spine
 * carried low, a heavy head thrust out in front of the shoulders, a jaw, four
 * legs that walk in diagonal pairs, and a tail that swings behind it.
 *
 * All of it is R3F geometry in the game's own voxel language. No model file, no
 * asset, nothing to load — the same rule the rest of the world follows.
 */
function MonsterMesh({
  monster,
  strikeAt,
  lunge,
  onSelect,
}: {
  monster: MonsterView;
  /** Where it is biting, if it is. Drives the lunge. */
  strikeAt?: { x: number; z: number };
  /** How far through that bite, 0 → 1 → 0. */
  lunge: number;
  onSelect: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const bodyGroup = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const jaw = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const legs = useRef<Array<THREE.Group | null>>([null, null, null, null]);
  const ground = terrainHeight(monster.x, monster.z);
  const target = useRef(new THREE.Vector3(monster.x, ground, monster.z));
  const heading = useRef(0);
  const stride = useRef(0);
  target.current.set(monster.x, ground, monster.z);

  useFrame(({ clock }, dt) => {
    const g = group.current;
    const b = bodyGroup.current;
    if (!g || !b) return;

    const before = g.position.clone();
    g.position.lerp(target.current, 1 - Math.exp(-dt * 7));
    const delta = g.position.clone().sub(before);
    const speed = delta.length() / Math.max(dt, 1e-4);
    const moving = speed > 0.15;

    // Face where it is going — and, while biting, what it is biting.
    let desired: number | undefined;
    if (lunge > 0 && strikeAt) {
      desired = Math.atan2(strikeAt.x - g.position.x, strikeAt.z - g.position.z);
    } else if (moving) {
      desired = Math.atan2(delta.x, delta.z);
    }
    if (desired !== undefined) {
      let diff = desired - heading.current;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      heading.current += diff * Math.min(1, dt * 10);
      g.rotation.y = heading.current;
    }

    const t = clock.elapsedTime;

    // The gait, advanced by ground covered rather than by the clock, so a beast
    // that stops stops walking instead of marching on the spot.
    stride.current += speed * dt * 3.4;
    const swing = moving ? Math.sin(stride.current) * 0.6 : 0;
    // Diagonal pairs, the way four-legged things actually move: front-left with
    // back-right. In phase, it hops like a toy.
    const [fl, fr, bl, br] = legs.current;
    if (fl) fl.rotation.x = swing;
    if (br) br.rotation.x = swing;
    if (fr) fr.rotation.x = -swing;
    if (bl) bl.rotation.x = -swing;

    // It lunges into the bite and drops back, like a devot does — the whole
    // point of reusing strikingAt/lungeProgress rather than inventing a second
    // system. Since the body is already turned to face its prey, the throw is
    // straight down local +Z.
    b.position.z = lunge * 0.5;
    b.position.y = (moving ? Math.abs(Math.sin(stride.current)) * 0.05 : 0) - lunge * 0.08;
    b.rotation.x = -lunge * 0.3;

    // The head leads: down and forward while hunting, thrown further on a bite.
    if (head.current) {
      head.current.rotation.x = 0.18 + lunge * 0.35;
      head.current.position.z = 0.42 + lunge * 0.12;
    }
    // The jaw opens on the bite, and works while it feeds.
    if (jaw.current) {
      jaw.current.rotation.x = lunge > 0 ? 0.5 * lunge + 0.15 : 0.04 + Math.abs(Math.sin(t * 2)) * 0.03;
    }
    // The tail swings against the gait, and lashes when it is striking.
    if (tail.current) {
      tail.current.rotation.y = moving ? Math.sin(stride.current) * 0.35 : Math.sin(t * 1.4) * 0.12;
      tail.current.rotation.x = -0.25 - lunge * 0.3;
    }
  });

  // Bulk grows with the hoard: what it ate is written on its body.
  const bulk = 1 + Math.min(0.6, monster.hoard / 120_000);
  const hunting = monster.targetId !== "";
  const hide = "#2b1f2c";
  const dark = "#1b1420";

  // Front pair, then back pair. Order matters: the gait reads them as
  // [front-left, front-right, back-left, back-right].
  const legPlan: Array<[number, number]> = [
    [-0.26, 0.3],
    [0.26, 0.3],
    [-0.26, -0.36],
    [0.26, -0.36],
  ];

  return (
    <group
      ref={group}
      position={[monster.x, ground, monster.z]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(monster.id);
      }}
    >
      <group ref={bodyGroup} scale={[bulk, bulk, bulk]}>
        {/* spine: long and low, the silhouette that says quadruped */}
        <mesh position={[0, 0.5, -0.05]}>
          <boxGeometry args={[0.62, 0.42, 1.15]} />
          <meshStandardMaterial
            color={hide}
            flatShading
            emissive={hunting ? "#8b1e2d" : "#000000"}
            emissiveIntensity={hunting ? 0.5 : 0}
          />
        </mesh>
        {/* haunches, higher than the shoulders — it is always about to spring */}
        <mesh position={[0, 0.62, -0.5]}>
          <boxGeometry args={[0.58, 0.34, 0.36]} />
          <meshStandardMaterial color={hide} flatShading />
        </mesh>
        {/* ridge of spikes along the back */}
        {[-0.4, -0.1, 0.2].map((z, i) => (
          <mesh key={z} position={[0, 0.76 - i * 0.02, z]} rotation={[0.2, 0, 0]}>
            <boxGeometry args={[0.09, 0.22 - i * 0.03, 0.1]} />
            <meshStandardMaterial color={dark} flatShading />
          </mesh>
        ))}

        {/* head, carried low and forward of the shoulders */}
        <group ref={head} position={[0, 0.42, 0.42]}>
          <mesh position={[0, 0, 0.16]}>
            <boxGeometry args={[0.44, 0.34, 0.46]} />
            <meshStandardMaterial
              color={hide}
              flatShading
              emissive={hunting ? "#8b1e2d" : "#000000"}
              emissiveIntensity={hunting ? 0.35 : 0}
            />
          </mesh>
          {/* jaw, hinged at the back so it opens downward */}
          <group ref={jaw} position={[0, -0.13, 0.02]}>
            <mesh position={[0, -0.05, 0.22]}>
              <boxGeometry args={[0.36, 0.12, 0.42]} />
              <meshStandardMaterial color={dark} flatShading />
            </mesh>
            {[-0.1, 0.1].map((x) => (
              <mesh key={x} position={[x, 0.04, 0.4]}>
                <boxGeometry args={[0.06, 0.12, 0.06]} />
                <meshStandardMaterial color="#e8e2d6" flatShading />
              </mesh>
            ))}
          </group>
          {/* the eyes: still the only bright thing on it */}
          {[-0.12, 0.12].map((x) => (
            <mesh key={x} position={[x, 0.08, 0.38]}>
              <boxGeometry args={[0.11, 0.09, 0.03]} />
              <meshStandardMaterial color="#ff5a3c" emissive="#ff5a3c" emissiveIntensity={1.4} />
            </mesh>
          ))}
          {/* ears, laid flat back */}
          {[-0.17, 0.17].map((x) => (
            <mesh key={x} position={[x, 0.2, -0.02]} rotation={[-0.5, 0, 0]}>
              <boxGeometry args={[0.08, 0.16, 0.05]} />
              <meshStandardMaterial color={dark} flatShading />
            </mesh>
          ))}
        </group>

        {/* four legs, each hung from its shoulder or hip so it swings */}
        {legPlan.map(([x, z], i) => (
          <group
            key={`${x},${z}`}
            position={[x, 0.34, z]}
            ref={(g) => {
              legs.current[i] = g;
            }}
          >
            <mesh position={[0, -0.17, 0]}>
              <boxGeometry args={[0.17, 0.34, 0.2]} />
              <meshStandardMaterial color={dark} flatShading />
            </mesh>
            {/* paw */}
            <mesh position={[0, -0.33, 0.04]}>
              <boxGeometry args={[0.2, 0.09, 0.26]} />
              <meshStandardMaterial color={dark} flatShading />
            </mesh>
          </group>
        ))}

        {/* tail, hinged at the haunches */}
        <group ref={tail} position={[0, 0.6, -0.66]}>
          <mesh position={[0, 0, -0.26]}>
            <boxGeometry args={[0.14, 0.14, 0.5]} />
            <meshStandardMaterial color={hide} flatShading />
          </mesh>
          <mesh position={[0, 0, -0.56]}>
            <boxGeometry args={[0.09, 0.09, 0.24]} />
            <meshStandardMaterial color={dark} flatShading />
          </mesh>
        </group>
      </group>

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
      <Sky worldMs={snapshot.worldMs} />

      <PrairieGround
        vision={vision}
        godMode={godMode}
        onClick={handleGroundClick}
        onPointerMove={handleGroundPointerMove}
        onPointerUp={() => setDraggingFood(null)}
      />
      <GrassTufts vision={vision} godMode={godMode} />
      <Rocks vision={vision} godMode={godMode} />
      <Flowers vision={vision} godMode={godMode} />

      {visibleDevots.map((d) => (
        <VoxelDevot
          key={d.id}
          devot={d}
          color={godColor(d.godId)}
          selected={d.id === selectedId}
          bitten={recentlyBitten(combats, d.id)}
          strikeAt={strikingAt(combats, d.id)}
          lunge={lungeProgress(combats, d.id)}
          onSelect={onSelect}
        />
      ))}
      {visibleFood.map((f) => (
        <VoxelFood key={f.id} food={f} godModeRef={godModeRef} onDragStart={setDraggingFood} />
      ))}
      {visibleMonsters.map((m) => (
        <MonsterMesh
          key={m.id}
          monster={m}
          strikeAt={strikingAt(combats, m.id)}
          lunge={lungeProgress(combats, m.id)}
          onSelect={onSelect}
        />
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
