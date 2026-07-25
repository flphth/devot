import { describe, expect, it } from "vitest";
import {
  BIOMASS,
  CHUNK,
  CHUNK_VOLUME,
  MOUTH,
  NEURON,
  ROCK,
  SeededRng,
  VOID,
  VoxelWorld,
  chunkCoords,
  chunkIndex,
  chunkVisible,
  decodeBody,
  decodeChunk,
  encodeBody,
  encodeChunk,
  findSpawnSpot,
  makePlan,
  pointVisible,
  registerPlan,
  spawnOrganism,
  stepN,
} from "../src/index.js";
import { flatWorld } from "./helpers.js";

/**
 * Le protocole dérivé est la promesse centrale du monde commun : le client ne
 * reçoit jamais le monde. Ces tests vérifient les deux choses qui comptent —
 * que ce qu'on envoie se redécode à l'identique, et que ça reste petit.
 */

function chunkOfWorld(w: VoxelWorld, cx: number, cy: number, cz: number): Uint8Array {
  const materials = new Uint8Array(CHUNK_VOLUME);
  let at = 0;
  for (let y = cy * CHUNK; y < cy * CHUNK + CHUNK; y++) {
    for (let z = cz * CHUNK; z < cz * CHUNK + CHUNK; z++) {
      for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) {
        const m = w.material[w.idx(x, y, z)]!;
        materials[at++] = m >= 4 ? 0 : m; // les tissus voyagent à part
      }
    }
  }
  return materials;
}

describe("protocole dérivé — chunks de terrain", () => {
  it("un chunk se redécode voxel pour voxel", () => {
    const w = new VoxelWorld(4242);
    w.generateTerrain();
    stepN(w, 30); // de l'eau qui coule, de la biomasse qui pousse

    for (const [cx, cy, cz] of [
      [0, 0, 0],
      [3, 0, 5],
      [7, 1, 7],
    ] as const) {
      const decoded = decodeChunk(encodeChunk(w, cx, cy, cz));
      expect(decoded).toMatchObject({ cx, cy, cz });
      expect(Array.from(decoded.materials)).toEqual(Array.from(chunkOfWorld(w, cx, cy, cz)));
    }
  });

  it("un chunk d'air pur tient en une poignée d'octets", () => {
    const w = flatWorld();
    // Chunk tout en haut : rien que du vide.
    const bytes = encodeChunk(w, 2, 1, 2);
    expect(bytes.length).toBeLessThan(16);
    expect(decodeChunk(bytes).materials.every((m) => m === VOID)).toBe(true);
  });

  it("un chunk de terrain réel reste petit devant ses 4 096 voxels", () => {
    const w = new VoxelWorld(7);
    w.generateTerrain();
    stepN(w, 50);
    let worst = 0;
    for (let cx = 0; cx < 8; cx++) {
      for (let cz = 0; cz < 8; cz++) {
        worst = Math.max(worst, encodeChunk(w, cx, 0, cz).length);
      }
    }
    // Sans palette ni RLE il faudrait 4 096 octets. On exige au moins un
    // facteur 4 sur le pire chunk du monde — celui des rives, le plus bavard.
    expect(worst).toBeLessThan(CHUNK_VOLUME / 4);
  });

  it("les tissus vivants ne polluent pas le terrain", () => {
    // Sinon un organisme qui marche invaliderait son chunk à chaque tick.
    const w = flatWorld();
    const p = registerPlan(
      w,
      makePlan([
        [0, 0, 0, MOUTH],
        [1, 0, 0, NEURON],
      ]),
    );
    expect(spawnOrganism(w, p, 20, 1, 20, 60_000)).toBeGreaterThan(0);
    stepN(w, 3);
    const decoded = decodeChunk(encodeChunk(w, 1, 0, 1));
    expect(decoded.materials.some((m) => m === MOUTH || m === NEURON)).toBe(false);
  });

  it("l'index d'un chunk et ses coordonnées sont réciproques", () => {
    for (let i = 0; i < 128; i++) {
      const { cx, cy, cz } = chunkCoords(i);
      expect(chunkIndex(cx, cy, cz)).toBe(i);
    }
  });

  it("refuse une version de format inconnue au lieu de deviner", () => {
    const w = flatWorld();
    const bytes = encodeChunk(w, 0, 0, 0);
    bytes[0] = 99;
    expect(() => decodeChunk(bytes)).toThrow(/version/);
  });
});

describe("protocole dérivé — descripteur de corps", () => {
  it("un corps se redécode à l'identique, et pèse quelques dizaines d'octets", () => {
    const w = flatWorld();
    const p = registerPlan(
      w,
      makePlan([
        [0, 0, 0, MOUTH],
        [1, 0, 0, NEURON],
        [2, 0, 0, MOUTH],
      ]),
    );
    const id = spawnOrganism(w, p, 30, 1, 30, 200_000);
    stepN(w, 4); // le corps pousse jusqu'à son plan

    const bytes = encodeBody(w, id);
    const body = decodeBody(bytes);
    expect(body.id).toBe(id);
    expect(body.dx.length).toBe(w.bodyLen[id]);
    expect(bytes.length).toBeLessThan(64);

    // Chaque voxel décodé retombe exactement sur le voxel du monde.
    const base = w.bodySlot(id);
    for (let k = 0; k < body.dx.length; k++) {
      const i = w.bodyList[base + k]!;
      expect(body.x + body.dx[k]!).toBe(w.xOf(i));
      expect(body.y + body.dy[k]!).toBe(w.yOf(i));
      expect(body.z + body.dz[k]!).toBe(w.zOf(i));
      expect(body.mat[k]).toBe(w.material[i]);
    }
  });

  it("supporte les décalages négatifs", () => {
    const w = flatWorld();
    const p = registerPlan(
      w,
      makePlan([
        [0, 0, 0, MOUTH],
        [-1, 0, 0, NEURON],
        [0, 0, -1, MOUTH],
      ]),
    );
    const id = spawnOrganism(w, p, 40, 2, 40, 200_000);
    stepN(w, 4);
    const body = decodeBody(encodeBody(w, id));
    expect(Array.from(body.dx).some((v) => v < 0) || Array.from(body.dz).some((v) => v < 0)).toBe(
      true,
    );
    const base = w.bodySlot(id);
    for (let k = 0; k < body.dx.length; k++) {
      const i = w.bodyList[base + k]!;
      expect(body.x + body.dx[k]!).toBe(w.xOf(i));
      expect(body.z + body.dz[k]!).toBe(w.zOf(i));
    }
  });
});

describe("brouillard de guerre — ce que le serveur refuse d'envoyer", () => {
  it("un chunk lointain n'est pas visible, un chunk proche l'est", () => {
    expect(chunkVisible(0, 0, 0, 8, 8, 40)).toBe(true);
    expect(chunkVisible(7, 0, 7, 8, 8, 40)).toBe(false);
    // Le bord du chunk compte, pas son centre : on voit un chunk dès qu'un de
    // ses voxels est à portée.
    expect(chunkVisible(3, 0, 0, 40, 8, 10)).toBe(true);
  });

  it("un organisme hors de portée n'est pas visible", () => {
    expect(pointVisible(10, 10, 20, 20, 40)).toBe(true);
    expect(pointVisible(10, 10, 100, 100, 40)).toBe(false);
  });

  it("la portée est symétrique et ne dépend pas de la hauteur", () => {
    const rng = new SeededRng(3);
    for (let k = 0; k < 50; k++) {
      const ax = rng.below(128);
      const az = rng.below(128);
      const bx = rng.below(128);
      const bz = rng.below(128);
      expect(pointVisible(ax, az, bx, bz)).toBe(pointVisible(bx, bz, ax, az));
    }
  });
});

describe("le monde entier ne passe jamais sur le fil", () => {
  it("l'ensemble des chunks visibles pèse des dizaines de Ko, pas des Mo", () => {
    const w = new VoxelWorld(99);
    w.generateTerrain();
    const rng = new SeededRng(1);
    const p = registerPlan(w, makePlan([[0, 0, 0, MOUTH]]));
    for (let k = 0; k < 40; k++) {
      const spot = findSpawnSpot(w, rng);
      if (spot) spawnOrganism(w, p, spot.x, spot.y, spot.z);
    }
    stepN(w, 40);

    let bytes = 0;
    let chunks = 0;
    for (let cy = 0; cy < 2; cy++) {
      for (let cz = 0; cz < 8; cz++) {
        for (let cx = 0; cx < 8; cx++) {
          if (!chunkVisible(cx, cy, cz, 64, 64)) continue;
          bytes += encodeChunk(w, cx, cy, cz).length;
          chunks++;
        }
      }
    }
    expect(chunks).toBeGreaterThan(4);
    // La grille brute pèserait 524 288 octets rien qu'en matériaux.
    expect(bytes).toBeLessThan(60_000);
  });

  it("roche et biomasse restent lisibles après aller-retour", () => {
    const w = flatWorld();
    w.setMaterial(w.idx(12, 2, 12), BIOMASS, 1000);
    const d = decodeChunk(encodeChunk(w, 0, 0, 0));
    expect(Array.from(d.materials).filter((m) => m === ROCK).length).toBeGreaterThan(0);
    expect(Array.from(d.materials).filter((m) => m === BIOMASS).length).toBeGreaterThan(0);
  });
});
