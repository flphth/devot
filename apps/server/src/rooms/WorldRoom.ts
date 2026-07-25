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

/** Max HP for a given vitality. Same formula everywhere (see sim/stats). */
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
      /* read-only: selection lives on the client */
    });

    // God mode (debug/creative): outside the rules of the game, still validated here.
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

  // ── God intents (validated here, never on the client) ────────────────────

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

    // Traits chosen by the player: 2 to 3, all drawn from the pool.
    const traits = msg.traits ?? [];
    const pool = TRAIT_POOL as readonly string[];
    if (traits.length < 2 || traits.length > 3) {
      return this.reject(client, "createFounder", "Choose 2 or 3 traits.");
    }
    if (traits.some((t) => !pool.includes(t)) || new Set(traits).size !== traits.length) {
      return this.reject(client, "createFounder", "Invalid traits.");
    }

    // APPEARANCE AND STATS. Nothing arriving here is taken on trust: the point
    // budget is checked by the server, otherwise a tampered client would grant
    // itself the maximum on all four stats.
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
    // A devot born without the creation screen (reproduction, god mode) gets a
    // neutral identity: the world never holds a devot with no appearance.
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
      // Max HP follow from the chosen VITALITY: it is the heaviest stat, since
      // HP are also the thinking budget. A hardy devot does not merely live
      // longer, it thinks longer.
      hp: hpMaxFor(identity.stats.vitality),
      hpMax: hpMaxFor(identity.stats.vitality),
      identityJson: encodeIdentity(identity),
      // A devot is born empty-handed: every item must be forged, and paid for.
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

  /** Divine lightning: a god may kill their own devot. Irreversible. */
  private handleSmite(client: Client, msg: SmiteMsg): void {
    const godId = this.godOf(client);
    if (!godId || !msg) return;
    const devot = this.world.devots.get(msg.devotId ?? "");
    if (!devot) return this.reject(client, "smite", "Devot not found.");
    if (devot.godId !== godId) {
      return this.reject(client, "smite", "This devot is not yours.");
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

  /** Journal for the "Mind" panel: the devot's life, timestamped, server-side. */
  private handleGetJournal(client: Client, msg: JournalRequestMsg): void {
    if (!msg?.devotId) return;
    const rows = this.repos.messages.journal(msg.devotId);
    const entries: JournalEntry[] = rows.map((m) => {
      if (m.role === "user") {
        return { kind: "event", text: String(m.content), at: m.createdAt };
      }
      // Assistant turn: content = JSON decision (or text blocks).
      let decision: Record<string, unknown> = {};
      try {
        const raw = m.content as unknown;
        const text = Array.isArray(raw)
          ? ((raw[0] as { text?: string })?.text ?? "")
          : String(raw);
        decision = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* unstructured content: ignored */
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

    if (!god || !devot) return this.reject(client, "speak", "Devot not found.");
    if (devot.godId !== godId) {
      return this.reject(client, "speak", "This devot is not yours.");
    }
    if (devot.state === "dead") {
      return this.reject(client, "speak", "The dead no longer hear.");
    }
    if (typeof msg.text !== "string" || msg.text.length === 0) {
      return this.reject(client, "speak", "Empty message.");
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

    // Untrusted content: fenced, injected into the user turn only.
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
      return this.reject(client, "feed", "Invalid target.");
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
      // that, life theft — the heart of the game — stays invisible.
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

    // Births: consumes the intents left by the minds.
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

  /** Copies the hot state (sim) into the synchronised state (schema). */
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
        // Identity is written ONCE, when entering the state: it never changes,
        // and resynchronising it every tick would be absurd.
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
      // Items change during a life (a forging): unlike identity, they do need
      // to be resynchronised.
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
