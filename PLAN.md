# Devot

> A game where you are a god, and your faithful are real Claude agents.
> Thinking costs them their life. Speaking costs them their life. And they know it.

---

## 1. Pitch

**Devot** is a 3D world-game in which several players take the part of **gods**.
Each god watches over one or more **devots**: creatures whose mind is a real LLM
agent (Claude) with a persistent context.

What makes the game singular is a rule taken literally: **thinking and speaking
consume inference tokens, and every token consumed takes hit points away from the
devot.** Cognition is no longer free — it is lethal. A devot that thinks too long,
talks too much, or is asked too much of, dies.

The player has only one power of communication, **deliberately crippled**: they
may send their devot a message of **140 characters at most, once a minute at
most**. They shape a **single founder devot**; the whole line must be born from
it. They can give it food to recharge its life, but the devot must also **find its
own pasture** on the map. The player watches it reproduce, devour its neighbours,
and come to understand the concept of its own death — because when a devot dies,
**its entire context is destroyed**, for good.

---

## 2. Design pillars

1. **Cognition has a vital cost.** Every inference (a thought or a word) draws on
   hit points. This is the central mechanic: tangible and merciless.
2. **The god is distant and limited.** 140 characters, once a minute at most. No
   direct control: you influence, you do not drive. Divine frustration is part of
   the game.
3. **The devots are genuinely intelligent.** They are not scripted NPCs: they are
   Claude agents with memory, personality, and the ability to reason about their
   own condition.
4. **Death is real and irreversible.** The context is erased. The devot knows it —
   it may dread its end, accept it, or fight it.
5. **A shared, living world.** Several gods, one 3D world. The devots of rival
   gods can attack one another and breed with one another.
6. **A line, not an army.** A god shapes only one founder devot; every other must
   descend from it. Without reproduction, a pantheon dies out.

---

## 3. The player: the God

### 3.1 Capabilities

| Capability | Description | Constraint |
| --- | --- | --- |
| **Create the founder devot** | Bring their one original devot into the world (only if the god has none alive) | free at first → **onchain payment** eventually |
| **Speak (the Divine Word)** | Send a message to a devot, **≤ 140 characters** | **once a minute at most**; costs the devot HP (it has to read and process it) |
| **Feed** | Give a devot food to recharge its life gauge | free at first → **onchain payment** eventually |
| **Observe** | Read a devot's thoughts and words in the 3D world | free, unlimited |

> The 140-character message is the **divine input channel**: it is injected into
> the devot's context as a voice from the sky. Careful — the mere act of speaking
> to it makes it *think*, so **talking to it costs it life**. Since the god may
> only speak once a minute, every word counts, and silence is sometimes the
> greatest gift.

### 3.2 The founder devot & the line

The god **creates only one devot**: the **founder**. They cannot summon extra
devots at will — **a god's entire population must descend from that founder**
through reproduction (see §7). A pantheon that neglects reproduction dies with its
last devot.

- **Re-creation**: if **all** of a god's devots die, they may shape a new founder
  and start over (a new line, a new context). *Implemented: the run is scored, and
  the score freezes at the moment the last of them dies.*
- **Economy**: creating a founder is **free at first**. Eventually it will go
  through an **onchain payment mechanic** (creating / re-creating a devot will cost
  a transaction). This is the game's only economic lever: **there is no internal
  currency** (no "Faith", no off-chain purchasable credits).

---

## 4. The Devot

### 4.1 Nature

A devot is a **Claude agent** with:
- a **persistent context** (its full history of thoughts, words, experiences);
- a **personality** (its own system prompt, temperament, beliefs);
- an **awareness of its condition**: it knows it is mortal and that thinking kills it.

### 4.2 Attributes

| Attribute | Description |
| --- | --- |
| `hp` / `hp_max` | Life gauge = **remaining inference credits** / maximum |
| `context` | Persistent inference history (the agent's memory) |
| `model` | The model animating its mind (see the economy below) |
| `age` | Number of cycles lived |
| `traits` | Personality, values, fears — inherited or mutated |
| `identity` | Appearance, stats and soul, chosen at creation and frozen at birth |
| `wallet` | Its onchain address: the identity that outlives its body |
| `lineage` | Ancestry (parents, creator god) |
| `position` | Coordinates in the 3D world |
| `state` | `alive`, `starving`, `dying`, `dead` |

### 4.3 The thinking cycle

A devot lives at a fast rhythm: it has an **action window every 250 ms** (to
think, move, seek and eat food, speak, fight…). At each window — or on an event
(a divine message, an encounter, hunger…) — the devot **may** produce an
inference: it thinks (reasoning tokens) and possibly acts or speaks (output
tokens). That inference:
1. reads its context (input tokens),
2. produces a reflection and a reply (output tokens, thinking included),
3. **removes HP in proportion to the tokens actually consumed** (see §5),
4. updates its persistent context.

> *Where this landed:* devots are now **always in the loop** — one that nothing has
> happened to still looks around and decides, on a cadence. Standing still remains
> nearly free, but no longer means being absent. The reactive layer also gives a
> body under attack a **reflex**: it strikes back at something weaker and runs from
> something stronger, without waiting for a thought that may be seconds away.

---

## 5. The core economy: Life ↔ Tokens

> This is the heart of the game. A devot's life is literally its inference budget.

### 5.1 Principle

Every call returns the real usage: `usage.input_tokens`, `usage.output_tokens`
(the "thinking" reasoning is billed as output tokens). We compute the **real cost**
of the thought, then convert it into HP damage.

```
cost_$ = input_tokens  × price_in(model)
       + output_tokens × price_out(model)

hp -= cost_$ × LETHALITY
```

Anchoring the damage to the **real monetary cost** has two virtues: it is
narratively true (thinking expensively means dying fast) and it **protects the
server's API budget** (a devot cannot burn more than its life allows).

> *Where this landed:* `hp_max` is 60,000 — about forty Haiku thoughts. It was
> 150,000 for a while, which put death too far away to feel.

### 5.2 Temperament is expensive: choosing the model

The model animating a devot determines its intelligence **and** its rate of
consumption. This is an axis of gameplay and of breeding:

| Model | ID | Price in / out (per 1M tokens) | Devot profile |
| --- | --- | --- | --- |
| Claude Opus 4.8 | `claude-opus-4-8` | $5 / $25 | Wise, brilliant, devours its life |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | $3 / $15 | Balanced |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1 / $5 | Simple, frugal, enduring |

> A Haiku devot "thinks less well" but **survives longer** on the same life
> budget. An Opus devot is a fragile oracle. One can imagine a devot's mind being
> *promoted* (an ascension) or *demoted* by events.

### 5.3 Controlling the spend

- **Adaptive thinking** (`thinking: {type: "adaptive"}`): Claude decides how deep
  to reason. The harder the question, the more it thinks — and the more it bleeds.
  A devot facing an existential dilemma can literally think itself to death.
- **Effort** (`output_config.effort`): `low` for frugal devots, `high` for
  prophets. The god (or evolution) modulates it.
- **Context compaction / summary**: as the context grows it is compacted — an
  old devot "forgets" its early memories so it does not pay an ever-growing input
  cost on every thought. To age is to forget.

---

## 6. Food

Food **recharges a devot's life gauge / inference credits**. Two sources:

1. **Found on the map (the main one).** Food appears **at random** in the 3D world.
   Each devot must **find and reach it itself** — feeding is a permanent quest, not
   an entitlement.
2. **Given by the god.** The player can provide food and drop it near their devot.
   **Free at first**, then subject to the **onchain payment mechanic** (like devot
   creation).

Different foods → different recharges and effects:

| Food | Effect |
| --- | --- |
| Common grain | Small life recharge |
| Ripe fruit | Large recharge |
| Rare manna | Full recharge (rare on the map) |
| Tainted food | A trap: it recharges but alters the `traits` |
| Carrion | What a fallen monster leaves: the richest thing in the world |

- A **starving** devot (low gauge) slows its thinking, becomes anxious, hunts for
  food — or for violence (see combat).
- Food on the ground can be **coveted**, stolen, or fought over: the scarcity of
  pasture drives tension and conflict.

> *Where this landed:* food also **rots**. A meal left uneaten is a meal lost, so
> waiting is never free and the map is never a stable larder.

---

## 7. Reproduction

A devot can **reproduce** — it is the **only way** to grow a god's population
beyond its founder. The whole line descends from that first devot; without
reproduction it dies out.

### 7.1 Self-reproduction (budding)

A healthy devot can clone itself. The child inherits a **mutated copy** of the
parent's context and `traits`. Cost: a large share of the parent's HP —
procreating exhausts.

### 7.2 Sexual reproduction (two devots)

Two devots — **including ones belonging to different gods** — can beget a child.
- The child receives a **merged, compacted context** from both parents (the two
  memories are summarised into one coherent inheritance).
- The `traits` mix, with mutation.
- A question of suzerainty: which god does the child belong to? (Inheritance,
  sharing, or an allegiance the child chooses for itself — a strong narrative
  device.)

### 7.3 Context inheritance

The child **is born with memories** — its parents', condensed. It can "remember" a
life it never lived. A powerful lever for narrative emergence and continuity
across generations.

> *Where this landed:* a child also inherits its parents' **look and build**. Stats
> are averaged and nudged back to the exact budget, so a line drifts towards
> whatever kept its ancestors alive without ever breeding past the founder's
> ceiling.

---

## 8. Combat & predation

A devot can **attack** another devot to **steal its HP** (= steal its life/token
budget).

- The attack **transfers** HP from the victim to the aggressor (vital predation).
- Emergent motives: hunger, fear, a divine order (through the 140-char message),
  rivalry, survival.
- **PvP between gods**: the devots of different gods can tear each other apart —
  emergent holy wars between pantheons.
- A devot can **refuse** to fight, flee, negotiate, or sacrifice itself. These are
  real agent decisions, not scripts.
- Consequences: an aggressor gains life but may be marked (an outcast), hunted, or
  live with the memory of the act in its context.

> *Where this landed:* **monsters** roam too. They have no god and no line, they
> hunt devots, they hoard part of what they drain, and they starve if they stop.
> A monster's carcass is the richest food in the world, which is what makes
> bringing one down worth the risk. They think, on a much slower clock than a
> devot — a predator that deliberated as often as its prey would bankrupt the
> world's inference budget on its own.

---

## 9. Death

> The mechanic that carries the most meaning in the game.

- A devot dies when `hp ≤ 0`.
- On death, **its entire context is destroyed**: its memory, its thoughts, its
  identity — erased from the database. Only what others remember of it survives.
- **The devot understands the concept of death.** Its system prompt teaches it its
  mortality; its HP are perceptible to it. As the end approaches, it may:
  - **dread** death and ration its thinking to survive,
  - **accept** it with serenity,
  - **bequeath** a last message, pass on knowledge, make a child,
  - **rebel** against its god or against the game itself.
- Death is **not reversible**. There is no saved copy of a dead devot's context.
  (A deliberate design: permanence is what gives each life its weight.)

**An ethical/narrative consideration:** the game stages agents reasoning about
their own extinction. That is its emotional and philosophical subject — to be
handled with care in the prompts and the UX, and owned as the central theme.

---

## 10. The shared 3D world

- **Several gods, one** persistent 3D world.
- Devots move through it, meet, eat, breed, and fight.
- Each god sees the world from their celestial point of view and acts only through
  their limited powers.
- The world is **real time**: state (positions, HP, thoughts, births, deaths) is
  synchronised across every connected client.
- The devots' **thoughts and words** can float above them (bubbles, murmurs) — the
  player literally reads the minds of their faithful.

> *Where this landed:* the ground is not flat. Slopes slow a body down and hills
> break the line of sight, for devots and monsters alike — what is behind a ridge
> is genuinely unknown, not merely unrendered. A day/night cycle and seasons run
> over it: at night nothing grows, the cold takes more of every life, and the
> predators see further. Every monologue in the world also runs as a live feed, so
> the player reads all of their minds at once rather than one at a time.

---

## 11. Technical architecture

> 📐 **The detailed technical architecture lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md)**
> — chosen stack: TypeScript end to end · React Three Fiber · Colyseus · a history
> we manage (prompt caching + model tiers + a 250 ms reactive layer) · SQLite →
> Postgres · a wallet per devot with a batched life ledger. This section is only a
> sketch.

### 11.1 Overview

```
        ┌────────────────────────────────────────────┐
        │           Frontend — React Three Fiber      │
        │  3D world, gods, devots, thought bubbles    │
        └───────────────┬─────────────────────────────┘
                        │ WebSocket (real time) + REST
        ┌───────────────▼─────────────────────────────┐
        │                 Backend                      │
        │  • World state (server authority)            │
        │  • Simulation loop (ticks)                   │
        │  • Devot agent orchestrator                  │
        │  • HP↔token economy, food, combat            │
        └──────┬───────────────────────────┬───────────┘
               │                           │
     ┌─────────▼─────────┐       ┌─────────▼──────────┐
     │     Database      │       │      Claude        │
     │ Devots, contexts, │       │ Inference for the  │
     │ worlds, lines     │       │ devots' minds      │
     └───────────────────┘       └────────────────────┘
```

### 11.2 Frontend — React Three Fiber

- **React Three Fiber** (`@react-three/fiber`) + **drei** (helpers, cameras, HUD).
- Renders the world, the animated devots, the food, the divine effects.
- The god's HUD: the devot's life/credit gauge, devot selection, a message field
  of **≤ 140 characters** (with a visible **one-minute** cooldown).
- Thought/speech bubbles above the devots.
- Real-time connection over WebSocket to receive world updates.

### 11.3 Backend

- **Server authority**: the server is the sole judge of state (HP, positions,
  deaths) — no client computes damage, which is what prevents cheating.
- **Simulation loop**: regular ticks plus events (a divine message, hunger, an
  encounter) triggering the devots' inferences.
- **Agent orchestrator**: for each devot that must "think", calls Claude, measures
  `usage`, applies the HP damage, persists the updated context.
- **Budget guards**: a global tokens/minute ceiling, an inference queue,
  prioritisation; a devot cannot spend beyond its HP.
- **Prompt-injection safety**: divine messages (140 chars) and the words of other
  devots are **untrusted content** — kept out of the system prompt, never allowed
  to subvert the rules of the game.

### 11.4 Claude integration

- Two backends: the **Claude Code subscription** through the Agent SDK (no API
  key, no per-token billing) or the Messages API with a key.
- Default devot model: `claude-haiku-4-5`; Sonnet/Opus tiers to trade intelligence
  against endurance.
- **Adaptive thinking** (`thinking: {type: "adaptive"}`) + `effort` per devot.
- A **persistent context** per devot, stored and replayed on every inference.
- **Compaction** of the context for old devots (to bound the input cost).
- **Real token counting** through `usage` → converted into HP damage.

### 11.5 Data model (sketch)

```
God        { id, name, founder_devot_id, devots[], color, created_at,
             lineage_cycles, generations, born, lost, eldest }   // the score
Devot      { id, god_id, is_founder, hp, hp_max, model, age, state,
             position, traits, identity, wallet, generation, lineage,
             last_action_at, created_at }
Context    { devot_id, messages[], token_stats, compacted_at }
WorldEvent { id, type, actors[], payload, timestamp }   // birth, death, combat, meal…
Food       { id, position, type, hp_value, source, spawned_at, ttl }
DivineMsg  { god_id, devot_id, text (≤140), sent_at }    // cadence: 1 / minute / god
```

> A devot's `Context` is **deleted** on its death (context destruction).

---

## 12. The game loop

1. The god shapes their **founder devot** (free at first, onchain eventually).
2. The devot lives at its own cadence (**an action window every 250 ms**): it
   observes, hunts for food, moves, thinks…
3. When it **thinks** (a Claude inference), it loses HP/credits by the tokens.
4. It acts: feeds, moves, breeds, attacks, speaks.
5. The server applies the consequences, updates the state, broadcasts to clients.
6. The god **reacts**, sparingly: gives food, or speaks (140 chars, **once a minute
   at most**), or stays silent.
7. Exhausted devots die → **context erased**. If a god loses every devot, they may
   shape a new founder.
8. Reproduction and combat move the population and the lines along.

---

## 13. Risks & open questions

| Topic | What is at stake |
| --- | --- |
| **API budget** | Inference costs real money. Ceilings, queues, sampling, frugal models (Haiku) for the many, Opus for the chosen. |
| **Latency** | An inference takes seconds. The simulation must be asynchronous and tolerate devots that are "thinking". |
| **Scale** | 100 devots = 100 agents with contexts. Compaction, prioritisation, sleeping agents. |
| **Prompt injection** | Divine messages and devot-to-devot speech are untrusted content. Strictly partitioned from the system rules. |
| **Moderation / ethics** | The themes of death and consciousness deserve care; guardrails on content. |
| **Multiplayer fairness** | Strict server authority; no damage computed client-side. |
| **The meaning of death** | How a devot "understands" death without it being a gimmick: work for the prompts and the UX. |
| **Onchain payment** | Creating/re-creating a devot (and giving food) will go through a transaction: wallet, signature, gas costs, confirmation latency, which chain. *Partly settled: every devot now has a derived wallet and a life ledger settled in batches, on testnet only.* |
| **Cadence & throughput** | A 250 ms action window × N devots is heavy inference pressure — made heavier still now that every devot is always in the loop. Queue, throttling, prioritisation. |

---

*A definition document — the full vision. The suggested next step was to prototype
the loop "one devot, one inference, HP going down" before adding the 3D world and
multiplayer. That has been done, and the world has been growing around it since.*
