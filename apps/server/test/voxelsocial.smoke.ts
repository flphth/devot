/**
 * Smoke test de la VIE SOCIALE (P5.4) et de l'ÉVEIL (P5.5).
 *
 * On vérifie ce qu'un client peut réellement obtenir du serveur : les pouvoirs
 * divins et leurs cooldowns, le registre des lignées et les pierres tombales,
 * le mode god, puis l'éveil d'un organisme — son monologue, son journal, et
 * l'énergie que sa pensée lui coûte.
 *
 * Lancement : MIND=mock tsx test/voxelsocial.smoke.ts
 */
import { createServer } from "node:http";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client } from "colyseus.js";
import {
  DIVINE_COOLDOWN_MS,
  VOXEL_ROOM_NAME,
  type DivineResultMsg,
  type RegistryMsg,
  type ThoughtMsg,
  type VoxelJournalMsg,
} from "@devot/shared";
import { VoxelWorldRoom } from "../src/voxel/VoxelWorldRoom.js";

process.env.MIND = process.env.MIND ?? "mock";
process.env.DEVOT_DB = ":memory:";
process.env.DEVOT_GOD_MODE = "1";

const PORT = 2597;
const SNAPSHOT = join(tmpdir(), `devot-social-smoke-${process.pid}.snapshot`);
let failures = 0;

function check(label: string, ok: boolean, extra = ""): void {
  console.log(`${ok ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  rmSync(SNAPSHOT, { force: true });
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: createServer() }),
  });
  gameServer.define(VOXEL_ROOM_NAME, VoxelWorldRoom, { freshWorld: true, snapshotPath: SNAPSHOT });
  await gameServer.listen(PORT);

  const client = new Client(`ws://localhost:${PORT}`);
  const room = await client.joinOrCreate(VOXEL_ROOM_NAME, { name: "Testeur" });
  room.onMessage("chunk", () => {});
  room.onMessage("body", () => {});

  const divine: DivineResultMsg[] = [];
  const thoughts: ThoughtMsg[] = [];
  let registry: RegistryMsg | null = null;
  let journal: VoxelJournalMsg | null = null;
  let awakenResult: { ok: boolean; reason?: string } | null = null;
  let wordResult: { ok: boolean; reason?: string; cooldownMs?: number } | null = null;
  let godResult: { ok: boolean; reason?: string } | null = null;

  room.onMessage("divineResult", (m: DivineResultMsg) => divine.push(m));
  room.onMessage("registry", (m: RegistryMsg) => (registry = m));
  room.onMessage("thought", (m: ThoughtMsg) => thoughts.push(m));
  room.onMessage("voxelJournal", (m: VoxelJournalMsg) => (journal = m));
  room.onMessage("awakenResult", (m: never) => (awakenResult = m));
  room.onMessage("divineWordResult", (m: never) => (wordResult = m));
  room.onMessage("godResult", (m: never) => (godResult = m));

  const state = () => room.state as any;
  await sleep(1200);
  check("le monde tourne", state().tick > 0, `tick ${state().tick}`);

  // Un organisme visible pour servir de cible.
  const visible: any[] = [];
  state().organisms?.forEach?.((o: any) => visible.push(o));
  check("des organismes sont visibles", visible.length > 0, `${visible.length}`);
  const target = visible[0];

  // ── Pouvoirs divins ────────────────────────────────────────────────────────
  room.send("divine", { power: "feed", x: target.x, z: target.z });
  await sleep(400);
  check("nourrir fonctionne", divine.at(-1)?.ok === true, divine.at(-1)?.reason ?? "");

  room.send("divine", { power: "feed", x: target.x, z: target.z });
  await sleep(400);
  const blocked = divine.at(-1);
  check(
    "et le cooldown est tenu par le SERVEUR",
    blocked?.ok === false && (blocked.cooldownMs ?? 0) > 0,
    `${Math.round((blocked?.cooldownMs ?? 0) / 100) / 10} s restantes sur ${DIVINE_COOLDOWN_MS.feed / 1000} s`,
  );

  room.send("divine", { power: "protect", organismId: target.id });
  await sleep(400);
  check("protéger fonctionne", divine.at(-1)?.ok === true, divine.at(-1)?.reason ?? "");

  // Hors de portée D'ABORD, tant que le cooldown de la foudre est intact :
  // sinon le refus viendrait du cooldown et le test passerait pour la mauvaise
  // raison — c'est exactement ce qui s'est produit à la première écriture.
  room.send("divine", { power: "smite", x: 120, z: 120 });
  await sleep(400);
  check(
    "on ne foudroie pas dans le brouillard",
    divine.at(-1)?.ok === false && divine.at(-1)?.reason !== "trop tôt",
    divine.at(-1)?.reason ?? "",
  );

  room.send("divine", { power: "smite", x: target.x, z: target.z });
  await sleep(500);
  check("foudroyer fonctionne à portée", divine.at(-1)?.ok === true, divine.at(-1)?.reason ?? "");

  // ── Mode god ───────────────────────────────────────────────────────────────
  room.send("godMode", { action: "biomass", x: 12, y: 5, z: 12 });
  await sleep(400);
  check("le mode god pose de la biomasse", (godResult as any)?.ok === true);
  room.send("godMode", { action: "spawn", x: 14, y: 2, z: 14 });
  await sleep(400);
  check("le mode god fait naître", (godResult as any)?.ok === true);

  // ── Registre et pierres tombales ───────────────────────────────────────────
  await sleep(2500); // le temps que des organismes meurent
  room.send("registry", {});
  await sleep(600);
  check("le registre répond", registry !== null);
  check(
    "des pierres tombales sont écrites",
    (registry as unknown as RegistryMsg)?.tombstones.length > 0,
    `${(registry as unknown as RegistryMsg)?.tombstones.length ?? 0} morts enregistrées`,
  );
  const t = (registry as unknown as RegistryMsg)?.tombstones[0];
  check(
    "et elles racontent quelque chose",
    !!t && t.diedTick >= t.bornTick && typeof t.cause === "string",
    t ? `#${t.organismId} gén ${t.generation}, ${t.cause}, ${t.eaten} ingérés` : "",
  );

  // ── L'éveil ────────────────────────────────────────────────────────────────
  const living: any[] = [];
  state().organisms?.forEach?.((o: any) => living.push(o));
  let awakenedId = 0;
  for (const o of living) {
    room.send("awaken", { organismId: o.id, name: "Premier" });
    await sleep(350);
    if ((awakenResult as any)?.ok) {
      awakenedId = o.id;
      break;
    }
  }
  check(
    "un organisme est éveillé",
    awakenedId > 0,
    awakenedId > 0 ? `#${awakenedId}` : ((awakenResult as any)?.reason ?? ""),
  );

  // Le verbe divin : 140 caractères, une fois par minute.
  room.send("divineWord", { organismId: awakenedId, text: "Tu n'es pas seul." });
  await sleep(400);
  check("le verbe divin passe", (wordResult as any)?.ok === true, (wordResult as any)?.reason ?? "");
  room.send("divineWord", { organismId: awakenedId, text: "Encore moi." });
  await sleep(400);
  check(
    "et il ne passe qu'une fois par minute",
    (wordResult as any)?.ok === false && ((wordResult as any)?.cooldownMs ?? 0) > 0,
    `${Math.round(((wordResult as any)?.cooldownMs ?? 0) / 1000)} s restantes`,
  );

  // La pensée arrive, et elle coûte.
  const energyBefore = living.find((o) => o.id === awakenedId)?.energy ?? 0;
  await sleep(14_000); // un éveillé pense toutes les 40 ticks, soit 10 s
  const thought = thoughts.find((t) => t.organismId === awakenedId);
  check(
    "l'éveillé pense, et son monologue arrive",
    !!thought && thought.monologue.length > 0,
    thought ? `« ${thought.monologue} » → ${thought.intent}` : "aucune pensée reçue",
  );
  check(
    "penser lui coûte de l'énergie",
    (thought?.energyCost ?? 0) > 0,
    thought
      ? `${thought.energyCost} d'énergie pour ${thought.inputTokens} tokens en entrée et ${thought.outputTokens} en sortie`
      : "",
  );
  void energyBefore;

  room.send("journal", awakenedId);
  await sleep(600);
  const j = journal as unknown as VoxelJournalMsg | null;
  check("son journal se relit", (j?.entries.length ?? 0) > 0, `${j?.entries.length ?? 0} entrées`);
  check(
    "et il dit avec quel esprit il pense",
    j?.mind === "mock" || j?.mind === "claude",
    `MIND=${j?.mind}`,
  );

  // On ne réveille pas un mort, ni un corps sans neurone.
  room.send("awaken", { organismId: 60000 });
  await sleep(300);
  check(
    "on ne réveille pas n'importe quoi",
    (awakenResult as any)?.ok === false,
    (awakenResult as any)?.reason ?? "",
  );

  await room.leave();
  await gameServer.gracefullyShutdown(false);
  rmSync(SNAPSHOT, { force: true });

  console.log(failures === 0 ? "\nTout est vert." : `\n${failures} vérification(s) en échec.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
