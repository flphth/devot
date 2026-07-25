/**
 * Smoke test P1 (script, pas vitest) : boote le serveur, s'y connecte avec
 * colyseus.js, et vérifie les validations autoritaires de la WorldRoom.
 * Lancement : tsx test/worldroom.smoke.ts (DEVOT_MOCK=1, DB en mémoire).
 */
import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client } from "colyseus.js";
import { ROOM_NAME } from "@devot/shared";
import { WorldRoom } from "../src/rooms/WorldRoom.js";

process.env.DEVOT_MOCK = "1";
process.env.DEVOT_DB = ":memory:";

const PORT = 2599;
let failures = 0;

function check(label: string, ok: boolean): void {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: createServer() }),
  });
  gameServer.define(ROOM_NAME, WorldRoom);
  await gameServer.listen(PORT);

  const client = new Client(`ws://localhost:${PORT}`);
  const room = await client.joinOrCreate(ROOM_NAME, { godName: "Testeur" });

  const rejections: string[] = [];
  let godId = "";
  room.onMessage("welcome", (msg: { godId: string }) => (godId = msg.godId));
  room.onMessage("rejected", (msg: { reason: string }) => rejections.push(msg.reason));

  await sleep(300);
  check("welcome reçu avec godId", godId.startsWith("god-"));

  // 1. Création du fondateur
  room.send("createFounder", { name: "Ève" });
  await sleep(600);
  const state = () => room.state as any;
  check("le fondateur apparaît dans l'état", state().devots.size === 1);

  const devotId: string = [...state().devots.keys()][0] as string;
  const devot = state().devots.get(devotId);
  check("le fondateur appartient au dieu", devot.godId === godId);
  check("le fondateur est vivant avec des HP", devot.hp > 0 && devot.state !== "mort");

  // 2. Un second fondateur est refusé tant que le premier vit
  room.send("createFounder", {});
  await sleep(400);
  check("recréation refusée (fondateur vivant)", state().devots.size === 1);

  // 3. Verbe divin : 140c max, cooldown 60 s autoritaire
  room.send("speak", { devotId, text: "x".repeat(200) });
  await sleep(300);
  check("speak > 140c rejeté", rejections.some((r) => r.includes("caractères")));

  room.send("speak", { devotId, text: "Cherche la nourriture, mon enfant." });
  await sleep(300);
  check("speak valide accepté (lastSpeakAt posé)", state().gods.get(godId).lastSpeakAt > 0);

  const before = rejections.length;
  room.send("speak", { devotId, text: "Encore moi." });
  await sleep(300);
  check(
    "second speak sous 60 s rejeté (cooldown autoritaire)",
    rejections.length > before && rejections[rejections.length - 1]!.includes("reposer"),
  );

  // 4. Nourrir : la nourriture "don" apparaît près du devot
  const foodBefore = state().food.size;
  room.send("feed", { devotId });
  await sleep(600);
  check("feed fait apparaître une nourriture 'god'", state().food.size > foodBefore);

  // 5. Le devot pense (MockMind) : thinking repasse à false et l'état vit
  await sleep(2000);
  check("le devot n'est pas bloqué en 'thinking'", state().devots.get(devotId).thinking === false);

  await room.leave();
  await gameServer.gracefullyShutdown(false);

  console.log(failures === 0 ? "\nSMOKE OK" : `\nSMOKE FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
