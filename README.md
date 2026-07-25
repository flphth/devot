# Devot — prototype

> Un jeu où vous êtes un dieu, et vos fidèles sont de véritables agents Claude.
> Penser leur coûte la vie. Voir [`PLAN.md`](./PLAN.md) (game design) et
> [`ARCHITECTURE.md`](./ARCHITECTURE.md) (technique).

## Démarrage rapide

```sh
pnpm install
pnpm --filter @devot/server dev # terminal 1 — monde sur ws://localhost:2567
pnpm --filter @devot/client dev # terminal 2 — http://localhost:5173?god=TonNom
```

Ouvre `http://localhost:5173?god=TonNom`, clique « Façonner ton devot fondateur »,
sélectionne-le (clic sur son corps) pour lui parler (140 caractères / minute) ou le nourrir.
Deux navigateurs avec des `?god=` différents = deux dieux dans le même monde.

**Accès Claude — trois backends** (variable `MIND`, cf. `.env.example`) :

| `MIND=` | Ce que ça utilise | Coût |
| --- | --- | --- |
| `claude` *(défaut)* | Ton **abonnement Claude Code** (Agent SDK, OAuth de la machine) | quota de l'abonnement, **0 facturation au token** |
| `api` | Messages API avec `ANTHROPIC_API_KEY` (clé Console) | pay-per-token |
| `mock` | Esprits simulés, hors-ligne | gratuit |

Rien à configurer si Claude Code est installé et connecté sur la machine : le défaut
`claude` fonctionne directement. Une pensée Haiku prend ~5-15 s (session éphémère) —
le corps du devot continue de vivre pendant qu'il pense, c'est le design.

## Prérequis

- Node ≥ 22, pnpm ≥ 9

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
- [x] **P4 — Style & outils divins** : rendu voxel/prairie, interpolation, monologue intérieur +
  panneau Esprit, traits à la création, foudre divine, brouillard de guerre, mode god (touche 1)

## En jeu

- **Créer** : choisis 2-3 traits, puis « Façonner ton devot fondateur ».
- **Sélectionner** : clic sur un devot → panneau Esprit (journal de sa vie, monologue intérieur)
  et barre d'actions : parler (140c/min), nourrir 🍞, foudroyer ⚡ (double clic de confirmation).
- **Brouillard de guerre** : tu ne vois le monde qu'autour de tes devots vivants (proto : filtrage
  visuel côté client ; l'anti-triche StateView Colyseus est une évolution notée).
- **Touche 1 — mode god** (debug/créatif) : brouillard off, clic au sol = spawn de devot,
  glisser-déposer la nourriture.
