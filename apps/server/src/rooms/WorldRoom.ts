import { Client, Room } from "@colyseus/core";
import { CognitionOrchestrator, createMind, type Chronicler } from "@devot/agents";
import { createRepos, openDb, type Repos } from "@devot/db";
import { FreeStubProvider, type PaymentProvider } from "@devot/onchain";
import {
  DevotState,
  DIVINE_MSG_COOLDOWN_MS,
  DIVINE_MSG_MAX_CHARS,
  FoodState,
  GodState,
  HP_MAX_DEFAULT,
  PATCH_RATE_MS,
  PERCEPTION_RADIUS,
  TICK_MS,
  SOUL_MAX_CHARS,
  statMultiplier,
  TRAIT_POOL,
  defaultIdentity,
  encodeIdentity,
  signatureOf,
  validateAppearance,
  validateStats,
  type Appearance,
  type Identity,
  type Stats,
  WorldState,
  type ActionRejectedMsg,
  type CombatFxMsg,
  type CreateFounderMsg,
  type DebugMoveFoodMsg,
  type DebugSpawnDevotMsg,
  type DevotEntity,
  type FeedMsg,
  type FoodEntity,
  type JournalEntry,
  type JournalMsg,
  type JournalRequestMsg,
  type SmiteMsg,
  type SpeakMsg,
} from "@devot/shared";
import { applyDecision, dist2, perceptionSystem, tick, World } from "@devot/sim";
import { canRecreateFounder, processReproductions } from "../lifecycle.js";

const GOD_COLORS = ["#e0b34c", "#4ca6e0", "#9c4ce0", "#4ce07a", "#e04c5f"];

/** PV maximaux pour une vigueur donnée. Même formule partout (cf. sim/stats). */
function hpMaxFor(vitality: number): number {
  return Math.round(HP_MAX_DEFAULT * statMultiplier(vitality));
}
const FOOD_TARGET = 8;
const FOOD_SPAWN_EVERY_TICKS = 16; // ~4 s

interface WorldRoomOptions {
  godName?: string;
}

export class WorldRoom extends Room<WorldState> {
  private world = new World(30);
  private repos!: Repos;
  private payments: PaymentProvider = new FreeStubProvider();
  private orchestrator!: CognitionOrchestrator;
  private chronicler!: Chronicler;
  private reproInFlight = false;
  private tickCount = 0;
  private foodSeq = 0;
  private devotSeq = 0;
  /** sessionId → godId (un dieu peut se reconnecter). */
  private sessions = new Map<string, string>();

  onCreate(): void {
    this.setState(new WorldState());
    this.setPatchRate(PATCH_RATE_MS);

    const dbPath = process.env.DEVOT_DB ?? new URL("../../world.sqlite", import.meta.url).pathname;
    this.repos = createRepos(openDb(dbPath));

    const { kind, mind, chronicler } = createMind();
    this.chronicler = chronicler;
    console.log(
      `[world] esprit : ${
        kind === "claude"
          ? "abonnement Claude Code (Agent SDK)"
          : kind === "api"
            ? "Claude Messages API (key)"
            : "MockMind (simulated)"
      }`,
    );

    this.orchestrator = new CognitionOrchestrator(
      mind,
      this.repos,
      (id) => this.world.devots.get(id),
      ({ devotId, decision }) => {
        const devot = this.world.devots.get(devotId);
        if (!devot) return;
        applyDecision(devot, decision, this.world);
        const s = this.state.devots.get(devotId);
        if (s) {
          if (decision.emotion) s.emotion = decision.emotion;
          if (decision.thought) s.thought = decision.thought;
        }
        if (decision.action === "speak" && decision.utterance) {
          this.onDevotSpoke(devot, decision.utterance);
        }
      },
      undefined,
      this.chronicler,
    );

    this.onMessage("createFounder", (client, msg: CreateFounderMsg) =>
      void this.handleCreateFounder(client, msg ?? {}),
    );
    this.onMessage("speak", (client, msg: SpeakMsg) => this.handleSpeak(client, msg));
    this.onMessage("feed", (client, msg: FeedMsg) => void this.handleFeed(client, msg ?? {}));
    this.onMessage("smite", (client, msg: SmiteMsg) => this.handleSmite(client, msg));
    this.onMessage("getJournal", (client, msg: JournalRequestMsg) =>
      this.handleGetJournal(client, msg),
    );
    this.onMessage("select", () => {
      /* lecture seule : la sélection vit côté client */
    });

    // Mode god (debug/créatif) : hors règles du jeu, mais toujours validé ici.
    this.onMessage("debugSpawnDevot", (client, msg: DebugSpawnDevotMsg) =>
      this.handleDebugSpawnDevot(client, msg),
    );
    this.onMessage("debugMoveFood", (_client, msg: DebugMoveFoodMsg) =>
      this.handleDebugMoveFood(msg),
    );

    this.setSimulationInterval(() => this.simulate(), TICK_MS);
  }

  onJoin(client: Client, options: WorldRoomOptions): void {
    const godName = (options.godName ?? `Dieu-${client.sessionId.slice(0, 4)}`).slice(0, 24);
    const godId = `god-${godName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
    this.sessions.set(client.sessionId, godId);

    let god = this.state.gods.get(godId);
    if (!god) {
      god = new GodState();
      god.id = godId;
      god.name = godName;
      god.color = GOD_COLORS[this.state.gods.size % GOD_COLORS.length]!;
      this.state.gods.set(godId, god);
      this.repos.events.record("god_joined", [godId], { name: godName });
    }
    god.connected = true;
    client.send("welcome", { godId });
  }

  onLeave(client: Client): void {
    const godId = this.sessions.get(client.sessionId);
    this.sessions.delete(client.sessionId);
    if (godId && ![...this.sessions.values()].includes(godId)) {
      const god = this.state.gods.get(godId);
      if (god) god.connected = false;
    }
  }

  // ── Intentions du dieu (validées ici, jamais côté client) ────────────────

  private godOf(client: Client): string | undefined {
    return this.sessions.get(client.sessionId);
  }

  private reject(client: Client, action: ActionRejectedMsg["action"], reason: string): void {
    client.send("rejected", { action, reason } satisfies ActionRejectedMsg);
  }

  private async handleCreateFounder(client: Client, msg: CreateFounderMsg): Promise<void> {
    const godId = this.godOf(client);
    if (!godId) return;

    if (!canRecreateFounder(this.world, godId)) {
      return this.reject(client, "createFounder", "Your line is still alive.");
    }

    // Traits choisis par le joueur : 2 à 3, tous issus de la banque.
    const traits = msg.traits ?? [];
    const pool = TRAIT_POOL as readonly string[];
    if (traits.length < 2 || traits.length > 3) {
      return this.reject(client, "createFounder", "Choose 2 or 3 traits.");
    }
    if (traits.some((t) => !pool.includes(t)) || new Set(traits).size !== traits.length) {
      return this.reject(client, "createFounder", "Invalid traits.");
    }

    // APPARENCE ET STATS. Rien de ce qui arrive ici n'est cru sur parole : le
    // budget de points est vérifié par le serveur, sinon un client modifié
    // s'octroierait le maximum sur les quatre stats.
    const badLook = validateAppearance(msg.appearance);
    if (badLook) return this.reject(client, "createFounder", badLook.reason);
    const badStats = validateStats(msg.stats);
    if (badStats) return this.reject(client, "createFounder", badStats.reason);

    const appearance = msg.appearance as Appearance;
    const stats = msg.stats as Stats;
    const soul = String(msg.soul ?? "").slice(0, SOUL_MAX_CHARS).trim();
    const identity: Identity = {
      appearance,
      stats,
      soul,
      signature: signatureOf(appearance, stats, traits, soul),
    };

    const receipt = await this.payments.chargeDevotCreation(godId);
    if (!receipt.ok) {
      return this.reject(client, "createFounder", "Payment refused.");
    }

    const devot = this.spawnDevot(godId, {
      name: msg.name,
      traits: ["first of their line", ...traits],
      isFounder: true,
      identity,
    });
    this.repos.events.record("birth", [devot.id], { founder: true, godId });

    this.orchestrator.enqueue({
      kind: "idle_reflection",
      devotId: devot.id,
      eventText:
        "You have just been born. You open your eyes on the world for the first time. You already know that thinking costs you your life.",
      createdAt: Date.now(),
    });
  }

  private spawnDevot(
    godId: string,
    opts: {
      name?: string;
      traits: string[];
      isFounder: boolean;
      x?: number;
      z?: number;
      /** Absente pour une naissance par reproduction ou en mode god. */
      identity?: Identity;
    },
  ): DevotEntity {
    // Un devot né sans écran de création (reproduction, mode god) reçoit une
    // identité neutre : le monde n'a jamais de devot sans apparence.
    const identity = opts.identity ?? defaultIdentity(opts.traits);
    const devot: DevotEntity = {
      id: `devot-${godId}-${Date.now()}-${++this.devotSeq}`,
      godId,
      isFounder: opts.isFounder,
      name: (opts.name ?? `Devot-${this.devotSeq}`).slice(0, 24),
      pos: {
        x: opts.x ?? (Math.random() - 0.5) * this.world.size,
        y: 0,
        z: opts.z ?? (Math.random() - 0.5) * this.world.size,
      },
      // Les PV maximaux découlent de la VIGUEUR choisie : c'est la stat qui
      // pèse le plus, puisque les PV sont aussi le budget de pensée. Un devot
      // vigoureux ne vit pas seulement plus longtemps, il pense plus longtemps.
      hp: hpMaxFor(identity.stats.vitality),
      hpMax: hpMaxFor(identity.stats.vitality),
      identityJson: encodeIdentity(identity),
      // Un devot naît les mains nues : tout objet devra être forgé, et payé.
      items: [],
      state: "alive",
      profile: "frugal",
      traits: opts.traits,
      age: 0,
      thinking: false,
      utterance: "",
      currentGoal: { kind: "wander" },
    };
    this.world.devots.set(devot.id, devot);
    this.repos.devots.insertFromEntity(devot);
    return devot;
  }

  /** Foudre divine : le dieu peut tuer son propre devot. Irréversible. */
  private handleSmite(client: Client, msg: SmiteMsg): void {
    const godId = this.godOf(client);
    if (!godId || !msg) return;
    const devot = this.world.devots.get(msg.devotId ?? "");
    if (!devot) return this.reject(client, "smite", "Devot introuvable.");
    if (devot.godId !== godId) {
      return this.reject(client, "smite", "Ce devot ne t'appartient pas.");
    }
    if (devot.state === "dead") {
      return this.reject(client, "smite", "They are already dead.");
    }

    devot.hp = 0;
    devot.state = "dead";
    this.repos.devots.kill(devot.id, "foudre divine");
    this.repos.events.record("smite", [devot.id], { godId });
    console.log(`[world] ⚡ ${devot.name} smitten by their god — context destroyed.`);
    this.broadcast("smite", { devotId: devot.id, x: devot.pos.x, z: devot.pos.z });
    const s = this.state.devots.get(devot.id);
    if (s) s.utterance = "";
  }

  /** Journal du panneau « Esprit » : la vie du devot, datée, côté serveur. */
  private handleGetJournal(client: Client, msg: JournalRequestMsg): void {
    if (!msg?.devotId) return;
    const rows = this.repos.messages.journal(msg.devotId);
    const entries: JournalEntry[] = rows.map((m) => {
      if (m.role === "user") {
        return { kind: "event", text: String(m.content), at: m.createdAt };
      }
      // Tour assistant : contenu = décision JSON (ou blocs de texte).
      let decision: Record<string, unknown> = {};
      try {
        const raw = m.content as unknown;
        const text = Array.isArray(raw)
          ? ((raw[0] as { text?: string })?.text ?? "")
          : String(raw);
        decision = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* contenu non structuré : ignoré */
      }
      return {
        kind: "decision",
        text: typeof decision.utterance === "string" ? decision.utterance : "",
        action: typeof decision.action === "string" ? decision.action : undefined,
        emotion: typeof decision.emotion === "string" ? decision.emotion : undefined,
        thought: typeof decision.thought === "string" ? decision.thought : undefined,
        at: m.createdAt,
      };
    });
    client.send("journal", { devotId: msg.devotId, entries } satisfies JournalMsg);
  }

  private handleDebugSpawnDevot(client: Client, msg: DebugSpawnDevotMsg): void {
    const godId = this.godOf(client);
    if (!godId || typeof msg?.x !== "number" || typeof msg?.z !== "number") return;
    const pool = TRAIT_POOL as readonly string[];
    const traits = [...pool].sort(() => Math.random() - 0.5).slice(0, 2);
    const devot = this.spawnDevot(godId, {
      traits,
      isFounder: false,
      x: msg.x,
      z: msg.z,
    });
    this.repos.events.record("debug_spawn", [devot.id], { godId });
  }

  private handleDebugMoveFood(msg: DebugMoveFoodMsg): void {
    if (!msg?.foodId || typeof msg.x !== "number" || typeof msg.z !== "number") return;
    const food = this.world.food.get(msg.foodId);
    if (!food) return;
    food.pos.x = Math.max(-this.world.size, Math.min(this.world.size, msg.x));
    food.pos.z = Math.max(-this.world.size, Math.min(this.world.size, msg.z));
    const s = this.state.food.get(msg.foodId);
    if (s) {
      s.x = food.pos.x;
      s.z = food.pos.z;
    }
  }

  private handleSpeak(client: Client, msg: SpeakMsg): void {
    const godId = this.godOf(client);
    if (!godId || !msg) return;
    const god = this.state.gods.get(godId);
    const devot = this.world.devots.get(msg.devotId ?? "");

    if (!god || !devot) return this.reject(client, "speak", "Devot introuvable.");
    if (devot.godId !== godId) {
      return this.reject(client, "speak", "Ce devot ne t'appartient pas.");
    }
    if (devot.state === "dead") {
      return this.reject(client, "speak", "Les morts n'entendent plus.");
    }
    if (typeof msg.text !== "string" || msg.text.length === 0) {
      return this.reject(client, "speak", "Message vide.");
    }
    if (msg.text.length > DIVINE_MSG_MAX_CHARS) {
      return this.reject(client, "speak", `${DIVINE_MSG_MAX_CHARS} characters maximum.`);
    }
    const now = Date.now();
    if (now - god.lastSpeakAt < DIVINE_MSG_COOLDOWN_MS) {
      const wait = Math.ceil((DIVINE_MSG_COOLDOWN_MS - (now - god.lastSpeakAt)) / 1000);
      return this.reject(client, "speak", `Your voice must rest for another ${wait} s.`);
    }

    god.lastSpeakAt = now;
    this.repos.divineMsgs.record(godId, devot.id, msg.text);

    // Contenu non fiable : encadré, injecté dans le tour utilisateur uniquement.
    this.orchestrator.enqueue({
      kind: "divine_message",
      devotId: devot.id,
      eventText: `A voice from the sky tells you: "${msg.text}"`,
      createdAt: now,
    });
  }

  private async handleFeed(client: Client, msg: FeedMsg): Promise<void> {
    const godId = this.godOf(client);
    if (!godId) return;

    const receipt = await this.payments.chargeFeed(godId);
    if (!receipt.ok) return this.reject(client, "feed", "Payment refused.");

    let x = msg.x;
    let z = msg.z;
    if (msg.devotId) {
      const devot = this.world.devots.get(msg.devotId);
      if (devot) {
        x = devot.pos.x + (Math.random() - 0.5) * 4;
        z = devot.pos.z + (Math.random() - 0.5) * 4;
      }
    }
    if (typeof x !== "number" || typeof z !== "number") {
      return this.reject(client, "feed", "Cible invalide.");
    }
    this.spawnFood("god", { x, z }, "fruit", 4000);
  }

  // ── Simulation ───────────────────────────────────────────────────────────

  private simulate(): void {
    this.tickCount++;
    const result = tick(this.world);

    for (const { devotId, foodId, hpValue } of result.eaten) {
      this.repos.events.record("meal", [devotId], { foodId, hpValue });
    }

    for (const t of [...result.triggers, ...perceptionSystem(this.world)]) {
      this.orchestrator.enqueue(t);
    }

    for (const { attackerId, victimId, drained } of result.combats) {
      if (this.tickCount % 8 === 0) {
        this.repos.events.record("combat", [attackerId, victimId], { drained });
      }
      // Le combat se voit : on diffuse le transfert pour que le client trace le
      // trait, fasse monter les chiffres et fasse clignoter la victime. Sans
      // cela, le vol de vie — qui est le cœur du jeu — reste invisible.
      const victim = this.world.devots.get(victimId);
      this.broadcast("combat", {
        attackerId,
        victimId,
        drained: Math.round(drained),
        x: victim?.pos.x ?? 0,
        z: victim?.pos.z ?? 0,
        lethal: !!victim && victim.hp <= 0,
      } satisfies CombatFxMsg);
    }

    // Naissances : consomme les intentions posées par les esprits.
    if (!this.reproInFlight) {
      this.reproInFlight = true;
      void processReproductions(this.world, this.repos, this.chronicler, (birth) => {
        console.log(
          `[world] ✚ naissance de ${birth.child.name} (${birth.mode}, dieu ${birth.child.godId})`,
        );
        this.orchestrator.enqueue({
          kind: "idle_reflection",
          devotId: birth.child.id,
          eventText:
            birth.parents.length > 1
              ? "You have just been born of the union of two devots. You carry memories of a life you never lived."
              : "You have just been born, budded from a single parent. Their memories flow through you.",
          createdAt: Date.now(),
        });
      }).finally(() => {
        this.reproInFlight = false;
      });
    }

    for (const { devotId, cause } of result.deaths) {
      this.repos.devots.kill(devotId, cause);
      const s = this.state.devots.get(devotId);
      const name = this.world.devots.get(devotId)?.name ?? devotId;
      console.log(`[world] ☠ ${name} died (${cause}) — context destroyed.`);
      if (s) s.utterance = "";
    }

    if (this.tickCount % FOOD_SPAWN_EVERY_TICKS === 0 && this.world.food.size < FOOD_TARGET) {
      this.spawnFood("spawn");
    }

    if (this.tickCount % 20 === 0) {
      for (const d of this.world.devots.values()) this.repos.devots.snapshot(d);
    }

    this.syncState();
  }

  private onDevotSpoke(speaker: DevotEntity, utterance: string): void {
    speaker.utterance = utterance;
    const now = Date.now();
    for (const other of this.world.aliveDevots()) {
      if (other.id === speaker.id) continue;
      if (dist2(other.pos, speaker.pos) <= PERCEPTION_RADIUS * PERCEPTION_RADIUS) {
        this.orchestrator.enqueue({
          kind: "utterance_heard",
          devotId: other.id,
          eventText: `${speaker.name}, un devot proche de toi, dit : « ${utterance} »`,
          createdAt: now,
        });
      }
    }
  }

  private spawnFood(
    source: "spawn" | "god",
    at?: { x: number; z: number },
    kind: FoodEntity["type"] = "grain",
    hpValue?: number,
  ): void {
    const rare = Math.random() < 0.06;
    const f: FoodEntity = {
      id: `food-${++this.foodSeq}`,
      pos: {
        x: at?.x ?? (Math.random() - 0.5) * 2 * this.world.size * 0.9,
        y: 0,
        z: at?.z ?? (Math.random() - 0.5) * 2 * this.world.size * 0.9,
      },
      type: at ? kind : rare ? "manna" : Math.random() < 0.3 ? "fruit" : "grain",
      hpValue: hpValue ?? 0,
      source,
    };
    if (f.hpValue === 0) {
      f.hpValue = f.type === "manna" ? HP_MAX_DEFAULT : f.type === "fruit" ? 6000 : 2000;
    }
    this.world.food.set(f.id, f);
  }

  /** Recopie l'état chaud (sim) vers l'état synchronisé (schema). */
  private syncState(): void {
    for (const d of this.world.devots.values()) {
      let s = this.state.devots.get(d.id);
      if (!s) {
        s = new DevotState();
        s.id = d.id;
        s.godId = d.godId;
        s.name = d.name;
        s.isFounder = d.isFounder;
        s.profile = d.profile;
        s.hpMax = d.hpMax;
        // L'identité est écrite UNE FOIS, à l'entrée dans l'état : elle ne
        // change jamais, il serait absurde de la resynchroniser à chaque tick.
        s.identity = d.identityJson;
        this.state.devots.set(d.id, s);
      }
      s.x = d.pos.x;
      s.y = d.pos.y;
      s.z = d.pos.z;
      s.hp = Math.max(0, d.hp);
      s.state = d.state;
      s.thinking = d.thinking;
      s.utterance = d.utterance;
      s.age = d.age;
      // Les objets changent en cours de vie (une forge) : contrairement à
      // l'identité, il faut les resynchroniser.
      s.items = d.items.join(",");
    }
    for (const [id, f] of this.world.food) {
      let s = this.state.food.get(id);
      if (!s) {
        s = new FoodState();
        s.id = id;
        s.kind = f.type;
        s.hpValue = f.hpValue;
        s.source = f.source;
        s.x = f.pos.x;
        s.z = f.pos.z;
        this.state.food.set(id, s);
      }
    }
    for (const id of this.state.food.keys()) {
      if (!this.world.food.has(id)) this.state.food.delete(id);
    }
  }
}
