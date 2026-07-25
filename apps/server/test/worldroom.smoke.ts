/**
 * P1 smoke test (a script, not vitest): boots the server, connects to it with
 * colyseus.js, and checks the WorldRoom's authoritative validations.
 * Run with: tsx test/worldroom.smoke.ts (DEVOT_MOCK=1, in-memory DB).
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
  check("welcome received with a godId", godId.startsWith("god-"));

  const state = () => room.state as any;

  // 1. Founder creation — traits are mandatory (2 to 3, drawn from the pool)
  room.send("createFounder", { name: "Sans-Traits" });
  await sleep(400);
  check("creation with no traits refused", state().devots.size === 0);
  room.send("createFounder", { name: "Eve", traits: ["curious", "pious", "nonexistent"] });
  await sleep(400);
  check("creation with an off-pool trait refused", state().devots.size === 0);

  room.send("createFounder", { name: "Eve", traits: ["curious", "pious"] });
  await sleep(600);
  check("the founder shows up in the state", state().devots.size === 1);

  const devotId: string = [...state().devots.keys()][0] as string;
  const devot = state().devots.get(devotId);
  check("le fondateur appartient au dieu", devot.godId === godId);
  check("the founder is alive with HP", devot.hp > 0 && devot.state !== "dead");

  // 2. A second founder is refused while the first one lives
  room.send("createFounder", { traits: ["cautious", "pious"] });
  await sleep(400);
  check("re-creation refused (founder alive)", state().devots.size === 1);

  // 3. Divine word: 140 chars max, authoritative 60 s cooldown
  room.send("speak", { devotId, text: "x".repeat(200) });
  await sleep(300);
  check("speak over 140 chars refused", rejections.some((r) => r.includes("characters")));

  room.send("speak", { devotId, text: "Seek out food, my child." });
  await sleep(300);
  check("valid speak accepted (lastSpeakAt set)", state().gods.get(godId).lastSpeakAt > 0);

  const before = rejections.length;
  room.send("speak", { devotId, text: "Encore moi." });
  await sleep(300);
  check(
    "second speak within 60 s refused (authoritative cooldown)",
    rejections.length > before && rejections[rejections.length - 1]!.includes("rest"),
  );

  // 4. Feeding: the gifted food appears near the devot
  const foodBefore = state().food.size;
  room.send("feed", { devotId });
  await sleep(600);
  check("feed makes a 'god' food appear", state().food.size > foodBefore);

  // 5. The devot thinks (MockMind): thinking flips back to false and the state lives
  await sleep(2000);
  check("the devot is not stuck in 'thinking'", state().devots.get(devotId).thinking === false);
  check(
    "the inner monologue is synchronised",
    typeof state().devots.get(devotId).thought === "string" &&
      state().devots.get(devotId).thought.length > 0,
  );

  // 6. Journal du panneau « Esprit »
  const journal: any = await new Promise((resolve) => {
    room.onMessage("journal", (m: any) => resolve(m));
    room.send("getJournal", { devotId });
  });
  check(
    "journal received with timestamped events and decisions",
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
  check("the smitten devot is dead", state().devots.get(devotId).state === "dead");
  check("the lightning effect is broadcast", smiteFx);

  // 8. God mode: debug spawn + moving food around
  room.send("debugSpawnDevot", { x: 5, z: 5 });
  await sleep(500);
  check("debugSpawnDevot brings a devot into the world", state().devots.size === 2);
  const foodId = [...state().food.keys()][0] as string | undefined;
  if (foodId) {
    room.send("debugMoveFood", { foodId, x: -9, z: -9 });
    await sleep(400);
    const f = state().food.get(foodId);
    check("debugMoveFood moves the food", f.x === -9 && f.z === -9);
  } else {
    check("debugMoveFood moves the food (no food to test with)", true);
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
