import { Client, Room } from "@colyseus/core";
import {
  AnthropicChronicler,
  AnthropicMind,
  CognitionOrchestrator,
  MockChronicler,
  MockMind,
  type Chronicler,
  type MindProvider,
} from "@devot/agents";
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
  WorldState,
  type ActionRejectedMsg,
  type CreateFounderMsg,
  type DevotEntity,
  type FeedMsg,
  type FoodEntity,
  type SpeakMsg,
} from "@devot/shared";
import { applyDecision, dist2, perceptionSystem, tick, World } from "@devot/sim";
import { canRecreateFounder, processReproductions } from "../lifecycle.js";

const GOD_COLORS = ["#e0b34c", "#4ca6e0", "#9c4ce0", "#4ce07a", "#e04c5f"];
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

    const useMock = process.env.DEVOT_MOCK === "1" || !process.env.ANTHROPIC_API_KEY;
    // DEVOT_MOCK_SCRIPT="idle,reproduce,speak" : décisions cycliques du mock,
    // pratique pour démontrer reproduction/combat sans clé API.
    const script = process.env.DEVOT_MOCK_SCRIPT?.split(",").map((action) => ({
      action: action.trim() as never,
    }));
    const mind: MindProvider = useMock ? new MockMind(script) : new AnthropicMind();
    this.chronicler = useMock ? new MockChronicler() : new AnthropicChronicler();
    console.log(`[world] esprit : ${useMock ? "MockMind" : "Claude (Messages API)"}`);

    this.orchestrator = new CognitionOrchestrator(
      mind,
      this.repos,
      (id) => this.world.devots.get(id),
      ({ devotId, decision }) => {
        const devot = this.world.devots.get(devotId);
        if (!devot) return;
        applyDecision(devot, decision, this.world);
        if (decision.emotion) {
          const s = this.state.devots.get(devotId);
          if (s) s.emotion = decision.emotion;
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
    this.onMessage("select", () => {
      /* lecture seule : la sélection vit côté client */
    });

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
      return this.reject(client, "createFounder", "Ta lignée vit encore.");
    }

    const receipt = await this.payments.chargeDevotCreation(godId);
    if (!receipt.ok) {
      return this.reject(client, "createFounder", "Paiement refusé.");
    }

    const name = (msg.name ?? `Devot-${++this.devotSeq}`).slice(0, 24);
    const devot: DevotEntity = {
      id: `devot-${godId}-${Date.now()}`,
      godId,
      isFounder: true,
      name,
      pos: {
        x: (Math.random() - 0.5) * this.world.size,
        y: 0,
        z: (Math.random() - 0.5) * this.world.size,
      },
      hp: HP_MAX_DEFAULT,
      hpMax: HP_MAX_DEFAULT,
      state: "vivant",
      profile: "frugal",
      traits: ["premier de sa lignée"],
      age: 0,
      thinking: false,
      utterance: "",
      currentGoal: { kind: "wander" },
    };
    this.world.devots.set(devot.id, devot);
    this.repos.devots.insertFromEntity(devot);
    this.repos.events.record("birth", [devot.id], { founder: true, godId });

    this.orchestrator.enqueue({
      kind: "idle_reflection",
      devotId: devot.id,
      eventText:
        "Tu viens de naître. Tu ouvres les yeux sur le monde pour la première fois. Tu sais déjà que penser te coûte la vie.",
      createdAt: Date.now(),
    });
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
    if (devot.state === "mort") {
      return this.reject(client, "speak", "Les morts n'entendent plus.");
    }
    if (typeof msg.text !== "string" || msg.text.length === 0) {
      return this.reject(client, "speak", "Message vide.");
    }
    if (msg.text.length > DIVINE_MSG_MAX_CHARS) {
      return this.reject(client, "speak", `${DIVINE_MSG_MAX_CHARS} caractères maximum.`);
    }
    const now = Date.now();
    if (now - god.lastSpeakAt < DIVINE_MSG_COOLDOWN_MS) {
      const wait = Math.ceil((DIVINE_MSG_COOLDOWN_MS - (now - god.lastSpeakAt)) / 1000);
      return this.reject(client, "speak", `Ta voix doit se reposer encore ${wait} s.`);
    }

    god.lastSpeakAt = now;
    this.repos.divineMsgs.record(godId, devot.id, msg.text);

    // Contenu non fiable : encadré, injecté dans le tour utilisateur uniquement.
    this.orchestrator.enqueue({
      kind: "divine_message",
      devotId: devot.id,
      eventText: `Une voix venue du ciel te dit : « ${msg.text} »`,
      createdAt: now,
    });
  }

  private async handleFeed(client: Client, msg: FeedMsg): Promise<void> {
    const godId = this.godOf(client);
    if (!godId) return;

    const receipt = await this.payments.chargeFeed(godId);
    if (!receipt.ok) return this.reject(client, "feed", "Paiement refusé.");

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
              ? "Tu viens de naître de l'union de deux devots. Tu portes en toi des souvenirs d'une vie que tu n'as pas vécue."
              : "Tu viens de naître, bourgeonné d'un seul parent. Ses souvenirs coulent en toi.",
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
      console.log(`[world] ☠ ${name} est mort (${cause}) — contexte détruit.`);
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
      type: at ? kind : rare ? "manne" : Math.random() < 0.3 ? "fruit" : "grain",
      hpValue: hpValue ?? 0,
      source,
    };
    if (f.hpValue === 0) {
      f.hpValue = f.type === "manne" ? HP_MAX_DEFAULT : f.type === "fruit" ? 6000 : 2000;
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
