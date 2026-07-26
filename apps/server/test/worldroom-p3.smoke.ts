/**
 * P3 smoke test: two gods in the same world, cross-line PvP, founder re-creation
 * once a line is extinct.
 * Deliberately white-box: we teleport the founders next to each other rather
 * than wait for an organic encounter; everything else goes through the real
 * systems (perception -> scripted "attack" mind -> combat -> death -> re-creation).
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

  check("both gods share the same room", roomA.roomId === roomB.roomId);
  await sleep(300);
  check("two gods in the state", state().gods.size === 2);

  roomA.send("createFounder", { name: "Kain", traits: ["fierce", "envious"] });
  roomB.send("createFounder", { name: "Abel", traits: ["peaceful", "pious"] });
  await sleep(800);
  check("two founders from different lines", state().devots.size === 2);

  // White-box: teleport the founders side by side, weaken Abel.
  const room = matchMaker.getLocalRoomById(roomA.roomId) as unknown as {
    world: { devots: Map<string, any> };
  };
  const devots = [...room.world.devots.values()];
  const kain = devots.find((d) => d.godId === "god-kain");
  const abel = devots.find((d) => d.godId === "god-abel");
  kain.pos = { x: 0, y: 0, z: 0 };
  abel.pos = { x: 2, y: 0, z: 0 };
  abel.balance = 2500;

  // Encounter -> "attack" thought -> hunt -> predation -> death.
  // Polling: mutual combat (both draining each other) can take 10-20 s.
  const kainHpBeforeKill = room.world.devots.get(kain.id)!.balance;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline && state().devots.get(abel.id)?.state !== "dead") {
    await sleep(500);
  }
  check(
    "Abel died in combat (cross-line PvP)",
    state().devots.get(abel.id)?.state === "dead",
  );
  check("Abel really was drained to nothing", state().devots.get(abel.id)?.balance === 0);
  console.log(
    `  (Kain: ${Math.round(kainHpBeforeKill)} balance before the killing blow, ${Math.round(room.world.devots.get(kain.id)!.balance)} after)`,
  );

  // Abel's line is extinct: his god may shape a founder anew.
  roomB.send("createFounder", { name: "Abel the Second", traits: ["cautious", "pious"] });
  await sleep(800);
  const abelGodDevots = [...state().devots.values()].filter(
    (d: any) => d.godId === "god-abel" && d.state !== "dead",
  );
  check("Abel's god shaped a new founder", abelGodDevots.length === 1);
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
