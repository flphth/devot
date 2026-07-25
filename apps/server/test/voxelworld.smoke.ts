/**
 * Smoke test du MONDE COMMUN (P5.3) : boote le serveur, s'y connecte comme un
 * vrai client, et vérifie les quatre promesses du jalon —
 *
 *   1. le client ne reçoit JAMAIS le monde, seulement du dérivé ;
 *   2. le brouillard est dans les données, pas dans le rendu ;
 *   3. un génome illégal est refusé, un génome légal est facturé et naît ;
 *   4. le monde survit à un redémarrage.
 *
 * Lancement : tsx test/voxelworld.smoke.ts
 */
import { createServer } from "node:http";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client } from "colyseus.js";
import { VOXEL_ROOM_NAME, type ReleaseResultMsg } from "@devot/shared";
import {
  CHUNK_VOLUME,
  MAX_BODY_VOXELS,
  SeededRng,
  chunkVisible,
  decodeBody,
  decodeChunk,
  encodeGenome,
  randomGenome,
} from "@devot/sim-voxel";
import { VoxelWorldRoom } from "../src/voxel/VoxelWorldRoom.js";

const PORT = 2598;
const SNAPSHOT = join(tmpdir(), `devot-voxel-smoke-${process.pid}.snapshot`);
let failures = 0;

function check(label: string, ok: boolean, extra = ""): void {
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function boot(freshWorld: boolean): Promise<Server> {
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: createServer() }),
  });
  gameServer.define(VOXEL_ROOM_NAME, VoxelWorldRoom, { freshWorld, snapshotPath: SNAPSHOT });
  await gameServer.listen(PORT);
  return gameServer;
}

async function main(): Promise<void> {
  rmSync(SNAPSHOT, { force: true });
  let gameServer = await boot(true);

  const client = new Client(`ws://localhost:${PORT}`);
  const room = await client.joinOrCreate(VOXEL_ROOM_NAME, { name: "Testeur" });

  const chunks: Uint8Array[] = [];
  const bodies: Uint8Array[] = [];
  let binaryBytes = 0;
  room.onMessage("chunk", (bytes: Uint8Array) => {
    chunks.push(bytes);
    binaryBytes += bytes.byteLength;
  });
  room.onMessage("body", (bytes: Uint8Array) => {
    bodies.push(bytes);
    binaryBytes += bytes.byteLength;
  });
  const releases: ReleaseResultMsg[] = [];
  room.onMessage("released", (msg: ReleaseResultMsg) => releases.push(msg));

  const state = () => room.state as any;

  await sleep(1200);
  check("le monde tourne tout seul", state().tick > 0, `tick ${state().tick}`);
  check("il est peuplé", state().population > 10, `${state().population} vivants`);

  // ── 1. Protocole dérivé ────────────────────────────────────────────────────
  check("des chunks de terrain arrivent", chunks.length > 0, `${chunks.length} chunks`);
  const decoded = chunks.length > 0 ? decodeChunk(chunks[0]!) : null;
  check(
    "un chunk se décode et couvre ses 4 096 voxels",
    decoded !== null && decoded.materials.length === CHUNK_VOLUME,
  );
  const avgChunk = chunks.length ? Math.round(binaryBytes / chunks.length) : 0;
  check(
    "un chunk pèse bien moins que ses voxels bruts",
    avgChunk > 0 && avgChunk < CHUNK_VOLUME / 4,
    `${avgChunk} octets en moyenne contre ${CHUNK_VOLUME} voxels`,
  );

  check("des descripteurs de corps arrivent", bodies.length > 0, `${bodies.length} corps`);
  const body = bodies.length > 0 ? decodeBody(bodies[0]!) : null;
  check(
    "un corps se décode dans les bornes du monde",
    body !== null && body.dx.length > 0 && body.dx.length <= MAX_BODY_VOXELS,
    body ? `#${body.id}, ${body.dx.length} voxels` : "",
  );

  // Le monde entier ferait 524 288 octets rien qu'en matériaux.
  check(
    "le total binaire reçu reste très en dessous du monde entier",
    binaryBytes < 200_000,
    `${(binaryBytes / 1024).toFixed(1)} Ko reçus`,
  );

  // ── 2. Brouillard : ce qui est loin n'arrive pas ───────────────────────────
  room.send("lookAt", { x: 20, z: 20 });
  await sleep(900);
  const visible = Object.values(state().organisms ?? {}) as any[];
  const outOfRange = visible.filter(
    (o) => (o.x - 20) * (o.x - 20) + (o.z - 20) * (o.z - 20) > 41 * 41,
  );
  check(
    "aucun organisme hors de portée n'est transmis",
    visible.length > 0 && outOfRange.length === 0,
    `${visible.length} visibles, ${outOfRange.length} hors portée`,
  );
  check(
    "et le monde en compte davantage que ce qu'on en voit",
    state().population > visible.length,
    `${state().population} vivants pour ${visible.length} visibles`,
  );
  // Le terrain aussi est filtré : aucun chunk reçu n'est hors de portée des
  // deux points de vue successifs (le centre du monde, puis 20,20).
  const farChunks = chunks
    .map((b) => decodeChunk(b))
    .filter(
      (c) =>
        !chunkVisible(c.cx, c.cy, c.cz, 64, 64) && !chunkVisible(c.cx, c.cy, c.cz, 20, 20),
    );
  check(
    "aucun chunk hors de portée n'est transmis",
    farChunks.length === 0,
    `${chunks.length} chunks reçus, ${farChunks.length} hors portée`,
  );

  // ── 3. Relâcher un génome ──────────────────────────────────────────────────
  room.send("release", { genome: "pas du base64 valide $$$" });
  await sleep(400);
  check(
    "un génome illisible est refusé",
    releases.at(-1)?.ok === false,
    releases.at(-1)?.reason ?? "",
  );

  // Un génome structurellement invalide : corps vide.
  const legal = randomGenome(new SeededRng(42).next(), 8);
  const truncated = encodeGenome(legal).slice(0, 12);
  room.send("release", { genome: Buffer.from(truncated).toString("base64") });
  await sleep(400);
  check(
    "un génome tronqué est refusé",
    releases.at(-1)?.ok === false,
    releases.at(-1)?.reason ?? "",
  );

  // Un génome qui se DÉCODE parfaitement mais viole les règles du monde : un
  // voxel détaché du corps. C'est le cas qui compte — un client malveillant
  // n'enverra pas des octets au hasard, il enverra une créature impossible.
  const detached = randomGenome(new SeededRng(7).next(), 6);
  detached.body.dx[detached.body.dx.length - 1] = 9;
  detached.body.dy[detached.body.dy.length - 1] = 9;
  detached.body.dz[detached.body.dz.length - 1] = 9;
  room.send("release", { genome: Buffer.from(encodeGenome(detached)).toString("base64") });
  await sleep(400);
  check(
    "un génome décodable mais illégal est refusé, avec son motif",
    releases.at(-1)?.ok === false && /détaché/.test(releases.at(-1)?.reason ?? ""),
    releases.at(-1)?.reason ?? "",
  );

  // Un corps trop gros pour le monde.
  const huge = randomGenome(new SeededRng(8).next(), 6);
  (huge as any).reproThreshold = 5000;
  room.send("release", { genome: Buffer.from(encodeGenome(huge)).toString("base64") });
  await sleep(400);
  check(
    "un génome aux paramètres hors bornes est refusé",
    releases.at(-1)?.ok === false,
    releases.at(-1)?.reason ?? "",
  );

  const before = state().population;
  room.send("release", { genome: Buffer.from(encodeGenome(legal)).toString("base64") });
  await sleep(700);
  const ok = releases.at(-1);
  check(
    "un génome légal est accepté, facturé, et naît dans le monde",
    ok?.ok === true && (ok.organismId ?? 0) > 0 && !!ok.receipt,
    ok?.ok ? `organisme #${ok.organismId}, reçu ${ok.receipt}` : (ok?.reason ?? ""),
  );
  check("la population reflète la naissance", state().population >= before);
  const gods: any[] = [];
  state().gods?.forEach?.((g: any) => gods.push(g));
  check(
    "le lâcher est compté au dieu",
    gods.length > 0 && gods[0].released > 0,
    `${gods.length} dieu(x) : ${gods.map((g: any) => `${g.name}=${g.released}`).join(", ")}`,
  );

  // ── 4. Débit ───────────────────────────────────────────────────────────────
  const bytesBefore = binaryBytes;
  await sleep(3000);
  const perSecond = (binaryBytes - bytesBefore) / 3;
  check(
    "le débit en régime établi reste de l'ordre de quelques Ko/s",
    perSecond < 40_000,
    `${(perSecond / 1024).toFixed(1)} Ko/s`,
  );

  const tickBefore = state().tick;
  await room.leave();
  await gameServer.gracefullyShutdown(false);

  // ── 5. Persistance et reprise ──────────────────────────────────────────────
  await sleep(300);
  gameServer = await boot(false);
  const client2 = new Client(`ws://localhost:${PORT}`);
  const room2 = await client2.joinOrCreate(VOXEL_ROOM_NAME, { name: "Revenant" });
  // Sans ces écouteurs, colyseus.js se plaint pour chaque message binaire reçu.
  room2.onMessage("chunk", () => {});
  room2.onMessage("body", () => {});
  room2.onMessage("released", () => {});
  await sleep(900);
  const state2 = room2.state as any;
  check(
    "le monde reprend là où il s'était arrêté",
    state2.tick >= tickBefore,
    `tick ${tickBefore} avant l'arrêt, ${state2.tick} après reprise`,
  );
  check(
    "et sa population a survécu au redémarrage",
    state2.population > 10,
    `${state2.population} vivants`,
  );

  await room2.leave();
  await gameServer.gracefullyShutdown(false);
  rmSync(SNAPSHOT, { force: true });

  console.log(failures === 0 ? "\nTout est vert." : `\n${failures} vérification(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
