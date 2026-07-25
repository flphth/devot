import { Client, Room } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import { FreeStubProvider, type PaymentProvider } from "@devot/onchain";
import {
  MSG_BODY,
  MSG_CHUNK,
  MSG_WANT_BODY,
  VOXEL_TICK_MS,
  VoxelGodState,
  VoxelOrganismState,
  VoxelWorldState,
  type LookAtMsg,
  type ReleaseGenomeMsg,
  type ReleaseResultMsg,
} from "@devot/shared";
import {
  ALIVE,
  CX,
  CY,
  CZ,
  MAX_ORGANISMS,
  SX,
  SZ,
  SeededRng,
  VIEW_RADIUS,
  VoxelWorld,
  chunkCoords,
  chunkIndex,
  chunkVisible,
  collectStats,
  decodeGenome,
  encodeBody,
  encodeChunk,
  findSpawnSpot,
  pointVisible,
  randomGenome,
  registerGenome,
  spawnFromGenome,
  spawnOrganism,
  step,
  validateGenome,
} from "@devot/sim-voxel";
import { loadSnapshot, saveSnapshot } from "./snapshot.js";

const GOD_COLORS = ["#e0b34c", "#4ca6e0", "#9c4ce0", "#4ce07a", "#e04c5f"];

/** Énergie offerte à une créature relâchée : de quoi pousser et chercher. */
const RELEASE_ENERGY = 40_000;
/** Fondateurs semés quand le monde naît pour la première fois. */
const SEED_POPULATION = 160;
/** Sauvegarde toutes les N ticks (4 ticks/s → toutes les 30 s). */
const SNAPSHOT_EVERY = 120;

interface Watcher {
  view: StateView;
  eyeX: number;
  eyeZ: number;
  /** Version de chunk déjà envoyée, par index de chunk. */
  sentChunk: Int32Array;
  /** Version de morphologie déjà envoyée, par organisme. */
  sentShape: Int32Array;
  bytesSent: number;
}

/**
 * LE MONDE COMMUN.
 *
 * Une seule instance du monde, simulée ici, en continu, qu'il y ait des
 * spectateurs ou non. C'est le point non négociable du pivot : le coût de
 * simulation est par MONDE, pas par joueur — dix mille connectés ne coûtent pas
 * plus cher à simuler qu'un seul.
 *
 * Ce que le client reçoit est DÉRIVÉ, jamais le monde :
 * - les chunks de terrain qui ont changé ET qu'il peut voir, en binaire brut ;
 * - le descripteur de corps d'un organisme, une fois, puis plus rien tant que
 *   sa morphologie ne change pas ;
 * - l'état par tick des organismes visibles, via `@colyseus/schema`, qui n'envoie
 *   que les deltas.
 *
 * Le BROUILLARD est ici, pas dans le rendu : ce qui est hors de portée n'est
 * jamais transmis. Un client modifié ne voit pas plus loin, il n'a rien à voir.
 */
export class VoxelWorldRoom extends Room<VoxelWorldState> {
  private world!: VoxelWorld;
  private lineageOf = new Map<number, string>();
  /** Version de morphologie par organisme : change quand le corps change. */
  private shapeOf = new Int32Array(MAX_ORGANISMS);
  private lastBodyLen = new Int32Array(MAX_ORGANISMS);
  private watchers = new Map<string, Watcher>();
  private payments: PaymentProvider = new FreeStubProvider();
  private snapshotPath =
    process.env.DEVOT_WORLD_SNAPSHOT ?? new URL("../../world.snapshot", import.meta.url).pathname;
  private ticksSinceSave = 0;
  /** Débit mesuré, tous clients confondus, sur la dernière seconde. */
  private bytesThisSecond = 0;
  private lastRateAt = 0;
  bytesPerSecond = 0;

  onCreate(options: { seed?: number; freshWorld?: boolean; snapshotPath?: string } = {}): void {
    if (options.snapshotPath) this.snapshotPath = options.snapshotPath;

    const restored = options.freshWorld ? null : loadSnapshot(this.snapshotPath);
    if (restored) {
      this.world = restored.world;
      this.lineageOf = restored.lineageOf;
      console.log(
        `[monde] repris au tick ${this.world.tick} avec ${this.lineageOf.size} organismes.`,
      );
    } else {
      this.world = new VoxelWorld(options.seed ?? 20260725);
      this.world.generateTerrain();
      this.seedFounders();
      console.log(`[monde] monde neuf, graine ${this.world.seed}.`);
    }

    this.state = new VoxelWorldState();
    this.syncEntities();

    this.onMessage("lookAt", (client, msg: LookAtMsg) => this.onLookAt(client, msg));
    this.onMessage("release", (client, msg: ReleaseGenomeMsg) => this.onRelease(client, msg));
    this.onMessage(MSG_WANT_BODY, (client, id: number) => this.sendBody(client, id, true));

    this.setSimulationInterval(() => this.onTick(), VOXEL_TICK_MS);
  }

  /** Peuplement initial : le monde ne doit pas être vide en attendant les dieux. */
  private seedFounders(): void {
    const rng = new SeededRng(this.world.seed ^ 0x9911);
    for (let n = 0; n < SEED_POPULATION; n++) {
      const slot = registerGenome(this.world, randomGenome(rng.next(), 6 + rng.below(6)));
      const spot = findSpawnSpot(this.world, rng);
      if (spot) spawnOrganism(this.world, slot, spot.x, spot.y, spot.z);
    }
  }

  onJoin(client: Client, options: { name?: string } = {}): void {
    const view = new StateView();
    client.view = view;

    const god = new VoxelGodState();
    god.id = client.sessionId;
    god.name = (options.name ?? "Dieu sans nom").slice(0, 24);
    god.color = GOD_COLORS[this.state.gods.size % GOD_COLORS.length]!;
    this.state.gods.set(client.sessionId, god);

    this.watchers.set(client.sessionId, {
      view,
      eyeX: SX >> 1,
      eyeZ: SZ >> 1,
      sentChunk: new Int32Array(CX * CY * CZ).fill(-1),
      sentShape: new Int32Array(MAX_ORGANISMS).fill(-1),
      bytesSent: 0,
    });
    // Premier envoi : tout ce qui est visible depuis le centre du monde.
    this.streamTo(client);
  }

  onLeave(client: Client): void {
    this.watchers.delete(client.sessionId);
    this.state.gods.delete(client.sessionId);
  }

  private onLookAt(client: Client, msg: LookAtMsg): void {
    const watcher = this.watchers.get(client.sessionId);
    if (!watcher) return;
    watcher.eyeX = clamp(Math.round(msg.x), 0, SX - 1);
    watcher.eyeZ = clamp(Math.round(msg.z), 0, SZ - 1);
  }

  /**
   * RELÂCHER un génome. Le serveur ne fait confiance à rien de ce qui arrive :
   * il décode, il valide avec le MÊME prédicat que le laboratoire, puis il
   * facture. La créature paiera ensuite le coût métabolique de son corps comme
   * n'importe quelle autre — inutile de lui demander de prouver son évolution.
   */
  private async onRelease(client: Client, msg: ReleaseGenomeMsg): Promise<void> {
    const reject = (reason: string) =>
      client.send("released", { ok: false, reason } satisfies ReleaseResultMsg);

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(String(msg?.genome ?? ""), "base64"));
    } catch {
      return reject("génome illisible");
    }
    const genome = decodeGenome(bytes);
    if (!genome) return reject("génome illisible");

    const bad = validateGenome(genome);
    if (bad) return reject(bad.reason);

    const spot = findSpawnSpot(this.world, new SeededRng((this.world.tick ^ bytes.length) | 1));
    if (!spot) return reject("aucun emplacement libre dans le monde");

    const receipt = await this.payments.chargeDevotCreation(client.sessionId);
    if (!receipt.ok) return reject("paiement refusé");

    const id = spawnFromGenome(this.world, genome, spot.x, spot.y, spot.z, RELEASE_ENERGY, 0);
    if (id === 0) return reject("le monde a refusé la naissance");

    this.lineageOf.set(id, client.sessionId);
    const god = this.state.gods.get(client.sessionId);
    if (god) god.released++;

    client.send("released", {
      ok: true,
      organismId: id,
      receipt: receipt.ref,
    } satisfies ReleaseResultMsg);
  }

  private onTick(): void {
    step(this.world);
    this.syncEntities();
    for (const client of this.clients) this.streamTo(client);

    const now = Date.now();
    if (this.lastRateAt === 0) this.lastRateAt = now;
    if (now - this.lastRateAt >= 1000) {
      this.bytesPerSecond = (this.bytesThisSecond * 1000) / (now - this.lastRateAt);
      this.bytesThisSecond = 0;
      this.lastRateAt = now;
    }

    if (++this.ticksSinceSave >= SNAPSHOT_EVERY) {
      this.ticksSinceSave = 0;
      this.persist();
    }
  }

  persist(): number {
    try {
      return saveSnapshot(this.snapshotPath, this.world, { lineageOf: this.lineageOf });
    } catch (err) {
      console.warn(`[monde] sauvegarde impossible : ${String(err)}`);
      return 0;
    }
  }

  /** Recopie l'état vivant dans le schéma. Les morts sortent, les nouveaux entrent. */
  private syncEntities(): void {
    const w = this.world;
    const living = new Set<string>();
    const perGod = new Map<string, number>();

    for (let id = 1; id < MAX_ORGANISMS; id++) {
      if (w.orgState[id] !== ALIVE) continue;
      const key = String(id);
      living.add(key);

      // La morphologie a-t-elle changé ? On compare la taille du corps : c'est
      // le signal le moins cher, et une croissance ou une amputation est
      // exactement ce qui oblige le client à remailler.
      const len = w.bodyLen[id]!;
      if (this.lastBodyLen[id] !== len) {
        this.lastBodyLen[id] = len;
        this.shapeOf[id] = (this.shapeOf[id]! + 1) & 0xffff;
      }

      let ent = this.state.organisms.get(key);
      if (!ent) {
        ent = new VoxelOrganismState();
        ent.id = id;
        ent.lineage = this.lineageOf.get(id) ?? "";
        this.state.organisms.set(key, ent);
      }
      const seed = w.seedIdx[id]!;
      ent.x = w.xOf(seed);
      ent.y = w.yOf(seed);
      ent.z = w.zOf(seed);
      const cap = w.capacity[id]! || 1;
      ent.energy = clamp(((w.energy[id]! * 1000) / cap) | 0, 0, 1000);
      ent.generation = Math.min(65_535, w.generation[id]!);
      ent.shape = this.shapeOf[id]!;

      const lineage = ent.lineage;
      if (lineage) perGod.set(lineage, (perGod.get(lineage) ?? 0) + 1);
    }

    for (const key of [...this.state.organisms.keys()]) {
      if (living.has(key)) continue;
      this.state.organisms.delete(key);
      const id = Number(key);
      this.lineageOf.delete(id);
      this.lastBodyLen[id] = 0;
    }

    for (const [sessionId, god] of this.state.gods) {
      god.living = perGod.get(sessionId) ?? 0;
    }

    const s = collectStats(w);
    this.state.tick = w.tick;
    this.state.population = Math.min(65_535, s.population);
    this.state.maxGeneration = Math.min(65_535, s.maxGeneration);
    this.state.biomass = s.biomassVoxels;
    this.state.avgBodyVoxels = s.avgBodyVoxels;
    this.state.avgNeurons = s.avgNeurons;
  }

  /**
   * Ce qu'un client reçoit ce tick-ci : les chunks visibles qui ont changé, les
   * corps qu'il ne connaît pas encore, et la mise à jour de sa vue.
   */
  private streamTo(client: Client): void {
    const watcher = this.watchers.get(client.sessionId);
    if (!watcher) return;
    const w = this.world;

    // 1. Terrain : visible ET changé depuis le dernier envoi.
    let chunkBudget = 24; // borne par tick, pour ne pas saturer à l'arrivée
    for (let ci = 0; ci < watcher.sentChunk.length && chunkBudget > 0; ci++) {
      const version = w.chunkVersion[ci]!;
      if (watcher.sentChunk[ci] === version) continue;
      const { cx, cy, cz } = chunkCoords(ci);
      if (!chunkVisible(cx, cy, cz, watcher.eyeX, watcher.eyeZ)) continue;
      const bytes = encodeChunk(w, cx, cy, cz);
      client.send(MSG_CHUNK, bytes);
      watcher.sentChunk[ci] = version;
      this.countBytes(watcher, bytes.byteLength);
      chunkBudget--;
    }

    // 2. Organismes : la VUE décide de ce qui existe pour ce client.
    for (const [key, ent] of this.state.organisms) {
      const id = Number(key);
      const visible = pointVisible(ent.x, ent.z, watcher.eyeX, watcher.eyeZ, VIEW_RADIUS);
      const known = watcher.view.has(ent);
      if (visible && !known) {
        watcher.view.add(ent);
        this.sendBody(client, id, false);
      } else if (!visible && known) {
        watcher.view.remove(ent);
        watcher.sentShape[id] = -1;
      } else if (visible && watcher.sentShape[id] !== this.shapeOf[id]) {
        // Le corps a changé de forme : le client doit remailler.
        this.sendBody(client, id, false);
      }
    }
  }

  /** Envoie le descripteur de corps. `forced` répond à une demande du client. */
  private sendBody(client: Client, id: number, forced: boolean): void {
    const watcher = this.watchers.get(client.sessionId);
    if (!watcher) return;
    if (this.world.orgState[id] !== ALIVE) return;

    // Anti-triche : on ne décrit pas un corps que le client n'a pas le droit de
    // voir, même s'il le réclame nommément.
    const seed = this.world.seedIdx[id]!;
    if (
      !pointVisible(
        this.world.xOf(seed),
        this.world.zOf(seed),
        watcher.eyeX,
        watcher.eyeZ,
        VIEW_RADIUS,
      )
    ) {
      return;
    }
    if (!forced && watcher.sentShape[id] === this.shapeOf[id]) return;

    const bytes = encodeBody(this.world, id);
    client.send(MSG_BODY, bytes);
    watcher.sentShape[id] = this.shapeOf[id]!;
    this.countBytes(watcher, bytes.byteLength);
  }

  private countBytes(watcher: Watcher, n: number): void {
    watcher.bytesSent += n;
    this.bytesThisSecond += n;
  }

  /** Octets binaires envoyés à un client depuis sa connexion (mesure des tests). */
  bytesSentTo(sessionId: string): number {
    return this.watchers.get(sessionId)?.bytesSent ?? 0;
  }

  onDispose(): void {
    this.persist();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Index de chunk, réexporté pour les tests de la room. */
export { chunkIndex };
