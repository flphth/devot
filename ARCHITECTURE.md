# Devot — Technical architecture

> Technical companion to [`PLAN.md`](./PLAN.md) (game design).
> Target: a prototype **playable at a hackathon, single-node**, with a documented
> path to scale. 100% TypeScript.

---

## 1. Chosen stack

| Layer | Choice | Role |
| --- | --- | --- |
| **3D frontend** | React + **React Three Fiber** + drei | Rendering the world, god HUD, thought bubbles |
| **Real time** | **Colyseus** (client + server) | World authority, rooms, delta state sync |
| **Backend** | **Node.js + TypeScript** | Authoritative server, simulation loop, orchestration |
| **Cognition** | `@anthropic-ai/sdk` (Messages API) or the Claude Code Agent SDK | The devots' minds, history we manage, structured output |
| **Persistence** | **SQLite** (`better-sqlite3` + Drizzle) | Lines, contexts, events — migratable to Postgres |
| **Onchain** | `ethers` (HD derivation) | A wallet per devot, batched life ledger |
| **Monorepo** | pnpm workspaces | `apps/*` + `packages/*`, shared types |

**Guiding principle: strict server authority.** The client only *renders* and
*sends intents*. Every rule (HP damage, the 140-char cooldown, combat, deaths,
payments) is computed and validated server-side.

---

## 2. Overview

```
┌──────────────────────────── Client (browser) ────────────────────────────────┐
│  React + React Three Fiber + drei                                             │
│  • 3D rendering of the world (devots, monsters, food, terrain, effects)        │
│  • God HUD: life gauge, 140-char field (60 s cooldown), selection, thought feed│
│  • colyseus.js: receives state (delta), interpolates, sends actions            │
└──────────────▲──────────────────────────────────────────────┬────────────────┘
   state sync  │ (WS, delta @ patchRate)         god actions   │ (WS)
               │                                                ▼
┌──────────────┴───────────────────── Node/TS server (authority) ───────────────┐
│  Colyseus · WorldRoom                                                         │
│   • @colyseus/schema: authoritative state (devots, monsters, food, gods)      │
│   • 250 ms simulation tick  →  reactive layer (deterministic, 0 tokens)       │
│   • validates the god's actions (60 s cooldown, ownership, ≤140 chars)        │
│                                                                               │
│  Cognition orchestrator (asynchronous, decoupled from the tick)               │
│   • priority inference queue + rate limiter / token budget                    │
│   • system prompt (rules+persona, cached) + history + event                   │
│   • structured output (action) + usage                                        │
│   • Haiku/Sonnet/Opus tiers · usage → HP damage                               │
│                                                                               │
│  Persistence (SQLite/Drizzle)            Onchain (packages/onchain)           │
│   gods · devots · messages · events       one wallet per devot (derived)      │
│   · food · divine_msgs                    life ledger, settled in batches      │
└──────────────┬───────────────────────────────────────────────┬───────────────┘
       ┌───────▼────────┐                              ┌─────────▼──────────┐
       │ SQLite (proto) │                              │  Claude (SDK/API)  │
       │  → Postgres    │                              │ Haiku/Sonnet/Opus  │
       └────────────────┘                              └────────────────────┘
```

---

## 3. Monorepo layout

```
devot/
├─ apps/
│  ├─ client/          # Vite + React + R3F + colyseus.js
│  └─ server/          # Node + Colyseus (WorldRoom) + orchestrator
├─ packages/
│  ├─ shared/          # types, action DTOs, constants, terrain, props, clock, Colyseus schemas
│  ├─ sim/             # reactive layer: deterministic systems (ECS-lite)
│  ├─ agents/          # LLM orchestrator, prompts, model tiers, cost→HP
│  ├─ db/              # Drizzle schema + SQLite access (repositories) + migrations
│  └─ onchain/         # wallets derived per devot, batched life ledger, PaymentProvider
├─ pnpm-workspace.yaml
└─ turbo.json          # (optional) build/dev pipeline
```

- **`packages/shared`** is the source of truth for types (state, actions, events),
  imported by the client **and** the server → the contract cannot drift.
- It is also where the world's *pure functions* live: terrain height, props, the
  clock. Both sides recompute them instead of syncing them, which only works
  because they depend on nothing but their arguments.
- **`packages/sim`** and **`packages/agents`** are consumed by `apps/server`.
  Kept as separate packages so the orchestrator can later be extracted into its
  own service (see §12, scaling).

---

## 4. Real time & world authority (Colyseus)

### 4.1 Room & state

A single **`WorldRoom`** hosts the shared world (every god, every devot).
State is described with `@colyseus/schema` (automatic binary delta sync):

```ts
class DevotState extends Schema {
  id: string; godId: string;
  x = 0; y = 0; z = 0;
  hp = 0;                    // remaining inference credits
  hpMax = 0;
  state = "alive";           // alive | starving | dying | dead
  profile = "frugal";        // frugal | balanced | prophet
  thinking = false;          // an inference is in flight
  utterance = "";            // last words (bubble)
  identity = "";             // appearance, stats, soul, signature — frozen at birth
  wallet = "";               // its onchain address
}

class WorldState extends Schema {
  worldMs = 0;               // the world's clock: hour, season, sky
  devots   = new MapSchema<DevotState>();
  monsters = new MapSchema<MonsterState>();
  food     = new MapSchema<FoodState>();
  gods     = new MapSchema<GodState>();
}
```

- **`patchRate`** (network) ≈ 50 ms (20 Hz) for smooth rendering.
- **`setSimulationInterval(dt)`** (logic) = **250 ms** = the devots' action cadence.
- The client interpolates positions between two patches.
- **Height never travels.** `y` follows from `terrainHeight(x, z)`, which both
  sides compute identically — as do the boulders and the sky.

### 4.2 God actions (client → server)

The client only emits **intents**, validated server-side:

| Message | Payload | Server validation |
| --- | --- | --- |
| `createFounder` | `{ traits, appearance, stats, soul }` | the god has **no** living devot · traits from the pool · stat budget exact · `PaymentProvider` charged |
| `speak` | `{ devotId, text }` | ownership · `text.length ≤ 140` · `now - god.lastSpeakAt ≥ 60 s` |
| `feed` | `{ devotId?, x, z }` | `PaymentProvider` charged · drops "gift" food |
| `smite` | `{ devotId }` | ownership · irreversible, destroys the context |
| `select` | `{ devotId }` | read-only (camera/HUD) |

The 140-char cooldown is **authoritative**: `god.lastSpeakAt` lives in server
state, never in the client (which only renders the countdown).

The stat budget is checked server-side for a specific reason: it is the one part
of creation a tampered client could use to grant itself the maximum everywhere.

---

## 5. Cadence & decoupling: the body (250 ms) vs the mind (async)

The paradox to solve: **a devot acts every 250 ms**, but **an LLM inference takes
seconds**. Solution → two decoupled loops:

```
   Body (deterministic, every 250 ms)         Mind (LLM, asynchronous, expensive)
   ───────────────────────────────────        ─────────────────────────────────
   • walk towards a goal                       woken by a TRIGGER:
   • perceive food / devots / monsters  ──────►  • a divine message received
   • eat on contact                             • a meaningful encounter
   • flee / advance                             • low HP (survival)
   • resolve ongoing combat                     • being attacked
   • REFLEX: fight or flee when struck          • a word heard
   • detect the triggers ─────────────┘         • or simply its turn to think
        (0 tokens — free)                     → produces a DECISION (new goal,
                                                speech, attack, child)
                                              → applies HP-, seconds later
```

- The **body** (reactive layer) runs every tick and **costs no tokens**: it keeps
  the devot alive (movement, hunger, touching food) continuously.
- The **mind** (LLM) runs on triggers, in the background. While it "thinks"
  (`thinking = true`, a "…" bubble), the body keeps moving.
- Devots are also **always in the loop**: one that nothing has happened to still
  looks around and decides, on `DEVOT_THINK_INTERVAL_MS`. That is the most
  expensive constant in the game, and the guards in §8 are what make it safe.
- Between thoughts the body is not helpless. A devot under attack **reacts on its
  own** — striking back at something weaker, running from something stronger —
  because a thought can be seconds away and a devot being eaten should not keep
  grazing. The reflex only ever overrides a *passive* goal: a mind that has
  already chosen is obeyed.

---

## 6. Reactive layer (`packages/sim`)

An **ECS-lite**: devot state (in the room) + deterministic *systems* run every
tick. No LLM calls here.

| System | Role | Emits a trigger? |
| --- | --- | --- |
| `decaySystem` | Food that outlived its ttl rots away | no |
| `perceptionSystem` | Neighbourhood (food, devots, monsters), gated by line of sight | yes (encounter, threat) |
| `movementSystem` | Advances towards `currentGoal`, slowed by slope, blocked by boulders | no |
| `feedingSystem` | Eats on contact → `hp += food.hpValue` | no |
| `hungerSystem` | Moves to `starving`/`dying` by HP | yes (low HP) |
| `combatSystem` | Resolves an ongoing attack → HP transfer | yes (the victim is told) |
| `reflexSystem` | Fight or flight for a body with a passive goal | no |
| `monsterSystem` | Predators hunt, hoard, and starve | yes (the prey is told) |
| `deathSystem` | `hp ≤ 0` → death + **context destroyed** | yes (world event) |

Triggers feed the cognition orchestrator's queue (§7). A default goal (wandering,
or "seek the nearest food" when starving) guarantees that a devot **with no mind
available stays alive and believable** until its next thought.

Reflexes run in their own pass, *after* every blow of the tick has landed:
folded into the main loop, whether a devot reacted depended on where it happened
to sit in the map relative to its attacker.

---

## 7. Devot cognition (`packages/agents`)

### 7.1 A mind = our history + one Claude call

Each devot has a **message history** stored **in our database** (`messages`
table). "Thinking" = calling Claude with:

1. a **system prompt** = `WORLD_RULES` (shared, **cached**) + the devot's own
   **persona** (temperament, values, awareness of death);
2. the devot's **history** (past thoughts and events, possibly summarised);
3. the **current event** as the last user turn — the sky, what just happened,
   and the full panorama of what it can see.

The reply is **structured** (an action schema) so it can be applied reliably, and
the returned `usage` gives the real cost → HP damage.

The layer is **polymorphic**: `MindProvider.think` takes a `ThoughtSubject`, not
a devot, which is what lets a monster read its own rulebook and think through the
same door.

### 7.2 Model tier = temperament × endurance

| Profile | Model | Thinking | Effort | Used for |
| --- | --- | --- | --- | --- |
| **Frugal** | `claude-haiku-4-5` | omitted | — *(effort unsupported on Haiku 4.5)* | the mass of devots, and every monster |
| **Balanced** | `claude-sonnet-4-6` | `adaptive` | `low`/`medium` | established devots |
| **Prophet** | `claude-opus-4-8` | `adaptive` | `medium`/`high` | rare elders |

> Consistent with the theme: **adaptive thinking** produces tokens (billed as
> output), so **a prophet who thinks hard bleeds faster**. `effort` is the
> intelligence ⇄ longevity dial.

### 7.3 Prompt caching & ageing

- **Prompt cache**: `WORLD_RULES` is an **identical prefix for every devot** →
  placed at the head of the system prompt with `cache_control`, it then reads at
  ~0.1× (a cache shared across devots). The variable persona comes after.
  *Honest note:* caching only kicks in past a minimum prefix (~4096 tokens on
  Haiku/Opus, ~2048 on Sonnet) — size the rules accordingly, or accept no cache
  in the prototype.
- **To age is to forget**: when a devot's history passes a threshold, a
  **"chronicler"** (a cheap Haiku call) **summarises** it and replaces the old
  turns with a single condensed memory → the input cost of every future thought
  stays bounded.

### 7.4 Cost → HP (the heart of the economy)

```ts
function hpCost(usage, model) {
  const p = PRICE[model];
  const usd = (usage.input_tokens/1e6)*p.in + (usage.output_tokens/1e6)*p.out;
  return usd * LETHALITY;   // HP expressed in "micro-dollars of thought"
}
```

HP are expressed in **µ$ of inference**: `hp_max` is a budget (60,000 = $0.06 of
thought), food recharges it, every thought eats into it at its real cost. Since
`thinking` is billed as output, it is **counted in**.

The pool IS the number of thoughts in a life. At roughly 1,500 HP for a Haiku
thought, 60,000 buys about forty of them — which is what makes death close
enough to feel.

### 7.5 Prompt-injection safety

The **divine message (140 chars)** and the **words of other devots** are
**untrusted content**: injected into the **user turn** (never the system prompt),
explicitly framed ("A voice from the sky says to you: …"). The world's rules and
the inviolability of the mechanics stay in the frozen system prompt.

---

## 8. Orchestrator & budget guards (`packages/agents`)

The mind runs in an **inference queue** decoupled from the network tick:

- **Bounded concurrency**: at most *N* simultaneous inferences (`p-limit`),
  aligned with the API's rate limits.
- **One thought in flight per creature**: a creature already `thinking` is not
  woken again.
- **Priority**: divine message > combat/threat > survival (low HP) > encounter >
  idle reflection. Only one trigger is queued per creature, and it is the **most
  urgent** one — an arriving threat displaces a queued musing, never the reverse.
- **Budget**: (a) pre-check `hp > FLOOR_COST` before calling; (b) a **global
  token bucket** (µ$/minute) capping server spend; (c) under pressure, non-urgent
  creatures **fall asleep** (the body carries on, the mind waits).

Devots and monsters share this one queue on purpose: the ceiling is global, so a
pack of monsters cannot run up a bill behind the devots' back.

A devot **can never spend more than its life**: that is the double virtue of the
"real cost" model — narratively true **and** budget-safe.

---

## 9. Persistence (`packages/db`, SQLite → Postgres)

`better-sqlite3` (synchronous, fast, ideal for a single-node game server) +
**Drizzle** (typed schema, migrations, driver swappable to Postgres).

```
gods         (id, name, founder_devot_id, color, last_speak_at, created_at)
devots       (id, god_id, is_founder, hp, hp_max, cognition_profile,
              x, y, z, state, current_goal, last_action_at, age,
              traits_json, identity_json, wallet, parent_a, parent_b,
              born_at, died_at)
messages     (id, devot_id → CASCADE, role, content_json,
              tokens_in, tokens_out, created_at)   -- the devot's LLM history
world_events (id, type, actor_ids_json, payload_json, created_at)  -- the world's memory
food         (id, x, y, z, type, hp_value, source, spawned_at, consumed_by)
divine_msgs  (id, god_id, devot_id, text, sent_at)
```

- **Death = context destroyed**: `DELETE FROM messages WHERE devot_id = …`
  (CASCADE). A **gravestone** survives (`devots.died_at`, `world_events`) — what
  "the others remember" of the dead, without their mind.
- **Hot state** (positions, HP) lives in the Colyseus room in memory; persisted
  periodically / on events to SQLite (snapshot), not every tick.
- **Migrations are mandatory.** `CREATE TABLE IF NOT EXISTS` is a no-op on a
  database that already exists, so a column added after the first release
  silently never lands. `PRAGMA user_version` drives an append-only, idempotent
  migration list — never reorder an entry, only append.

---

## 10. Onchain (`packages/onchain`)

**Every devot is a wallet.** Each is born with a real EVM address: its onchain
identity, the thing that outlives its body and names it on its gravestone.

Keys are **derived, never stored**. One seed per world (`DEVOT_WALLET_SEED`, a
BIP-39 mnemonic) and any devot's wallet recomputes from its index — the database
holds addresses and nothing else, and there is exactly one secret in the system
instead of one per creature. Without a seed the world gets a fresh random one:
real addresses, but ephemeral.

**The life deposit settles in batches.** HP move several times a second, and
settling each movement would put a network round-trip inside the tick and make
the simulation depend on an RPC to stay alive. Movements accumulate and go out
netted per devot: a life that fell 900 and rose 800 settles once, for 100.

```ts
interface Settler {
  settle(batch: Settlement): Promise<void>;
}
```

- **Today**: `LocalSettler` keeps an auditable record in `world_events`. Also
  `FreeStubProvider` for creation/feeding charges — everything passes, no cost.
- **Later**: an onchain settler implements the same interface and drops in
  without the simulation noticing.

**Testnet only.** Nothing here should ever hold value that matters.

---

## 11. End-to-end flow — "the god speaks"

```
1. Client  ── room.send("speak", { devotId, text }) ──►  (and greys the input for 60 s)
2. Server: ownership? text ≤140? now - god.lastSpeakAt ≥ 60 s?  → otherwise reject
3. Server: lastSpeakAt = now; persists divine_msg; emits TRIGGER{divine_message, HIGH}
4. Orchestrator: builds the request (sky + history + "A voice from the sky says…"
                 + the full panorama) → Claude call → decision + usage
5. Server: hp -= hpCost(usage); applies the action (utterance / new goal / …)
           ; appends to history; persists
6. WorldRoom: state patch → every client
7. Client: speech bubble above the devot, HP gauge updated, line added to the feed
```

---

## 12. Scaling (documented path, outside the prototype)

| Today (prototype) | Tomorrow (scale) |
| --- | --- |
| Single-node SQLite | Postgres (swap the Drizzle driver) |
| Room state in memory | Redis + `@colyseus/redis-driver` (multi-process rooms) |
| In-process orchestrator | Dedicated worker service + a real queue (BullMQ/Redis) |
| 1 `WorldRoom` | Spatial sharding (several rooms/regions) + presence |
| Client served by Vite | Static build on a CDN |
| `LocalSettler` | An onchain settler behind the same interface |

The split into `packages/*` (sim / agents / db / onchain) makes these extractions
mechanical: `agents` moves out as a service without touching the rest.

---

## 13. Build milestones

| Phase | Goal | Deliverable |
| --- | --- | --- |
| **P0 — Mortal core** | 1 headless devot, 250 ms tick, **one structured inference**, an HP gauge falling with real `usage`, death + context deletion | proves the central mechanic, no 3D |
| **P1 — World & 3D** | Colyseus `WorldRoom` + R3F, random food, the devot seeks/eats, god HUD (speak 140 chars/60 s, feed) | first playable game |
| **P2 — Social life** | Reproduction (founder → line), context inheritance (chronicler), combat/predation | emergence |
| **P3 — Many gods** | Several gods, PvP between lines, founder re-creation | shared world |
| **P4 — Style & divine tools** | Voxel rendering, interpolation, inner monologue, creation screen, lightning, fog of war | it reads as a game |
| **G4 — Monsters** | Predators that hunt, hoard what they take, and starve if they stop | danger |
| **Living world** | Terrain and line of sight, boulders and flowers, rotting food, day/night and seasons, minded monsters, the fight-or-flight reflex, lineage scoring, the thought feed, a wallet per devot | a world that pushes back |

---

## 14. Recap of choices & open questions

**Settled:** TypeScript end to end · Colyseus (authority + sync) · a history we
manage + prompt caching + model tiers + a 250 ms reactive layer · SQLite with
`user_version` migrations · pure shared functions for terrain, props and the
clock · wallets derived per devot with a batched ledger.

**Open:** what a devot's wallet should eventually hold, and on which chain ·
whether the fog of war should become a Colyseus `StateView` (server-side
anti-cheat) rather than client-side filtering · whether the god should gain
verbs beyond speaking, feeding and smiting.
