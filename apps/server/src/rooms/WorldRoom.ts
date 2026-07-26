import { Client, Room } from "@colyseus/core";
import {
  CognitionOrchestrator,
  EphemeralMemory,
  PROFILES,
  createMind,
  type Chronicler,
  type Thinker,
} from "@devot/agents";
import { createRepos, openDb, type Repos } from "@devot/db";
import {
  LifeVaultClient,
  vaultConfigFromEnv,
  type VerifiedMint,
  FreeStubProvider,
  LifeLedger,
  LocalSettler,
  WalletForge,
  type PaymentProvider,
} from "@devot/onchain";
import {
  DevotState,
  DIVINE_MSG_COOLDOWN_MS,
  DIVINE_MSG_MAX_CHARS,
  FoodState,
  MonsterState,
  GodState,
  CAPACITY_DEFAULT,
  PATCH_RATE_MS,
  PERCEPTION_RADIUS,
  TICK_MS,
  DEVOT_THINK_INTERVAL_MS,
  MONSTER_THINK_INTERVAL_MS,
  MONSTER_SPAWN_CHANCE_PER_TICK,
  SOUL_MAX_CHARS,
  statMultiplier,
  DEFAULT_DEVOT_PROFILE,
  DEVOT_DEPOSIT,
  LEGACY_TTL_MS,
  FOOD_SPAWN_CHANCE_PER_TICK,
  FOOD_TARGET,
  describeSky,
  foodSpawnMultiplier,
  FOOD_TTL_JITTER,
  FOOD_TTL_MS,
  TRAIT_POOL,
  defaultIdentity,
  devotSubject,
  monsterSubject,
  resolveRockCollisions,
  terrainHeight,
  type Vec3,
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
  type DebugSpawnMonsterMsg,
  type DevotEntity,
  type MonsterEntity,
  type FeedMsg,
  type FoodEntity,
  type FoodType,
  type JournalEntry,
  type JournalMsg,
  type CreatingMsg,
  type JournalRequestMsg,
  type LineageEndedMsg,
  type SmiteMsg,
  type SpeakMsg,
  type Trigger,
} from "@devot/shared";
import {
  applyDecision,
  applyMonsterDecision,
  describeMonsterSurroundings,
  describeSurroundings,
  dist2,
  findMonsterSpawn,
  legacyOf,
  monsterCeiling,
  monsterSystem,
  perceptionSystem,
  spawnMonster,
  tick,
  World,
} from "@devot/sim";
import { canRecreateFounder, processReproductions } from "../lifecycle.js";

const GOD_COLORS = ["#e0b34c", "#4ca6e0", "#9c4ce0", "#4ce07a", "#e04c5f"];

/**
 * What the deposit is worth as life, for a given vitality.
 *
 * The deposit is the same for everyone; vitality decides how much living it
 * buys. That keeps the stat meaningful without letting a god buy a bigger
 * devot simply by paying more.
 */
function capacityFor(vitality: number): number {
  return Math.round(DEVOT_DEPOSIT * statMultiplier(vitality));
}

interface WorldRoomOptions {
  godName?: string;
}

/** How long a given kind of food lasts, spread so nothing vanishes in waves. */
function rotsIn(type: FoodType): number {
  const base = FOOD_TTL_MS[type] ?? 45_000;
  return base * (1 + (Math.random() - 0.5) * 2 * FOOD_TTL_JITTER);
}

/**
 * Puts something down where the ground actually is, and never inside a
 * boulder. Height is never stored on the wire: both sides recompute it.
 */
function placeOnGround(x: number, z: number): Vec3 {
  const pos: Vec3 = { x, y: 0, z };
  resolveRockCollisions(pos);
  pos.y = terrainHeight(pos.x, pos.z);
  return pos;
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
  /** sessionId → godId (a god may reconnect). */
  private sessions = new Map<string, string>();
  /**
   * Monster histories live here, not in SQLite: a monster leaves no gravestone,
   * and the messages table only accepts rows belonging to a devot.
   */
  private monsterMemory = new EphemeralMemory();
  /**
   * When each line began, in world time. The score is how long it has endured
   * since, so this is the only thing that has to be remembered — everything
   * else is counted off the world itself.
   */
  private lineageStart = new Map<string, number>();
  /** Gods whose line was standing last tick, to catch the moment it stops. */
  private livingLines = new Set<string>();
  /**
   * Where this world's wallets come from. A seed in the env makes them stable
   * across restarts; without one they are real addresses that live and die with
   * the process, which is the right default for a world nobody has funded.
   */
  private wallets = new WalletForge(process.env.DEVOT_WALLET_SEED);
  private walletSeq = 0;
  /**
   * Life moves several times a second. Settling each movement would put a
   * network round-trip inside the tick, so they are netted per devot and go out
   * in batches — the simulation never waits for any of it.
   */
  /**
   * The chain, when it is configured. A birth is a real transaction against
   * LifeVault; without it the world still runs, but it says so out loud rather
   * than quietly handing out devots for nothing.
   */
  private vault?: LifeVaultClient;
  /** What a birth costs on chain, read once from the same config as the vault. */
  private vaultDepositWei = 0n;
  private ledger = new LifeLedger(
    new LocalSettler((batch) =>
      this.repos.events.record(
        "life_settled",
        batch.movements.map((m) => m.devotId),
        { net: batch.net, count: batch.movements.length },
      ),
    ),
  );

  /**
   * Hands the orchestrator whatever thinks under this id, devot or monster.
   * Monsters run on the frugal tier: their choices are few, and they draw from
   * the same budget the devots do.
   */
  private thinkerOf(id: string): Thinker | undefined {
    const devot = this.world.devots.get(id);
    if (devot) {
      return {
        entity: devot,
        subject: devotSubject(devot),
        profile: PROFILES[devot.profile],
        memory: this.repos.messages,
      };
    }
    const monster = this.world.monsters.get(id);
    if (monster) {
      return {
        entity: monster,
        subject: monsterSubject(monster),
        profile: PROFILES.frugal,
        memory: this.monsterMemory,
      };
    }
    return undefined;
  }

  onCreate(): void {
    this.setState(new WorldState());
    this.setPatchRate(PATCH_RATE_MS);

    const dbPath = process.env.DEVOT_DB ?? new URL("../../world.sqlite", import.meta.url).pathname;
    this.repos = createRepos(openDb(dbPath));

    const vaultConfig = vaultConfigFromEnv();
    if (vaultConfig) {
      this.vault = new LifeVaultClient(vaultConfig);
      this.vaultDepositWei = vaultConfig.depositWei;
      void this.vault.funds().then((f) =>
        console.log(
          `[world] ⛓ births are paid on-chain from ${this.vault!.address} (${f} OG left)`,
        ),
      );
    } else {
      console.warn(
        "[world] ⛓ NO CHAIN CONFIGURED — devots are born for nothing. " +
          "Set LIFEVAULT_ADDRESS, ZG_PRIVATE_KEY and ZG_RPC_URL to make a birth cost something.",
      );
    }

    const { kind, mind, chronicler } = createMind();
    this.chronicler = chronicler;
    console.log(
      `[world] mind: ${
        kind === "claude"
          ? "Claude Code subscription (Agent SDK)"
          : kind === "api"
            ? "Claude Messages API (key)"
            : "MockMind (simulated)"
      }`,
    );

    this.orchestrator = new CognitionOrchestrator(
      mind,
      (id) => this.thinkerOf(id),
      ({ devotId, decision }) => {
        const devot = this.world.devots.get(devotId);
        if (devot) {
          applyDecision(devot, decision, this.world);
          const s = this.state.devots.get(devotId);
          if (s) {
            if (decision.emotion) s.emotion = decision.emotion;
            if (decision.thought) s.thought = decision.thought;
          }
          if (decision.action === "speak" && decision.utterance) {
            this.onDevotSpoke(devot, decision.utterance);
          }
          return;
        }

        const monster = this.world.monsters.get(devotId);
        if (!monster) return;
        applyMonsterDecision(monster, decision, this.world);
        const ms = this.state.monsters.get(devotId);
        if (ms && decision.thought) ms.thought = decision.thought;
        if (decision.action === "speak" && decision.utterance) {
          this.onMonsterSpoke(monster, decision.utterance);
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
    this.onMessage("debugSpawnMonster", (_client, msg: DebugSpawnMonsterMsg) => {
      spawnMonster(this.world, msg?.x ?? 0, msg?.z ?? 0);
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

    // THE DEPOSIT IS A TRANSACTION, AND IT IS WAITED FOR.
    //
    // Every other movement of value in this world is batched precisely so the
    // simulation never blocks on a network. A birth is the exception: it is the
    // one moment the god actually pays, and paying is not something to assume
    // and reconcile afterwards. If the chain refuses, no devot is born.
    let minted: VerifiedMint | undefined;
    if (this.vault) {
      // THE GOD PAID, AND THE SERVER CHECKS RATHER THAN TRUSTS.
      //
      // The client signs in its own wallet and hands us a hash. Everything
      // that matters — who paid, how much, which devot — is read back off the
      // chain from the event, never taken from the request.
      if (!msg.txHash) {
        return this.reject(
          client,
          "createFounder",
          "A devot has to be paid for. Connect a wallet and sign the deposit.",
        );
      }
      // A transaction hash is a bearer token until it is spent: without this,
      // one payment would mint devots forever. Cheap check first, so an obvious
      // replay never costs a round trip to the chain.
      if (this.repos.mintReceipts.spent(msg.txHash)) {
        return this.reject(client, "createFounder", "That deposit has already been used.");
      }
      client.send("creating", { stage: "paying" } satisfies CreatingMsg);
      try {
        minted = await this.vault.verifyMint(msg.txHash, this.vaultDepositWei);
        // And claim it for real once the chain has spoken. The insert is the
        // decision: two clients racing the same hash both pass the check above,
        // and only one of them wins the primary key.
        if (!this.repos.mintReceipts.claim(minted)) {
          return this.reject(client, "createFounder", "That deposit has already been used.");
        }
        console.log(
          `[world] ⛓ devot #${minted.tokenId} paid for by ${minted.god} — ${minted.deposit} wei, tx ${minted.txHash}`,
        );
        this.repos.events.record("devot_minted", [godId], {
          tokenId: minted.tokenId.toString(),
          deposit: minted.deposit.toString(),
          god: minted.god,
          tx: minted.txHash,
        });
      } catch (err) {
        const why = err instanceof Error ? err.message : "the chain refused it";
        console.error("[world] ⛓ deposit rejected:", why);
        return this.reject(client, "createFounder", `No devot was born: ${why}.`);
      }
    }

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
    // A new founder restarts the line: the previous one is over and scored.
    this.lineageStart.set(godId, this.world.worldMs);

    this.wake({
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
      generation?: number;
      /** Absent for a birth by reproduction, or in god mode. */
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
      pos: placeOnGround(
        opts.x ?? (Math.random() - 0.5) * this.world.size,
        opts.z ?? (Math.random() - 0.5) * this.world.size,
      ),
      // Capacity follows from the chosen VITALITY: the heaviest stat, since a
      // balance IS the thinking budget. A hardy devot does not merely live
      // longer, it thinks longer for the same deposit.
      balance: capacityFor(identity.stats.vitality),
      capacity: capacityFor(identity.stats.vitality),
      // What the deposit bought, kept for the estate it will leave. A founder
      // is born at exactly its capacity; a child is not, which is why this is
      // its own field rather than a reading of `capacity`.
      bornWith: capacityFor(identity.stats.vitality),
      identityJson: encodeIdentity(identity),
      // A devot is born empty-handed: every item must be forged, and paid for.
      items: [],
      state: "alive",
      profile: DEFAULT_DEVOT_PROFILE,
      traits: opts.traits,
      generation: opts.generation ?? 1,
      // Its address, derived rather than stored: the world keeps one secret,
      // not one per creature.
      wallet: this.wallets.addressAt(this.walletSeq++),
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

    // Lightning kills outside deathSystem, so this death never reaches the
    // tick's list — but it leaves the same estate as any other death, which is
    // everything the devot was given. Smiting your own is expensive, and it
    // feeds whoever is nearest.
    this.dropLegacy(devot.id, legacyOf(devot));
    devot.balance = 0;
    devot.state = "dead";
    this.repos.devots.kill(devot.id, "divine lightning");
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
    this.wake({
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

  /**
   * Wakes a mind, with everything that devot can currently see attached.
   *
   * Triggers say what just happened; they do not say what is standing next to
   * you. A devot woken by hunger while a rival closes in was deciding blind.
   * Appending the surroundings to every thought fixes that without buying more
   * thoughts — the picture rides along with the one we were already paying for.
   */
  /**
   * KEEPS EVERY DEVOT IN THE LOOP.
   *
   * A devot used to think only when something poked it, and coasted on its
   * last decision in between — which meant most of them, most of the time,
   * were not really present. Now each one looks at where it is and decides
   * what to do about it on a cadence, whether or not the world has bothered it.
   *
   * Triggers still cut in front: a threat displaces a queued musing, so being
   * always-on does not mean being slow to react.
   *
   * The guards that already existed carry the cost: a devot below the floor
   * cost abstains, the global token bucket throttles under pressure, and only
   * MAX_CONCURRENT_INFERENCES run at once. This adds pressure to that system
   * rather than bypassing it.
   */
  private keepThinking(): void {
    const now = Date.now();
    for (const devot of this.world.aliveDevots()) {
      if (devot.thinking) continue;
      if (now - (devot.lastThoughtAt ?? 0) < DEVOT_THINK_INTERVAL_MS) continue;
      this.wake({
        kind: "idle_reflection",
        devotId: devot.id,
        eventText:
          "Nothing has happened to you. Look at where you are and decide what to do about it — including doing nothing, which costs you almost nothing.",
        createdAt: now,
      });
    }
  }

  private wake(trigger: Trigger): void {
    const devot = this.world.devots.get(trigger.devotId);
    if (!devot) return;
    // Stamped on every wake, whatever woke it: the cadence measures time since
    // the devot last thought at all, not since it was last bored.
    devot.lastThoughtAt = Date.now();
    // The sky comes first: the hour and the season change what every other
    // line in the picture is worth.
    const eventText = [
      describeSky(this.world.worldMs),
      trigger.eventText,
      describeSurroundings(devot, this.world),
    ].join("\n\n");
    // Stamped here rather than when the decision lands: this is the moment the
    // picture was taken, so the next thought's "since your last thought" is
    // measured against exactly what this one was told.
    devot.balanceAtLastThought = devot.balance;
    this.orchestrator.enqueue({ ...trigger, eventText });
  }

  // ── Simulation ───────────────────────────────────────────────────────────

  private simulate(): void {
    this.tickCount++;
    // The world's own clock, advanced one tick at a time rather than read from
    // the wall: a world that was paused did not live through the night.
    this.world.worldMs += TICK_MS;
    this.state.worldMs = this.world.worldMs;
    const result = tick(this.world);

    for (const { godId, funds, leftBy, devotId } of result.claimed) {
      const finder = this.world.devots.get(devotId);
      if (finder) {
        // Straight into the body. There is no purse to put it in any more, and
        // a balance IS a life — looting the dead is how a devot buys itself
        // more time to think. It may end up holding more than it was born with.
        finder.balance += funds;
      }
      this.repos.events.record("legacy_claimed", [devotId], { funds, leftBy, godId });
      console.log(
        `[world] ⛏ ${finder?.name ?? devotId} recovers ${funds} left by ${leftBy}` +
          ` — it now holds ${Math.round(finder?.balance ?? 0)}`,
      );
    }

    // A relic nobody came for is simply gone: the world is poorer by it.
    for (const foodId of result.rotted) {
      this.repos.events.record("food_rotted", [], { foodId });
    }

    for (const { devotId, foodId, worth } of result.eaten) {
      this.repos.events.record("meal", [devotId], { foodId, worth });
    }

    // Monsters move before the triggers are dispatched, so a devot woken this
    // tick is told about the beast that is already upon it, not where it stood.
    const beasts = monsterSystem(this.world, Date.now());

    for (const { devotId, residue, monsterId } of beasts.kills) {
      this.dropLegacy(devotId, residue);
      this.repos.devots.kill(devotId, `taken by ${monsterId}`);
      const name = this.world.devots.get(devotId)?.name ?? devotId;
      console.log(`[world] ☠ ${name} was taken by a monster — it leaves ${residue}.`);
      const st = this.state.devots.get(devotId);
      if (st) st.utterance = "";
    }

    for (const { monsterId, funds, leftBy } of beasts.scavenged) {
      // Taken out of circulation: the funds ride on a monster's back now, and
      // only come home if something brings it down.
      this.repos.events.record("legacy_scavenged", [], { monsterId, funds, leftBy });
      const name = this.world.monsters.get(monsterId)?.name ?? monsterId;
      console.log(
        `[world] 🩸 ${name} scavenges ${funds} left by ${leftBy} — worth killing now.`,
      );
    }

    for (const t of [...result.triggers, ...beasts.triggers, ...perceptionSystem(this.world)]) {
      this.wake(t);
    }

    for (const { attackerId, victimId, drained } of beasts.combats) {
      const victim = this.world.devots.get(victimId);
      this.broadcast("combat", {
        attackerId,
        victimId,
        drained: Math.round(drained),
        x: victim?.pos.x ?? 0,
        z: victim?.pos.z ?? 0,
        lethal: !!victim && victim.balance <= 0,
      } satisfies CombatFxMsg);
    }

    // A monster's death — starved or slain — gives back everything it took.
    // Nothing is created and nothing vanishes; it only changes hands.
    for (const death of [...beasts.deaths, ...result.monsterDeaths]) {
      this.dropCarrion(death.x, death.z, death.hoard);
      this.world.monsters.delete(death.monsterId);
      this.state.monsters.delete(death.monsterId);
      this.repos.events.record("monster_death", [death.monsterId], {
        hoard: Math.round(death.hoard),
      });
    }

    for (const { attackerId, victimId, drained } of result.combats) {
      if (this.tickCount % 8 === 0) {
        this.repos.events.record("combat", [attackerId, victimId], { drained });
      }
      // Combat must be seen: we broadcast the transfer so the client draws the
      // beam, floats the numbers and flashes the victim. Without that, life
      // theft — the heart of the game — stays invisible.
      const victim = this.world.devots.get(victimId);
      this.broadcast("combat", {
        attackerId,
        victimId,
        drained: Math.round(drained),
        x: victim?.pos.x ?? 0,
        z: victim?.pos.z ?? 0,
        lethal: !!victim && victim.balance <= 0,
      } satisfies CombatFxMsg);
    }

    // Births: consumes the intents left by the minds.
    if (!this.reproInFlight) {
      this.reproInFlight = true;
      void processReproductions(this.world, this.repos, this.chronicler, (birth) => {
        // A child is born without an address; the world assigns it here,
        // because only the world knows how many have come before.
        if (!birth.child.wallet) {
          birth.child.wallet = this.wallets.addressAt(this.walletSeq++);
        }
        console.log(
          `[world] ✚ ${birth.child.name} is born (${birth.mode}, god ${birth.child.godId})`,
        );
        this.wake({
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

    for (const { devotId, cause, residue } of result.deaths) {
      this.dropLegacy(devotId, residue);
      this.repos.devots.kill(devotId, cause);
      const s = this.state.devots.get(devotId);
      const name = this.world.devots.get(devotId)?.name ?? devotId;
      console.log(`[world] ☠ ${name} died (${cause}) — context destroyed.`);
      if (s) s.utterance = "";
    }

    // Food appears at random rather than on a metronome, so the world never
    // settles into a rhythm a devot could learn to wait out.
    // Count only what a devot can actually EAT. Relics and carcasses live in
    // the same map, so counting them meant a battlefield strewn with the dead
    // stopped the world producing food — starving it exactly when it had just
    // become deadly.
    let edible = 0;
    for (const f of this.world.food.values()) if (f.type !== "legacy") edible++;
    if (
      edible < FOOD_TARGET &&
      Math.random() < FOOD_SPAWN_CHANCE_PER_TICK * foodSpawnMultiplier(this.world.worldMs)
    ) {
      this.spawnFood("spawn");
    }

    if (this.tickCount % 20 === 0) {
      for (const d of this.world.devots.values()) this.repos.devots.snapshot(d);
    }

    this.spawnMonsters();
    this.wakeMonsters();
    this.keepThinking();

    for (const d of this.world.devots.values()) {
      if (d.state === "dead") continue;
      this.ledger.record(d.id, d.wallet, Math.max(0, d.balance));
    }
    void this.ledger.flush();

    this.detectExtinctions();
    this.scoreLineages();
    this.syncState();
  }

  /**
   * WHERE THE DANGER COMES FROM.
   *
   * Monsters existed in code and never in a game: `spawnMonster` was reachable
   * only from the debug message, so unless someone clicked it, the hunting, the
   * hoards, the scavenging and the fight-back reflex were all dead weight and
   * the world was a meadow with nothing in it.
   *
   * Kept honest by two rules. The population follows the living, so a predator
   * is never left with nothing to hunt and a lone founder is never met by a
   * pack. And nothing appears within sight of anyone: a beast has to cross the
   * ground to reach you, and you get to watch it come.
   */
  private spawnMonsters(): void {
    const ceiling = monsterCeiling(this.world.aliveDevots().length);
    if (this.world.aliveMonsters().length >= ceiling) return;
    if (Math.random() >= MONSTER_SPAWN_CHANCE_PER_TICK) return;

    const at = findMonsterSpawn(this.world);
    if (!at) return; // nowhere far enough from anyone this tick; try again later

    const beast = spawnMonster(this.world, at.x, at.z);
    this.repos.events.record("monster_spawned", [beast.id], {
      x: Math.round(at.x),
      z: Math.round(at.z),
    });
    console.log(
      `[world] 🐺 ${beast.name} comes out of the wild at x=${at.x.toFixed(0)}, z=${at.z.toFixed(0)}`,
    );
  }

  /**
   * A monster's mind on a leash: it may think at most once every
   * MONSTER_THINK_INTERVAL_MS. A predator that can see prey is in an
   * interesting situation on every single tick, so without this it would think
   * four times a second and spend the whole budget between them.
   */
  private wakeMonsters(): void {
    const now = Date.now();
    for (const monster of this.world.aliveMonsters()) {
      if (monster.thinking) continue;
      if (now - monster.lastThoughtAt < MONSTER_THINK_INTERVAL_MS) continue;
      monster.lastThoughtAt = now;

      const prey = monster.targetId ? this.world.devots.get(monster.targetId) : undefined;
      const ratio = Math.round((monster.balance / monster.capacity) * 100);
      this.orchestrator.enqueue({
        kind: prey ? "threat" : "idle_reflection",
        devotId: monster.id,
        eventText: [
          describeSky(this.world.worldMs),
          prey
            ? `Your instinct has fastened on ${prey.name} (id "${prey.id}"), ${Math.sqrt(dist2(monster.pos, prey.pos)).toFixed(1)} away, at ${Math.round((prey.balance / prey.capacity) * 100)}% of its life. You are at ${ratio}% of yours, and it is draining. Press this hunt, take something else, or break off.`
            : `You have found nothing to kill. You are at ${ratio}% of your life and it is draining while you prowl.`,
          describeMonsterSurroundings(monster, this.world),
        ].join("\n\n"),
        createdAt: now,
      });
    }
  }

  private onMonsterSpoke(monster: MonsterEntity, utterance: string): void {
    monster.utterance = utterance;
    const now = Date.now();
    for (const devot of this.world.aliveDevots()) {
      if (dist2(devot.pos, monster.pos) <= PERCEPTION_RADIUS * PERCEPTION_RADIUS) {
        this.wake({
          kind: "utterance_heard",
          devotId: devot.id,
          eventText: `The monster ${monster.name} makes a sound you understand: "${utterance}"`,
          createdAt: now,
        });
      }
    }
  }

  /**
   * Notices the moment a line stops existing.
   *
   * Watches the TRANSITION in world state rather than the deaths reported by
   * the tick. Reading deaths missed every way of dying that does not go through
   * deathSystem — divine lightning, most obviously, so a god who struck down
   * their own last devot never saw their run end.
   */
  private detectExtinctions(): void {
    const standing = new Set<string>();
    for (const d of this.world.devots.values()) {
      if (d.state !== "dead") standing.add(d.godId);
    }
    for (const godId of this.livingLines) {
      if (!standing.has(godId)) this.onLineageEnded(godId);
    }
    this.livingLines = standing;
  }

  /**
   * Recomputes what each god is playing for.
   *
   * Counted off the world rather than tallied as events happen: a counter that
   * is incremented in five places is a counter that drifts, and this is the
   * number the whole run is judged on.
   */
  private scoreLineages(): void {
    for (const [godId, god] of this.state.gods) {
      const line = [...this.world.devots.values()].filter((d) => d.godId === godId);
      const living = line.filter((d) => d.state !== "dead");

      god.born = line.length;
      god.lost = line.length - living.length;
      god.generations = line.reduce((n, d) => Math.max(n, d.generation), 0);
      god.eldest = line.reduce((n, d) => Math.max(n, d.age), 0);
      god.lineageAlive = living.length > 0;
      // No purse: what a god "has" is what its living are carrying, which is
      // the only honest number now that value lives entirely in bodies.
      god.treasury = Math.round(living.reduce((n, d) => n + Math.max(0, d.balance), 0));

      const startedAt = this.lineageStart.get(godId);
      if (startedAt === undefined) continue;
      // The clock stops when the last of them dies: a dead line does not go on
      // scoring while its god watches.
      if (living.length > 0) {
        god.lineageCycles = Math.floor((this.world.worldMs - startedAt) / TICK_MS);
      }
    }
  }

  /**
   * What a death leaves on the ground.
   *
   * A share of the deposit that bought this devot is released where it fell,
   * claimable by ANY devot of ANY god. The rest is burned — death destroys most
   * of what it touches, which is what stops a line from churning devots for
   * free and what makes a corpse worth crossing the map for.
   */
  private dropLegacy(devotId: string, residue: number): void {
    const devot = this.world.devots.get(devotId);
    if (!devot) return;
    // What it still held is what drops. A devot that spent itself down to
    // nothing leaves nothing; one cut down while it still had life leaves all
    // of it. The difference between the deposit and the estate was burned
    // living, one thought at a time.
    const funds = Math.max(0, Math.round(residue));
    if (funds <= 0) return;

    const relic: FoodEntity = {
      id: `legacy-${devot.id}`,
      pos: placeOnGround(devot.pos.x, devot.pos.z),
      type: "legacy",
      worth: 0,
      source: "spawn",
      spawnedAt: Date.now(),
      ttlMs: LEGACY_TTL_MS,
      funds,
      leftBy: devot.name,
    };
    this.world.food.set(relic.id, relic);
    this.repos.events.record("legacy_dropped", [devot.id], { funds });
  }

  /** The last of a line has died. The run is over, and the world remembers. */
  private onLineageEnded(godId: string): void {
    const god = this.state.gods.get(godId);
    if (!god) return;
    this.lineageStart.delete(godId);
    this.repos.events.record("lineage_ended", [godId], {
      cycles: god.lineageCycles,
      generations: god.generations,
      born: god.born,
      eldest: god.eldest,
    });
    console.log(
      `[world] ⌛ the line of ${god.name} is extinct — ${god.lineageCycles} cycles, ` +
        `${god.generations} generation(s), ${god.born} born.`,
    );
    this.broadcast("lineageEnded", {
      godId,
      cycles: god.lineageCycles,
      generations: god.generations,
      born: god.born,
      eldest: god.eldest,
    } satisfies LineageEndedMsg);
  }

  private onDevotSpoke(speaker: DevotEntity, utterance: string): void {
    speaker.utterance = utterance;
    const now = Date.now();
    for (const other of this.world.aliveDevots()) {
      if (other.id === speaker.id) continue;
      if (dist2(other.pos, speaker.pos) <= PERCEPTION_RADIUS * PERCEPTION_RADIUS) {
        this.wake({
          kind: "utterance_heard",
          devotId: other.id,
          eventText: `${speaker.name}, a devot near you, says: "${utterance}"`,
          createdAt: now,
        });
      }
    }
  }

  private spawnFood(
    source: "spawn" | "god",
    at?: { x: number; z: number },
    kind: FoodEntity["type"] = "grain",
    worth?: number,
  ): void {
    const rare = Math.random() < 0.06;
    const f: FoodEntity = {
      id: `food-${++this.foodSeq}`,
      pos: placeOnGround(
        at?.x ?? (Math.random() - 0.5) * 2 * this.world.size * 0.9,
        at?.z ?? (Math.random() - 0.5) * 2 * this.world.size * 0.9,
      ),
      type: at ? kind : rare ? "manna" : Math.random() < 0.3 ? "fruit" : "grain",
      worth: worth ?? 0,
      source,
      spawnedAt: Date.now(),
      ttlMs: 0,
    };
    f.ttlMs = rotsIn(f.type);
    if (f.worth === 0) {
      f.worth = f.type === "manna" ? CAPACITY_DEFAULT : f.type === "fruit" ? 6000 : 2000;
    }
    this.world.food.set(f.id, f);
  }

  /**
   * What a monster took, returned to the world where it fell.
   *
   * This is the rule the economy rests on: a hoard is never destroyed and never
   * minted, it is dropped as food for whoever is standing there. Usually that
   * is the devot who just killed it, which is exactly the intent — bringing a
   * fat monster down is the one act in this world that pays.
   */
  private dropCarrion(x: number, z: number, hoard: number): void {
    if (hoard < 1) return;
    const food: FoodEntity = {
      id: `food-carrion-${this.foodSeq++}`,
      pos: placeOnGround(x, z),
      type: "carrion",
      worth: Math.round(hoard),
      source: "spawn",
      spawnedAt: Date.now(),
      ttlMs: rotsIn("carrion"),
    };
    this.world.food.set(food.id, food);
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
        s.capacity = d.capacity;
        // Identity is written ONCE, when entering the state: it never changes,
        // and resynchronising it every tick would be absurd.
        s.identity = d.identityJson;
        s.wallet = d.wallet;
        this.state.devots.set(d.id, s);
      }
      s.x = d.pos.x;
      s.y = d.pos.y;
      s.z = d.pos.z;
      s.balance = Math.max(0, d.balance);
      s.state = d.state;
      s.thinking = d.thinking;
      s.utterance = d.utterance;
      s.age = d.age;
      // Items change during a life (a forging): unlike identity, they do need
      // to be resynchronised.
      s.items = d.items.join(",");
    }

    for (const m of this.world.monsters.values()) {
      let s = this.state.monsters.get(m.id);
      if (!s) {
        s = new MonsterState();
        s.id = m.id;
        s.name = m.name;
        s.capacity = m.capacity;
        this.state.monsters.set(m.id, s);
      }
      s.x = m.pos.x;
      s.z = m.pos.z;
      s.balance = m.balance;
      s.hoard = m.hoard;
      s.state = m.state;
      s.targetId = m.targetId ?? "";
      s.utterance = m.utterance;
    }
    for (const [id, f] of this.world.food) {
      let s = this.state.food.get(id);
      if (!s) {
        s = new FoodState();
        s.id = id;
        s.kind = f.type;
        s.worth = f.worth;
        s.source = f.source;
        s.x = f.pos.x;
        s.z = f.pos.z;
        s.spawnedAt = f.spawnedAt;
        s.ttlMs = f.ttlMs;
        s.funds = f.funds ?? 0;
        s.leftBy = f.leftBy ?? "";
        this.state.food.set(id, s);
      }
    }
    for (const id of this.state.food.keys()) {
      if (!this.world.food.has(id)) this.state.food.delete(id);
    }
  }
}
