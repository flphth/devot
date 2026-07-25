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

  const state = () => room.state as any;

  // 1. Création du fondateur — traits obligatoires (2 à 3, issus du pool)
  room.send("createFounder", { name: "Sans-Traits" });
  await sleep(400);
  check("création sans traits rejetée", state().devots.size === 0);
  room.send("createFounder", { name: "Ève", traits: ["curieux", "pieux", "inexistant"] });
  await sleep(400);
  check("création avec trait hors pool rejetée", state().devots.size === 0);

  room.send("createFounder", { name: "Ève", traits: ["curieux", "pieux"] });
  await sleep(600);
  check("le fondateur apparaît dans l'état", state().devots.size === 1);

  const devotId: string = [...state().devots.keys()][0] as string;
  const devot = state().devots.get(devotId);
  check("le fondateur appartient au dieu", devot.godId === godId);
  check("le fondateur est vivant avec des HP", devot.hp > 0 && devot.state !== "mort");

  // 2. Un second fondateur est refusé tant que le premier vit
  room.send("createFounder", { traits: ["prudent", "pieux"] });
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

  // 4. Nourrir. On dépose à des coordonnées explicites LOIN des devots :
  // déposée près d'un devot, la nourriture peut être mangée avant qu'on
  // l'observe (le rayon de repas est plus petit que la dispersion du don),
  // ce qui rendrait le test instable.
  const godFood = () =>
    [...state().food.values()].filter((f: any) => f.source === "god").length;
  const godFoodBefore = godFood();
  room.send("feed", { x: -27, z: 27 });
  await sleep(600);
  check("feed dépose une nourriture de source 'god'", godFood() > godFoodBefore);

  // Et la variante « près de mon devot » ne doit pas être rejetée.
  const rejectionsBeforeFeed = rejections.length;
  room.send("feed", { devotId });
  await sleep(400);
  check("feed ciblant un devot est accepté", rejections.length === rejectionsBeforeFeed);

  // 5. Le devot pense (MockMind) : thinking repasse à false et l'état vit
  await sleep(2000);
  check("le devot n'est pas bloqué en 'thinking'", state().devots.get(devotId).thinking === false);
  check(
    "le monologue intérieur est synchronisé",
    typeof state().devots.get(devotId).thought === "string" &&
      state().devots.get(devotId).thought.length > 0,
  );

  // 6. Journal du panneau « Esprit »
  const journal: any = await new Promise((resolve) => {
    room.onMessage("journal", (m: any) => resolve(m));
    room.send("getJournal", { devotId });
  });
  check(
    "journal reçu avec événements et décisions datés",
    journal.devotId === devotId &&
      journal.entries.length >= 2 &&
      journal.entries.every((e: any) => typeof e.at === "number") &&
      journal.entries.some((e: any) => e.kind === "decision" && e.thought),
  );

  // 7. Foudre divine : ownership + mort standard
  let smiteFx = false;
  room.onMessage("smite", () => (smiteFx = true));
  room.send("smite", { devotId });
  await sleep(500);
  check("le devot foudroyé est mort", state().devots.get(devotId).state === "mort");
  check("l'effet d'éclair est diffusé", smiteFx);

  // 8. Mode god : spawn debug + déplacement de nourriture
  room.send("debugSpawnDevot", { x: 5, z: 5 });
  await sleep(500);
  check("debugSpawnDevot fait naître un devot", state().devots.size === 2);
  const foodId = [...state().food.keys()][0] as string | undefined;
  if (foodId) {
    room.send("debugMoveFood", { foodId, x: -9, z: -9 });
    await sleep(400);
    const f = state().food.get(foodId);
    check("debugMoveFood déplace la nourriture", f.x === -9 && f.z === -9);
  } else {
    check("debugMoveFood déplace la nourriture (pas de nourriture à tester)", true);
  }

  await room.leave();
  await gameServer.gracefullyShutdown(false);

  console.log(failures === 0 ? "\nSMOKE OK" : `\nSMOKE FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
