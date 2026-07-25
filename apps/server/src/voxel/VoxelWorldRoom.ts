import { Client, Room } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import {
  createAwakenedMind,
  thoughtEnergyCost,
  type AwakenedMind,
  type AwakenedThought,
} from "@devot/agents";
import { openDb, VoxelRegistryRepo } from "@devot/db";
import { FreeStubProvider, type PaymentProvider } from "@devot/onchain";
import {
  DIVINE_COOLDOWN_MS,
  DIVINE_WORD_COOLDOWN_MS,
  DIVINE_WORD_MAX_CHARS,
  MSG_BODY,
  MSG_CHUNK,
  MSG_JOURNAL,
  MSG_REGISTRY,
  MSG_THOUGHT,
  MSG_WANT_BODY,
  PROTECT_TICKS,
  VOXEL_TICK_MS,
  VoxelGodState,
  VoxelOrganismState,
  VoxelWorldState,
  type AwakenMsg,
  type DivineActMsg,
  type DivineWordMsg,
  type DivinePower,
  type DivineResultMsg,
  type GodModeMsg,
  type LookAtMsg,
  type RegistryMsg,
  type ReleaseGenomeMsg,
  type ReleaseResultMsg,
  type ThoughtMsg,
  type VoxelJournalMsg,
} from "@devot/shared";
import {
  ALIVE,
  BIOMASS,
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
  NUTRIENT_FRESH,
  ROCK,
  VOID,
  collectStats,
  damageVoxel,
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

  // ── P5.4 : vie sociale ────────────────────────────────────────────────────
  /** Registre des lignées et cimetière. Persiste au-delà des individus. */
  private registry: VoxelRegistryRepo | null = null;
  /** Dernier usage de chaque pouvoir, par dieu : le cooldown vit ICI. */
  private lastPowerAt = new Map<string, Partial<Record<DivinePower, number>>>();
  /** Tick jusqu'auquel un organisme est protégé par un dieu. */
  private protectedUntil = new Int32Array(MAX_ORGANISMS);
  /** Mode god : réservé, et volontairement explicite. */
  private godModeEnabled = process.env.DEVOT_GOD_MODE === "1";
  /** Ce que le monde savait de chaque vivant, pour écrire sa pierre tombale. */
  private lastSeen = new Map<number, { generation: number; bornTick: number; body: number; eaten: number; bites: number; bitten: number; crossbred: boolean; lineage: string }>();

  // ── P5.5 : l'éveil ────────────────────────────────────────────────────────
  /**
   * Les éveillés. Peu nombreux par construction : chaque pensée est une requête
   * réelle, et une dépense d'énergie réelle. Le serveur seul détient les
   * identifiants — un client ne peut pas faire penser une créature pour son
   * compte, il peut seulement lui parler.
   */
  private awakened = new Map<number, { name: string; godId: string; journal: ThoughtMsg[] }>();
  private thinking = new Set<number>();
  private lastWordAt = new Map<string, number>();
  private pendingWord = new Map<number, string>();
  private mind: AwakenedMind = createAwakenedMind().mind;
  private mindKind = createAwakenedMind().kind;
  /** Un éveillé pense toutes les N ticks : penser en continu le ruinerait. */
  private static readonly THINK_EVERY = 40;

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
    this.onMessage("divine", (client, msg: DivineActMsg) => this.onDivine(client, msg));
    this.onMessage("godMode", (client, msg: GodModeMsg) => this.onGodMode(client, msg));
    this.onMessage("registry", (client) => this.sendRegistry(client));
    this.onMessage("awaken", (client, msg: AwakenMsg) => this.onAwaken(client, msg));
    this.onMessage("divineWord", (client, msg: DivineWordMsg) => this.onDivineWord(client, msg));
    this.onMessage("journal", (client, id: number) => this.sendJournal(client, id));

    try {
      this.registry = new VoxelRegistryRepo(openDb(process.env.DEVOT_DB ?? ":memory:"));
    } catch (err) {
      // Le monde doit tourner même sans base : le registre est une mémoire,
      // pas une dépendance de la simulation.
      console.warn(`[monde] registre indisponible : ${String(err)}`);
    }

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
    this.registry?.registerLineage({
      id: client.sessionId,
      godId: client.sessionId,
      name: (msg.name ?? god?.name ?? "lignée sans nom").slice(0, 40),
      releasedTick: this.world.tick,
    });

    client.send("released", {
      ok: true,
      organismId: id,
      receipt: receipt.ref,
    } satisfies ReleaseResultMsg);
  }

  /**
   * LES POUVOIRS DIVINS. Le cooldown est tenu par le serveur, pas affiché par le
   * client : c'est la seule façon qu'il ait un sens. Le client reçoit le temps
   * restant pour pouvoir l'afficher, mais il ne le décide pas.
   */
  private onDivine(client: Client, msg: DivineActMsg): void {
    const power = msg?.power;
    const reply = (r: DivineResultMsg) => client.send("divineResult", r);
    if (power !== "feed" && power !== "protect" && power !== "smite") {
      return reply({ ok: false, power: "feed", reason: "pouvoir inconnu" });
    }

    const now = Date.now();
    const used = this.lastPowerAt.get(client.sessionId) ?? {};
    const since = now - (used[power] ?? -Infinity);
    const cooldown = DIVINE_COOLDOWN_MS[power];
    if (since < cooldown) {
      return reply({ ok: false, power, reason: "trop tôt", cooldownMs: cooldown - since });
    }

    // La portée d'un dieu est celle de son regard : on n'agit pas dans le
    // brouillard. C'est la même règle que pour voir, et pour la même raison.
    const watcher = this.watchers.get(client.sessionId);
    if (!watcher) return reply({ ok: false, power, reason: "observateur inconnu" });

    let done = false;
    if (power === "feed") {
      done = this.feed(msg, watcher);
    } else if (power === "protect") {
      done = this.protect(msg, watcher);
    } else {
      done = this.smite(msg, watcher);
    }
    if (!done) return reply({ ok: false, power, reason: "cible hors de portée ou invalide" });

    used[power] = now;
    this.lastPowerAt.set(client.sessionId, used);
    reply({ ok: true, power, cooldownMs: cooldown });
  }

  /** NOURRIR : de la biomasse fraîche apparaît. C'est une entrée d'énergie. */
  private feed(msg: DivineActMsg, watcher: Watcher): boolean {
    const x = clamp(Math.round(msg.x ?? -1), 0, SX - 1);
    const z = clamp(Math.round(msg.z ?? -1), 0, SZ - 1);
    if (!pointVisible(x, z, watcher.eyeX, watcher.eyeZ, VIEW_RADIUS)) return false;

    let placed = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const spot = this.surfaceAt(x + dx, z + dz);
        if (spot < 0) continue;
        // `setMaterial` porte le don au registre énergétique : un dieu qui
        // nourrit crée de l'énergie, et le bilan du monde doit le savoir.
        this.world.setMaterial(spot, BIOMASS, NUTRIENT_FRESH);
        placed++;
      }
    }
    return placed > 0;
  }

  /** Première case libre au-dessus du sol, dans une colonne. -1 si aucune. */
  private surfaceAt(x: number, z: number): number {
    if (x < 0 || x >= SX || z < 0 || z >= SZ) return -1;
    for (let y = 1; y < 24; y++) {
      const i = this.world.idx(x, y, z);
      if (this.world.material[i] !== VOID) continue;
      const below = this.world.material[this.world.idx(x, y - 1, z)]!;
      if (below === ROCK || below === BIOMASS) return i;
      return -1;
    }
    return -1;
  }

  /** PROTÉGER : la mort est suspendue quelques centaines de ticks. */
  private protect(msg: DivineActMsg, watcher: Watcher): boolean {
    const id = msg.organismId ?? 0;
    if (id <= 0 || id >= MAX_ORGANISMS) return false;
    if (this.world.orgState[id] !== ALIVE) return false;
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
      return false;
    }
    this.protectedUntil[id] = this.world.tick + PROTECT_TICKS;
    return true;
  }

  /**
   * FOUDROYER. On vise de préférence UNE CRÉATURE, pas un point : viser le
   * centre du regard ne touchait presque jamais rien, puisque le monde est
   * surtout vide. Le point reste accepté, pour frapper un endroit précis.
   */
  private smite(msg: DivineActMsg, watcher: Watcher): boolean {
    let x: number;
    let z: number;
    const id = msg.organismId ?? 0;
    if (id > 0 && id < MAX_ORGANISMS && this.world.orgState[id] === ALIVE) {
      const seed = this.world.seedIdx[id]!;
      x = this.world.xOf(seed);
      z = this.world.zOf(seed);
    } else {
      x = clamp(Math.round(msg.x ?? -1), 0, SX - 1);
      z = clamp(Math.round(msg.z ?? -1), 0, SZ - 1);
    }
    if (!pointVisible(x, z, watcher.eyeX, watcher.eyeZ, VIEW_RADIUS)) return false;

    let struck = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nx >= SX || nz < 0 || nz >= SZ) continue;
        for (let y = 1; y < 12; y++) {
          const i = this.world.idx(nx, y, nz);
          if (this.world.isTissue(i) && damageVoxel(this.world, i)) struck++;
        }
      }
    }
    return struck > 0;
  }

  /**
   * MODE GOD : modifier le monde lui-même. Désactivé par défaut, et activé par
   * variable d'environnement côté SERVEUR — jamais par le client, qui pourrait
   * simplement le demander.
   */
  private onGodMode(client: Client, msg: GodModeMsg): void {
    if (!this.godModeEnabled) {
      client.send("godResult", { ok: false, reason: "mode god désactivé sur ce serveur" });
      return;
    }
    const x = clamp(Math.round(msg?.x ?? 0), 0, SX - 1);
    const z = clamp(Math.round(msg?.z ?? 0), 0, SZ - 1);
    const y = clamp(Math.round(msg?.y ?? 1), 0, 30);
    const i = this.world.idx(x, y, z);

    if (msg.action === "terrain") {
      this.world.setMaterial(i, this.world.material[i] === ROCK ? VOID : ROCK);
    } else if (msg.action === "biomass") {
      this.world.setMaterial(i, BIOMASS, NUTRIENT_FRESH);
    } else if (msg.action === "spawn") {
      const rng = new SeededRng((this.world.tick ^ (x * 31 + z)) | 1);
      const slot = registerGenome(this.world, randomGenome(rng.next(), 8));
      spawnOrganism(this.world, slot, x, Math.max(1, y), z, RELEASE_ENERGY);
    }
    client.send("godResult", { ok: true, action: msg.action });
  }

  private sendRegistry(client: Client): void {
    if (!this.registry) {
      client.send(MSG_REGISTRY, { lineages: [], tombstones: [] } satisfies RegistryMsg);
      return;
    }
    client.send(MSG_REGISTRY, {
      lineages: this.registry.lineages().map((l) => ({
        id: l.id,
        godId: l.godId,
        name: l.name,
        born: l.born,
        died: l.died,
        maxGeneration: l.maxGeneration,
      })),
      tombstones: this.registry.recentTombstones().map((t) => ({
        organismId: t.organismId,
        lineageId: t.lineageId,
        generation: t.generation,
        bornTick: t.bornTick,
        diedTick: t.diedTick,
        bodyVoxels: t.bodyVoxels,
        eaten: t.eaten,
        bites: t.bites,
        bitten: t.bitten,
        crossbred: !!t.crossbred,
        cause: t.cause,
      })),
    } satisfies RegistryMsg);
  }

  /** La protection divine : l'énergie ne descend pas à zéro tant qu'elle dure. */
  private applyProtection(): void {
    const w = this.world;
    for (let a = 0; a < w.aliveCount; a++) {
      const id = w.aliveIds[a]!;
      if (this.protectedUntil[id]! <= w.tick) continue;
      if (w.energy[id]! < 6_000) {
        // Un don, donc une entrée d'énergie : le registre doit la voir.
        w.energyInjected += 6_000 - w.energy[id]!;
        w.energy[id] = 6_000;
      }
    }
  }

  /**
   * ÉVEILLER un organisme. C'est un acte du dieu, pas un état du monde : le
   * corps ne change pas, c'est ce qui l'habite qui change.
   */
  private onAwaken(client: Client, msg: AwakenMsg): void {
    const id = msg?.organismId ?? 0;
    const reply = (ok: boolean, reason?: string) => client.send("awakenResult", { ok, id, reason });
    if (id <= 0 || id >= MAX_ORGANISMS || this.world.orgState[id] !== ALIVE) {
      return reply(false, "cet organisme n'est pas vivant");
    }
    if (this.awakened.has(id)) return reply(false, "il est déjà éveillé");
    if (this.awakened.size >= 4) {
      // Peu d'éveillés : c'est une contrainte de quota et de latence, assumée.
      return reply(false, "trop d'éveillés dans ce monde (4 au plus)");
    }
    if (this.world.neuronCount[id]! === 0) {
      // Cohérent avec la règle du noyau : sans système nerveux, rien à éveiller.
      return reply(false, "un corps sans neurone n'a rien à éveiller");
    }
    this.awakened.set(id, {
      name: (msg.name ?? `#${id}`).slice(0, 24),
      godId: client.sessionId,
      journal: [],
    });
    reply(true);
  }

  /** LE VERBE DIVIN : 140 caractères, une fois par minute. */
  private onDivineWord(client: Client, msg: DivineWordMsg): void {
    const now = Date.now();
    const since = now - (this.lastWordAt.get(client.sessionId) ?? -Infinity);
    if (since < DIVINE_WORD_COOLDOWN_MS) {
      client.send("divineWordResult", {
        ok: false,
        reason: "le ciel se tait encore",
        cooldownMs: DIVINE_WORD_COOLDOWN_MS - since,
      });
      return;
    }
    const id = msg?.organismId ?? 0;
    if (!this.awakened.has(id)) {
      client.send("divineWordResult", { ok: false, reason: "cet organisme n'est pas éveillé" });
      return;
    }
    const text = String(msg?.text ?? "").slice(0, DIVINE_WORD_MAX_CHARS).trim();
    if (!text) {
      client.send("divineWordResult", { ok: false, reason: "parole vide" });
      return;
    }
    this.pendingWord.set(id, text);
    this.lastWordAt.set(client.sessionId, now);
    client.send("divineWordResult", { ok: true, cooldownMs: DIVINE_WORD_COOLDOWN_MS });
  }

  private sendJournal(client: Client, id: number): void {
    const a = this.awakened.get(id);
    client.send(MSG_JOURNAL, {
      organismId: id,
      entries: a?.journal ?? [],
      alive: this.world.orgState[id] === ALIVE,
      mind: this.mindKind,
    } satisfies VoxelJournalMsg);
  }

  /**
   * Faire penser les éveillés. Asynchrone et hors du tick : une pensée prend
   * des secondes, le monde ne l'attend pas. Quand elle revient, son coût est
   * prélevé — sur la même réserve que marcher ou digérer.
   */
  private runThoughts(): void {
    if (this.world.tick % VoxelWorldRoom.THINK_EVERY !== 0) return;
    for (const [id, a] of this.awakened) {
      if (this.world.orgState[id] !== ALIVE) {
        this.awakened.delete(id);
        continue;
      }
      if (this.thinking.has(id)) continue;
      this.thinking.add(id);
      const word = this.pendingWord.get(id);
      this.pendingWord.delete(id);

      void this.mind
        .think({
          organismId: id,
          name: a.name,
          tick: this.world.tick,
          age: this.world.tick - this.world.bornTick[id]!,
          energy: this.world.energy[id]!,
          capacity: this.world.capacity[id]!,
          bodyVoxels: this.world.bodyLen[id]!,
          neurons: this.world.neuronCount[id]!,
          mouths: this.world.mouthCount[id]!,
          eyes: 0,
          muscles: this.world.muscleCount[id]!,
          generation: this.world.generation[id]!,
          eaten: this.world.eaten[id]!,
          bites: this.world.bites[id]!,
          bitten: this.world.bitten[id]!,
          surroundings: this.describeSurroundings(id),
          divineWord: word,
        })
        .then((thought) => this.applyThought(id, thought))
        .catch((err: unknown) => {
          console.warn(`[éveil] #${id} n'a pas pu penser : ${String(err)}`);
        })
        .finally(() => this.thinking.delete(id));
    }
  }

  /** Ce que l'éveillé peut dire de son entourage, en français. */
  private describeSurroundings(id: number): string {
    const w = this.world;
    const seed = w.seedIdx[id]!;
    const x = w.xOf(seed);
    const y = w.yOf(seed);
    const z = w.zOf(seed);
    let food = 0;
    let others = 0;
    const R = 6;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (!w.inBounds(x + dx, y + dy, z + dz)) continue;
          const i = w.idx(x + dx, y + dy, z + dz);
          const m = w.material[i]!;
          if (m === BIOMASS) food++;
          else if (w.isTissue(i) && w.owner[i] !== id) others++;
        }
      }
    }
    const parts = [
      food > 0 ? `${food} voxels de nourriture` : "aucune nourriture",
      others > 0 ? `${others} voxels d'un autre corps` : "personne",
    ];
    return parts.join(", ") + ".";
  }

  /** Le retour d'une pensée : le journal s'écrit, et l'énergie se paie. */
  private applyThought(id: number, thought: AwakenedThought): void {
    const a = this.awakened.get(id);
    if (!a || this.world.orgState[id] !== ALIVE) return;

    const cost = thoughtEnergyCost(thought.usage);
    this.world.energy[id] = Math.max(0, this.world.energy[id]! - cost);

    const entry: ThoughtMsg = {
      organismId: id,
      tick: this.world.tick,
      monologue: thought.monologue,
      intent: thought.intent,
      energyCost: cost,
      inputTokens: thought.usage.inputTokens,
      outputTokens: thought.usage.outputTokens,
    };
    a.journal.push(entry);
    if (a.journal.length > 40) a.journal.shift();

    // L'intention penche la décision du cerveau pour les prochains ticks : elle
    // ne la remplace pas. Un éveillé reste un corps qui décide.
    if (thought.intent === "mordre") this.world.intentAttack[id] = 1;
    if (thought.intent === "se reproduire") this.world.intentRepro[id] = 1;

    for (const client of this.clients) client.send(MSG_THOUGHT, entry);
  }

  private onTick(): void {
    this.applyProtection();
    step(this.world);
    this.runThoughts();
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

  /**
   * Une pierre tombale. La cause est établie par ce que le monde peut savoir :
   * s'il a été mordu plus qu'il n'a mordu, on appelle ça la prédation ; sinon
   * la faim, qui est la mort ordinaire de ce monde.
   */
  private bury(id: number): void {
    const seen = this.lastSeen.get(id);
    this.lastSeen.delete(id);
    if (!seen || !this.registry) return;
    this.registry.bury({
      organismId: id,
      lineageId: seen.lineage,
      godId: seen.lineage,
      generation: seen.generation,
      bornTick: seen.bornTick,
      diedTick: this.world.tick,
      bodyVoxels: seen.body,
      eaten: seen.eaten,
      bites: seen.bites,
      bitten: seen.bitten,
      crossbred: seen.crossbred,
      cause: seen.bitten > 0 ? "prédation" : "famine",
    });
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

      // Ce qu'on saura de lui quand il mourra : après coup, tout est effacé.
      this.lastSeen.set(id, {
        generation: w.generation[id]!,
        bornTick: w.bornTick[id]!,
        body: len,
        eaten: w.eaten[id]!,
        bites: w.bites[id]!,
        bitten: w.bitten[id]!,
        crossbred: w.crossbred[id] === 1,
        lineage,
      });
    }

    for (const key of [...this.state.organisms.keys()]) {
      if (living.has(key)) continue;
      this.state.organisms.delete(key);
      const id = Number(key);
      this.bury(id);
      this.lineageOf.delete(id);
      this.lastBodyLen[id] = 0;
      this.protectedUntil[id] = 0;
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
