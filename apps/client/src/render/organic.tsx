import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SX, SZ, TISSUE_MIN } from "@devot/sim-voxel";

/**
 * RENDU ORGANIQUE — partagé par le laboratoire et le monde commun.
 *
 * Le monde reste une grille de voxels : c'est la simulation, et elle ne change
 * pas. Ce module ne touche qu'à la façon dont on la REGARDE.
 *
 * Deux idées, et elles vont dans le même sens — supprimer l'arête :
 *
 * 1. le terrain n'est plus un empilement de cubes mais une NAPPE continue. On ne
 *    dessine que la surface (une hauteur par colonne, ce que le protocole envoie
 *    déjà), interpolée en normales lisses. Un seul maillage au lieu de dizaines
 *    de milliers d'instances : c'est aussi beaucoup plus rapide ;
 * 2. les corps sont des SPHÈRES qui se chevauchent légèrement, si bien qu'une
 *    créature de quatre voxels se lit comme un petit organisme et non comme un
 *    escalier. Elles respirent — une pulsation lente proportionnelle à leur
 *    énergie, qui rend visible d'un coup d'œil ce qui est vivant et vigoureux.
 */

/** Couleurs par matériau. Désaturées : c'est la forme qui doit parler. */
export const MATERIAL_COLORS: Record<number, string> = {
  1: "#5d6470", // roche
  2: "#7fbf62", // biomasse
  3: "#efe9dc", // os
  4: "#5fd98c", // muscle
  5: "#5aa8dd", // réserve
  6: "#e07a63", // bouche
  7: "#eccc63", // œil
  8: "#a86ce0", // neurone
};

/** Rayon d'une sphère de tissu. Au-delà de 0,5 les voxels voisins se soudent. */
const TISSUE_RADIUS = 0.62;

export interface SurfaceData {
  /** Hauteur du sommet de chaque colonne, -1 si la colonne est inconnue. */
  heights: Int16Array;
  /** Matériau du sommet de chaque colonne. */
  mats: Uint8Array;
  /** Incrémenté à chaque changement, pour éviter de reconstruire pour rien. */
  revision: number;
}

/**
 * La nappe de terrain. Une grille de sommets déplacés en hauteur, avec des
 * normales lissées : les collines deviennent des collines.
 *
 * Les colonnes inconnues (jamais reçues du serveur — le brouillard) sont
 * repoussées sous le sol et teintées de noir : le relief s'arrête franchement là
 * où s'arrête ce que le joueur a le droit de savoir.
 */
export function OrganicTerrain({ surface }: { surface: SurfaceData }) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(SX, SZ, SX - 1, SZ - 1);
    g.rotateX(-Math.PI / 2);
    g.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * 3), 3),
    );
    return g;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const col = geometry.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();
    const hidden = new THREE.Color("#0b0e14");

    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const k = z * SX + x;
        const h = surface.heights[k]!;
        // Le plan est construit en (x, z) croissants : même ordre que la grille.
        pos.setY(k, h < 0 ? -4 : h + 0.5);
        if (h < 0) {
          col.setXYZ(k, hidden.r, hidden.g, hidden.b);
        } else {
          c.set(MATERIAL_COLORS[surface.mats[k]!] ?? "#5d6470");
          // Ombrage d'altitude : les creux s'assombrissent, ce qui donne du
          // volume sans qu'aucune arête ne soit dessinée.
          const shade = 0.72 + Math.min(1, h / 14) * 0.28;
          col.setXYZ(k, c.r * shade, c.g * shade, c.b * shade);
        }
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }, [geometry, surface.revision, surface]);

  return (
    <mesh ref={meshRef} geometry={geometry} position={[-0.5, 0, -0.5]} receiveShadow>
      <meshStandardMaterial
        vertexColors
        roughness={0.92}
        metalness={0.04}
        flatShading={false}
      />
    </mesh>
  );
}

export interface BodyVoxels {
  /** Position monde de chaque voxel de tissu, à plat : x, y, z. */
  positions: Float32Array;
  /** Matériau de chaque voxel. */
  mats: Uint8Array;
  /** Vigueur de l'organisme portant ce voxel, de 0 à 1 (pilote la respiration). */
  vigor: Float32Array;
  /** Teinte de la créature, 0..31. Deux créatures voisines ne se confondent pas. */
  tint: Uint8Array;
  count: number;
  /** Voxels appartenant à l'organisme sélectionné : rendus plus clairs. */
  selected: Uint8Array;
}

/**
 * Couleur d'un voxel : la TEINTE dit de quelle créature il s'agit, le MATÉRIAU
 * module la clarté et la saturation.
 *
 * L'inverse — une couleur par matériau — était plus lisible sur un organisme
 * isolé, mais rendait toutes les créatures identiques dès qu'il y en avait
 * plusieurs à l'écran. Ici on reconnaît un individu au premier coup d'œil, et on
 * lit sa composition en s'approchant.
 */
const MATERIAL_TONE: Record<number, { light: number; sat: number }> = {
  3: { light: 0.82, sat: 0.25 }, // os : pâle
  4: { light: 0.55, sat: 0.95 }, // muscle : franc
  5: { light: 0.45, sat: 0.6 }, // réserve : sombre
  6: { light: 0.62, sat: 1.0 }, // bouche : vif
  7: { light: 0.78, sat: 0.85 }, // œil : clair
  8: { light: 0.5, sat: 1.0 }, // neurone : dense
};

function tissueColor(target: THREE.Color, tint: number, material: number): void {
  const tone = MATERIAL_TONE[material] ?? { light: 0.65, sat: 0.7 };
  // 32 teintes réparties sur le cercle, décalées pour éviter les verts du décor.
  const hue = ((tint * 360) / 32 + 18) % 360;
  target.setHSL(hue / 360, tone.sat * 0.75, tone.light);
}

const MAX_TISSUE = 24_000;

/**
 * Les corps. Une sphère par voxel, légèrement plus grosse qu'une case pour que
 * les voisines se soudent, et une respiration lente : l'échelle oscille avec le
 * temps, d'autant plus fort que l'organisme est vigoureux. Un corps affamé
 * respire à peine — on le voit avant de lire son énergie.
 */
export function OrganicBodies({ body }: { body: BodyVoxels }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const phases = useRef(new Float32Array(MAX_TISSUE));
  const matrix = useMemo(() => new THREE.Matrix4(), []);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const c = new THREE.Color();
    const highlight = new THREE.Color("#ffffff");
    const n = Math.min(body.count, MAX_TISSUE);
    for (let k = 0; k < n; k++) {
      matrix.makeTranslation(
        body.positions[k * 3]!,
        body.positions[k * 3 + 1]!,
        body.positions[k * 3 + 2]!,
      );
      mesh.setMatrixAt(k, matrix);
      if (body.selected[k]) {
        // Blanc franc : avec l'anneau et la colonne, on la retrouve d'un regard.
        mesh.setColorAt(k, highlight);
      } else {
        tissueColor(c, body.tint[k]!, body.mats[k]!);
        mesh.setColorAt(k, c);
      }
      // Une phase par voxel, dérivée de sa position : les créatures ne
      // respirent pas toutes ensemble, ce qui serait mécanique.
      phases.current[k] = (body.positions[k * 3]! + body.positions[k * 3 + 2]!) * 0.7;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [body, matrix]);

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh || mesh.count === 0) return;
    const t = clock.getElapsedTime();
    const n = mesh.count;
    for (let k = 0; k < n; k++) {
      const vigor = body.vigor[k] ?? 0.5;
      const s = 1 + Math.sin(t * 2.1 + phases.current[k]!) * 0.06 * (0.25 + vigor);
      matrix.makeScale(s, s, s);
      matrix.setPosition(
        body.positions[k * 3]!,
        body.positions[k * 3 + 1]!,
        body.positions[k * 3 + 2]!,
      );
      mesh.setMatrixAt(k, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX_TISSUE]} frustumCulled={false}>
      <sphereGeometry args={[TISSUE_RADIUS, 12, 10]} />
      <meshStandardMaterial vertexColors roughness={0.45} metalness={0.12} />
    </instancedMesh>
  );
}

/**
 * LE MARQUEUR DE SÉLECTION. Une créature élue ne doit pas se chercher : un
 * anneau posé au sol sous elle, une colonne de lumière, et une pulsation lente.
 * Le corps lui-même vire au blanc (voir `OrganicBodies`) — mais à trois voxels,
 * un changement de couleur ne suffit pas à retrouver quelqu'un dans une foule.
 */
export function SelectionMarker({
  position,
}: {
  position: { x: number; y: number; z: number } | null;
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  const beamRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!position) return;
    const t = clock.getElapsedTime();
    const ring = ringRef.current;
    if (ring) {
      const s = 1 + Math.sin(t * 2.6) * 0.18;
      ring.scale.set(s, s, s);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 2.6) * 0.2;
    }
    const beam = beamRef.current;
    if (beam) {
      (beam.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(t * 2.6) * 0.07;
    }
  });

  if (!position) return null;
  return (
    <group position={[position.x, position.y, position.z]}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.45, 0]}>
        <ringGeometry args={[2.1, 2.7, 40]} />
        <meshBasicMaterial
          color="#ffd76a"
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={beamRef} position={[0, 9, 0]}>
        <cylinderGeometry args={[0.9, 1.6, 18, 12, 1, true]} />
        <meshBasicMaterial
          color="#ffd76a"
          transparent
          opacity={0.18}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/** Le matériau est-il un tissu vivant ? Repris du noyau, jamais réécrit. */
export function isTissue(material: number): boolean {
  return material >= TISSUE_MIN;
}

/** Lumière et atmosphère communes aux deux vues. */
export function OrganicLighting() {
  return (
    <>
      <hemisphereLight args={["#cfe3ff", "#2a2419", 0.85]} />
      <directionalLight position={[45, 70, 30]} intensity={1.25} color="#fff3e2" castShadow />
      <directionalLight position={[-40, 25, -30]} intensity={0.35} color="#8fb6ff" />
    </>
  );
}
