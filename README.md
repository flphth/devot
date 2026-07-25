# Devot — prototype

> Un jeu où vous êtes un dieu, et vos fidèles sont de véritables agents Claude.
> Penser leur coûte la vie. Voir [`PLAN.md`](./PLAN.md) (game design) et
> [`ARCHITECTURE.md`](./ARCHITECTURE.md) (technique).

## Prérequis

- Node ≥ 22, pnpm ≥ 9
- Optionnel : `ANTHROPIC_API_KEY` (sinon les esprits sont simulés — MockMind)

## Commandes

```sh
pnpm install
pnpm typecheck        # tsc --noEmit sur tous les packages
pnpm test             # vitest (économie HP, mort/contexte, sim, orchestrateur, social)
pnpm p0               # démo P0 : un devot headless naît, pense, mange, meurt
pnpm p0 -- --mock     # force l'esprit factice même avec une clé API

# Jouer (P1+) : serveur + client
pnpm --filter @devot/server dev     # WorldRoom Colyseus sur ws://localhost:2567
pnpm --filter @devot/client dev     # client 3D sur http://localhost:5173 (?god=TonNom)

# Smoke tests bout-en-bout (room réelle, esprit mock, DB mémoire)
pnpm --filter @devot/server smoke
```

Variables utiles côté serveur : `DEVOT_MOCK=1` (esprits simulés), `DEVOT_DB=chemin.sqlite`,
`DEVOT_MOCK_SCRIPT=idle,reproduce,attack` (décisions cycliques du mock pour démo).

## Structure

```
apps/server        # boucle de simulation + (P1) Colyseus WorldRoom
apps/client        # (P1) Vite + React + React Three Fiber
packages/shared    # types, constantes, DECISION_SCHEMA — source de vérité
packages/sim       # couche réactive : systèmes déterministes du tick 250 ms
packages/agents    # esprits : prompts, palier de modèles, coût→HP, orchestrateur
packages/db        # SQLite (better-sqlite3 + Drizzle) : lignées, contextes, événements
packages/onchain   # PaymentProvider — FreeStubProvider uniquement (onchain différé)
```

## Jalons

- [x] **P0 — Cœur mortel** : tick 250 ms, inférence structurée, HP ↓ selon `usage`, mort = contexte détruit
- [x] **P1 — Monde & 3D** : WorldRoom Colyseus + R3F, nourriture, HUD dieu (140c / 60 s)
- [x] **P2 — Vie sociale** : reproduction (bourgeonnement + sexuée), héritage via chroniqueur, combat
- [x] **P3 — Multi-dieux** : PvP inter-lignées, recréation du fondateur
