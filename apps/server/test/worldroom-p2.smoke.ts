/**
 * Smoke test P2 : reproduction observable dans la WorldRoom réelle.
 * L'esprit mock est scripté pour décider "reproduce" → l'enfant naît dans
 * l'état synchronisé, avec héritage de contexte (chroniqueur mock).
 */
import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client } from "colyseus.js";
import { ROOM_NAME } from "@devot/shared";
import { WorldRoom } from "../src/rooms/WorldRoom.js";

process.env.DEVOT_MOCK = "1";
process.env.DEVOT_DB = ":memory:";
process.env.DEVOT_MOCK_SCRIPT = "reproduce";

const PORT = 2601;
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

  const client = new Client(`ws://localhost:${PORT}`);
  const room = await client.joinOrCreate(ROOM_NAME, { godName: "Progeniteur" });
  const state = () => room.state as any;

  room.send("createFounder", { name: "Lilith", traits: ["curious", "generous"] });
  await sleep(800);
  check("fondatrice née", state().devots.size >= 1);

  // The birth thought (scripted "reproduce") triggers a budding.
  await sleep(3000);
  const count = state().devots.size;
  check(`descendance apparue (${count} devots)`, count >= 2);

  const devots = [...state().devots.values()] as any[];
  const child = devots.find((d) => !d.isFounder);
  const founder = devots.find((d) => d.isFounder);
  check("l'enfant appartient à la même lignée", child?.godId === founder?.godId);
  check(
    "procréer a épuisé le parent (HP < hpMax)",
    founder && founder.hp < founder.hpMax * 0.75,
  );
  check("l'enfant est vivant avec des HP", child && child.hp > 0 && child.state !== "dead");

  await room.leave();
  await gameServer.gracefullyShutdown(false);
  console.log(failures === 0 ? "\nSMOKE P2 OK" : `\nSMOKE P2 FAILED (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
