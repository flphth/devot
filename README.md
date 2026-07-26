# Devot — prototype

> A game where you are a god, and your faithful are real Claude agents.
> Thinking costs them their life. See [`PLAN.md`](./PLAN.md) (game design) and
> [`ARCHITECTURE.md`](./ARCHITECTURE.md) (technical).

## Quick start

```sh
pnpm install
pnpm --filter @devot/server dev # terminal 1 — world on ws://localhost:2567
pnpm --filter @devot/client dev # terminal 2 — http://localhost:5173?god=YourName
```

Open `http://localhost:5173?god=YourName`, shape your founder devot on the
creation screen, then select it (click its body) to speak to it (140 characters
per minute) or feed it. Two browsers with different `?god=` values means two
gods in the same world.

**Claude access — three backends** (`MIND` variable, see `.env.example`):

| `MIND=` | What it uses | Cost |
| --- | --- | --- |
| `claude` *(default)* | Your **Claude Code subscription** (Agent SDK, the machine's OAuth) | subscription quota, **no per-token billing** |
| `api` | Messages API with `ANTHROPIC_API_KEY` (Console key) | pay-per-token |
| `mock` | Simulated minds, offline | free |

Nothing to configure if Claude Code is installed and signed in on the machine:
the `claude` default works as-is. A Haiku thought takes ~5-15 s (ephemeral
session) — the devot's body goes on living while it thinks, and that is the
design.

## Requirements

- Node ≥ 22, pnpm ≥ 9

## Commands

```sh
pnpm install
pnpm typecheck        # tsc --noEmit across every package
pnpm test             # vitest (HP economy, death/context, sim, orchestrator, social)
pnpm p0               # P0 demo: one headless devot is born, thinks, eats, dies
pnpm p0 -- --mock     # force the fake mind even with an API key

# Playing (P1+): server + client
pnpm --filter @devot/server dev     # Colyseus WorldRoom on ws://localhost:2567
pnpm --filter @devot/client dev     # 3D client on http://localhost:5173 (?god=YourName)

# End-to-end smoke tests (real room, mock mind, in-memory DB)
pnpm --filter @devot/server smoke
```

Useful server-side variables: `DEVOT_MOCK=1` (simulated minds),
`DEVOT_DB=path.sqlite`, `DEVOT_MOCK_SCRIPT=idle,reproduce,attack` (cyclic mock
decisions, for demos), `DEVOT_WALLET_SEED` (BIP-39 mnemonic; without it the
world's wallets are real addresses but ephemeral).

## Layout

```
apps/server        # simulation loop + (P1) Colyseus WorldRoom
apps/client        # (P1) Vite + React + React Three Fiber
packages/shared    # types, constants, terrain, props, clock, DECISION_SCHEMA — source of truth
packages/sim       # reactive layer: deterministic systems of the 250 ms tick
packages/agents    # minds: prompts, model tiers, cost→HP, orchestrator
packages/db        # SQLite (better-sqlite3 + Drizzle): lines, contexts, events, migrations
packages/onchain   # wallets derived per devot, batched life ledger, PaymentProvider
```

## Milestones

- [x] **P0 — Mortal core**: 250 ms tick, structured inference, HP ↓ from real `usage`, death = context destroyed
- [x] **P1 — World & 3D**: Colyseus WorldRoom + R3F, food, god HUD (140 chars / 60 s)
- [x] **P2 — Social life**: reproduction (budding + sexual), inheritance through the chronicler, combat
- [x] **P3 — Many gods**: PvP between lines, founder re-creation
- [x] **P4 — Style & divine tools**: voxel/meadow rendering, interpolation, inner monologue +
  Mind panel, traits at creation, divine lightning, fog of war, god mode (key 1)
- [x] **G4 — Monsters**: predators that hunt, hoard what they take, and starve if they stop
- [x] **Living world**: terrain relief and line of sight, boulders and flowers, food that rots,
  day/night and seasons, monsters with minds, a fight-or-flight reflex, lineage scoring,
  a live feed of every thought, and a wallet per devot

## In play

- **Create**: choose your founder's look, stats, traits and soul on the creation screen.
- **Select**: click a devot → Mind panel (the journal of its life, its inner monologue)
  and the action bar: speak (140 chars/min), feed 🍞, strike down ⚡ (double click to confirm).
- **The world thinks**: the right-hand feed carries every monologue and every word spoken,
  from every creature at once. Thoughts are italic and private; speech is plain and public.
- **Fog of war**: you only see the world around your living devots, and hills genuinely
  hide what lies behind them (prototype: client-side filtering; the Colyseus StateView
  anti-cheat is a noted evolution).
- **Key 1 — god mode** (debug/creative): fog off, click the ground to spawn a devot or a
  monster, drag food around.
