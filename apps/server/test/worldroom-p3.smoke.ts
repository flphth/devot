/**
 * Smoke test P3 : deux dieux dans le même monde, PvP inter-lignées,
 * recréation du fondateur après extinction de la lignée.
 * White-box assumé : on téléporte les fondateurs l'un près de l'autre pour ne
 * pas attendre une rencontre organique ; tout le reste passe par les vrais
 * systèmes (perception → esprit scripté "attack" → combat → mort → recréation).
 */
import { createServer } from "node:http";
import { matchMaker, Server } from "@colyseus/core";
import { Client } from "colyseus.js";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@devot/shared";
import { WorldRoom } from "../src/rooms/WorldRoom.js";

process.env.DEVOT_MOCK = "1";
process.env.DEVOT_DB = ":memory:";
process.env.DEVOT_MOCK_SCRIPT = "attack";

const PORT = 2603;
let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: createServer() }),
  });
  gameServer.define(ROOM_NAME, WorldRoom);
  await gameServer.listen(PORT);

  const clientA = new Client(`ws://localhost:${PORT}`);
  const clientB = new Client(`ws://localhost:${PORT}`);
  const roomA = await clientA.joinOrCreate(ROOM_NAME, { godName: "Kain" });
  const roomB = await clientB.join(ROOM_NAME, { godName: "Abel" });
  const state = () => roomA.state as any;

  check("les deux dieux partagent la même room", roomA.roomId === roomB.roomId);
  await sleep(300);
  check("deux dieux dans l'état", state().gods.size === 2);

  roomA.send("createFounder", { name: "Kain" });
  roomB.send("createFounder", { name: "Abel" });
  await sleep(800);
  check("deux fondateurs de lignées différentes", state().devots.size === 2);

  // White-box : téléporte les fondateurs côte à côte, affaiblit Abel.
  const room = matchMaker.getLocalRoomById(roomA.roomId) as unknown as {
    world: { devots: Map<string, any> };
  };
  const devots = [...room.world.devots.values()];
  const kain = devots.find((d) => d.godId === "god-kain");
  const abel = devots.find((d) => d.godId === "god-abel");
  kain.pos = { x: 0, y: 0, z: 0 };
  abel.pos = { x: 2, y: 0, z: 0 };
  abel.hp = 2500;

  // Rencontre → pensée "attack" → chasse → prédation → mort.
  // Poll : le combat mutuel (les deux se drainent) peut prendre 10-20 s.
  const kainHpBeforeKill = room.world.devots.get(kain.id)!.hp;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && state().devots.get(abel.id)?.state !== "mort") {
    await sleep(500);
  }
  check(
    "Abel est mort au combat (PvP inter-lignées)",
    state().devots.get(abel.id)?.state === "mort",
  );
  check("Abel a bien été drainé jusqu'à 0 HP", state().devots.get(abel.id)?.hp === 0);
  console.log(
    `  (Kain : ${Math.round(kainHpBeforeKill)} HP avant l'estocade, ${Math.round(room.world.devots.get(kain.id)!.hp)} après)`,
  );

  // La lignée d'Abel est éteinte : son dieu peut refaçonner un fondateur.
  roomB.send("createFounder", { name: "Abel-le-Second" });
  await sleep(800);
  const abelGodDevots = [...state().devots.values()].filter(
    (d: any) => d.godId === "god-abel" && d.state !== "mort",
  );
  check("le dieu d'Abel a refaçonné un fondateur", abelGodDevots.length === 1);
  check(
    "le nouveau fondateur est bien un fondateur",
    abelGodDevots[0]?.isFounder === true,
  );

  await roomA.leave();
  await roomB.leave();
  await gameServer.gracefullyShutdown(false);
  console.log(failures === 0 ? "\nSMOKE P3 OK" : `\nSMOKE P3 FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
